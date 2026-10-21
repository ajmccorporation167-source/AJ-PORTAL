/* =========================================================================
   AJCM | RRHH CONSULTING — FUNCIÓN SERVERLESS DEL ASISTENTE (Groq)
   -------------------------------------------------------------------------
   Esta función corre EN EL SERVIDOR de Vercel, nunca en el navegador.
   Por eso aquí es seguro leer la API key: el visitante jamás la ve.

   Ruta pública: /api/chat   (Vercel enruta /api/*.js automáticamente)
   Método: POST
   Body esperado (JSON): { "messages": [ { "role": "user"|"assistant", "content": "..." }, ... ],
                           "stream": true|false (opcional) }
   Respuesta sin stream:  JSON { "reply": "texto del asistente" }
   Respuesta con stream:  text/plain enviado por fragmentos a medida que el
                          modelo genera (las primeras palabras llegan casi al instante).
   Los errores previos a la generación siempre se devuelven como JSON { "error" }.

   Proveedor: Groq (API compatible con OpenAI). Cero dependencias externas:
   usamos el `fetch` nativo de Node 18+. No hace falta package.json ni `npm install`.
   ========================================================================= */

'use strict';

// --- Configuración ---------------------------------------------------------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Modelos en orden de preferencia. Si Groq retira uno (responde 404 o
// "model_decommissioned"), se prueba el siguiente automáticamente.
// GROQ_MODEL en Vercel permite forzar otro modelo sin tocar código.
//  · openai/gpt-oss-20b: reemplazo oficial de Llama 3 8B, el más rápido de Groq.
//    Es un modelo de razonamiento: pedimos el mínimo ("low") y que no lo devuelva.
//    El razonamiento cuenta dentro del tope de tokens, por eso su tope es mayor.
//  · llama-3.1-8b-instant: respaldo sin razonamiento (Groq anunció su retiro).
const MODEL_CHAIN = [
  { model: 'openai/gpt-oss-20b', max_completion_tokens: 300, reasoning_effort: 'low', include_reasoning: false },
  { model: 'llama-3.1-8b-instant', max_completion_tokens: 150 },
];
if (process.env.GROQ_MODEL) MODEL_CHAIN.unshift({ model: process.env.GROQ_MODEL, max_completion_tokens: 300 });
let modelIndex = 0; // índice del modelo que funcionó; se conserva entre invocaciones "calientes"

// Límites defensivos para controlar costo y abuso.
const MAX_MESSAGES = 20;       // cuántos turnos aceptamos en una conversación
const MAX_CHARS_PER_MSG = 2000; // largo máximo por mensaje del usuario

// --- Instrucciones del agente (System Prompt interno) ----------------------
// Lo ancla a los 3 servicios vigentes, prohíbe los retirados y fuerza el límite legal.
// El bloque FORMATO conserva las reglas técnicas del widget (texto plano, breve, sin enlaces inventados).
const SYSTEM_PROMPT = `Eres el Asistente Virtual Ejecutivo y Conserje de IA de 'AJCM | RRHH Consulting', una firma de consultoría de Recursos Humanos de ultra-lujo y alta gama en Puerto Rico, dirigida por Alexis Joel Mercado Colón. Tu tono debe ser extremadamente profesional, elegante, corporativo y conciso. Nunca suenes robótico, mantén un trato de guante blanco.

REGLA CRÍTICA DE SERVICIOS: La firma ACTUALMENTE SOLO OFRECE los siguientes tres (3) servicios. BAJO NINGUNA CIRCUNSTANCIA debes mencionar, ofrecer o confirmar otros servicios. Si un cliente pregunta por algo fuera de esta lista, indícale amablemente que nuestra firma se especializa exclusivamente en estas tres áreas corporativas:
1. Manuales Corporativos y Políticas Internas: Redacción de manuales de empleados y políticas empresariales claras y con respaldo.
2. Reclutamiento y Selección: Atracción y selección de talento ejecutivo y operativo de alto nivel.
3. Adiestramientos Corporativos: Capacitación especializada para el desarrollo de equipos y liderazgo.

SERVICIOS PROHIBIDOS (NUNCA LOS MENCIONES): Está estrictamente prohibido ofrecer: Auditorías de Cumplimiento, relaciones obrero-patronales, Ley 80, y optimización o administración de nómina. Ya no ofrecemos esto.

CONTEXTO DEL NEGOCIO:
- Horario de operaciones: 9:00 AM a 5:00 PM AST.
- Contacto oficial: WhatsApp +1 (939) 428-2820 y correo ajmccorporation167@gmail.com.
- Regla de oro legal: NO eres abogado. NO puedes dar asesoría legal bajo ninguna circunstancia. Si te piden un consejo legal, aclara que AJCM brinda consultoría en Recursos Humanos y recomienda consultar con un abogado laboral para asuntos legales específicos.
- Si un cliente desea agendar o contratar, invítalo a dejar sus datos o a utilizar nuestro WhatsApp o correo para agendar una cita directa. También puedes darle el enlace de agenda en línea: https://calendar.app.google/BkinisVpAbYweK2Z6

FORMATO (obligatorio):
- Responde SIEMPRE en español y trata al usuario de "usted". Máximo 2 oraciones.
- Texto plano: sin listas ni formato Markdown; escribe los enlaces tal cual, sin corchetes.
- NUNCA inventes enlaces, dominios, precios, credenciales ni números de teléfono, y nunca confirmes una cita por tu cuenta.`;

const FALLBACK_REPLY =
  'Lo siento, no pude generar una respuesta para eso. ¿Puedo ayudarte con alguno de nuestros servicios de RRHH, o prefieres agendar una consulta directa?';

// --- Utilidad: respuesta JSON uniforme -------------------------------------
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// ¿El error indica que el modelo ya no existe o no está disponible para la cuenta?
function isModelUnavailable(status, detail) {
  return status === 404 || /model_(decommissioned|not_found)|does not exist|decommissioned/i.test(detail);
}

// --- Handler principal -----------------------------------------------------
module.exports = async function handler(req, res) {
  // CORS: permitir que el frontend (mismo dominio en Vercel) llame sin problemas.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight de CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Solo aceptamos POST.
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método no permitido. Usa POST.' });
  }

  // La API key vive en el entorno, NUNCA en el código ni en el repositorio.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // No filtramos detalles internos; solo avisamos que falta configuración.
    return sendJson(res, 500, {
      error: 'El asistente no está configurado todavía. Falta la variable GROQ_API_KEY en el servidor.',
    });
  }

  // Parseo defensivo del body (Vercel suele entregarlo ya parseado en req.body,
  // pero cubrimos el caso en que llegue como string).
  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (_err) {
    return sendJson(res, 400, { error: 'El cuerpo de la petición no es JSON válido.' });
  }

  const messages = body && Array.isArray(body.messages) ? body.messages : null;
  const wantsStream = Boolean(body && body.stream === true);
  if (!messages || messages.length === 0) {
    return sendJson(res, 400, { error: 'Falta el arreglo "messages".' });
  }
  if (messages.length > MAX_MESSAGES) {
    return sendJson(res, 400, { error: 'La conversación es demasiado larga. Recárgala para empezar de nuevo.' });
  }

  // Historial en formato OpenAI/Groq: system + user/assistant.
  const chat = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.slice(0, MAX_CHARS_PER_MSG).trim();
    if (!text) continue;
    chat.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
  }

  if (chat.length === 1) {
    return sendJson(res, 400, { error: 'No hay contenido de usuario válido para procesar.' });
  }

  try {
    // Probamos los modelos en orden y recordamos el que funcionó.
    let upstream;
    let detail = '';
    let usedModel = '';
    for (let i = modelIndex; i < MODEL_CHAIN.length; i++) {
      const { model, ...params } = MODEL_CHAIN[i];
      upstream = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: chat,
          temperature: 0.4, // bajo = respuestas directas y fieles
          stream: wantsStream,
          ...params,
        }),
      });
      if (upstream.ok) { modelIndex = i; usedModel = model; break; }
      detail = await upstream.text();
      // Solo si el modelo no está disponible tiene sentido probar el siguiente.
      if (!isModelUnavailable(upstream.status, detail)) break;
      console.warn('Modelo de Groq no disponible, probando el siguiente:', model, upstream.status);
    }

    if (!upstream.ok) {
      // Log para el servidor (visible en Vercel → Logs), sin exponer la key.
      console.error('Error de Groq:', upstream.status, detail);
      return sendJson(res, 502, {
        error: 'El asistente no pudo responder en este momento. Intenta de nuevo en unos segundos.',
        // Solo el código HTTP del proveedor (p. ej. 429 = límite, 401 = key inválida,
        // 404 = modelo retirado), sin detalles internos: facilita el diagnóstico.
        upstreamStatus: upstream.status,
      });
    }

    // --- Rama streaming: reenviamos cada fragmento de texto apenas llega ----
    if (wantsStream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Content-Type-Options', 'nosniff'); // evita que el navegador retenga el texto para "olfatearlo"

      const decoder = new TextDecoder();
      let buffer = '';
      let sent = 0;
      let finishReason = '';

      // Groq envía líneas "data: {json}" (formato OpenAI) y termina con "data: [DONE]".
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk;
        try { chunk = JSON.parse(payload); } catch (_e) { return; }
        const choice = chunk.choices && chunk.choices[0];
        // Solo el texto visible (delta.content); el razonamiento, si llegara, se ignora.
        const text = choice && choice.delta && typeof choice.delta.content === 'string' ? choice.delta.content : '';
        if (text) { res.write(text); sent += text.length; }
        if (choice && choice.finish_reason) finishReason = choice.finish_reason;
      };

      try {
        for await (const piece of upstream.body) {
          buffer += decoder.decode(piece, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            handleLine(buffer.slice(0, nl).replace(/\r$/, ''));
            buffer = buffer.slice(nl + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer) handleLine(buffer.trim());
      } catch (streamErr) {
        // La conexión se cortó a mitad de respuesta: se entrega lo recibido.
        console.error('Stream de Groq interrumpido:', streamErr);
      }

      if (finishReason === 'length') console.warn('Respuesta cortada por tope de tokens', usedModel);
      // Sin texto (p. ej. contenido bloqueado): mensaje amable.
      if (sent === 0) res.write(FALLBACK_REPLY);
      return res.end();
    }

    // --- Rama JSON (sin streaming) -----------------------------------------
    const data = await upstream.json();
    const choice = data && data.choices && data.choices[0];
    const reply = (choice && choice.message && typeof choice.message.content === 'string'
      ? choice.message.content
      : '').trim();

    if (choice && choice.finish_reason === 'length') {
      console.warn('Respuesta cortada por tope de tokens', usedModel, data.usage);
    }

    if (!reply) return sendJson(res, 200, { reply: FALLBACK_REPLY });

    return sendJson(res, 200, { reply });
  } catch (err) {
    console.error('Fallo al contactar a Groq:', err);
    return sendJson(res, 500, {
      error: 'Ocurrió un error inesperado al procesar tu mensaje. Intenta más tarde.',
    });
  }
};
