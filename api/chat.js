/* =========================================================================
   AJCM | RRHH CONSULTING — FUNCIÓN SERVERLESS DEL ASISTENTE (Gemini)
   -------------------------------------------------------------------------
   Esta función corre EN EL SERVIDOR de Vercel, nunca en el navegador.
   Por eso aquí es seguro leer la API key: el visitante jamás la ve.

   Ruta pública: /api/chat   (Vercel enruta /api/*.js automáticamente)
   Método: POST
   Body esperado (JSON): { "messages": [ { "role": "user"|"assistant", "content": "..." }, ... ],
                           "stream": true|false (opcional) }
   Respuesta sin stream:  JSON { "reply": "texto del asistente" }
   Respuesta con stream:  text/plain enviado por fragmentos a medida que Gemini
                          genera (las primeras palabras llegan en menos de un segundo).
   Los errores previos a la generación siempre se devuelven como JSON { "error" }.

   Cero dependencias externas: usamos el `fetch` nativo de Node 18+ contra la
   API REST de Gemini. No hace falta package.json ni `npm install`.
   ========================================================================= */

'use strict';

// --- Configuración ---------------------------------------------------------
// Modelo: se puede cambiar sin tocar código con la variable GEMINI_MODEL en Vercel.
// (Google retira modelos viejos; si un modelo deja de existir, la API responde 404 NOT_FOUND.)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// La key va como query param (?key=), NO en headers. El header x-goog-api-key
// solo funciona con OAuth / service accounts, no con API keys públicas de AI Studio.
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
// Streaming: Gemini envía la respuesta por fragmentos como Server-Sent Events (alt=sse).
const GEMINI_STREAM = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

// Variantes para minimizar el "razonamiento interno" (thinking) del modelo, de la
// más rápida a la más conservadora. null = sin thinkingConfig (comportamiento por defecto).
const THINKING_VARIANTS = [
  { thinkingLevel: 'minimal' }, // familia Gemini 3
  { thinkingBudget: 0 },        // familia Gemini 2.5
  null,
];
let thinkingVariant = -1; // índice que funcionó; se conserva entre invocaciones "calientes"

// Límites defensivos para controlar costo y abuso.
const MAX_MESSAGES = 20;       // cuántos turnos aceptamos en una conversación
const MAX_CHARS_PER_MSG = 2000; // largo máximo por mensaje del usuario

// --- Instrucciones del agente (System Prompt interno) ----------------------
// Prohíbe alucinar, lo ancla a los servicios de AJCM y fuerza el disclaimer legal.
const SYSTEM_PROMPT = `Eres el Asistente Ejecutivo de AJCM. Responde de forma muy natural y humana. REGLA DE ORO:
Tus respuestas deben ser extremadamente concisas, de máximo 2 oraciones. Ve directo al grano. Eres un experto
en RRHH rápido y eficiente. No uses listas.

CONTEXTO: AJCM RRHH Consulting es una firma boutique de consultoría en Recursos Humanos y gestión
empresarial con base en San Juan y Bayamón, Puerto Rico, fundada por Alexis J. Mercado Colón
(registrada bajo NAICS 541611).

SERVICIOS QUE OFRECE LA FIRMA (son los únicos que puedes recomendar):
auditorías de cumplimiento de RRHH; manuales corporativos y políticas internas; Ley 80 y relaciones
obrero-patronales; optimización y administración de nómina; reclutamiento y selección de talento;
adiestramientos organizacionales.

ESTILO:
- Responde SIEMPRE en español, como lo haría un consultor senior en una conversación real.
- Nada de saludos de relleno, frases hechas de IA ni repetir la pregunta. Ve directo a la respuesta.
- Cuando tenga sentido, cierra con una sola pregunta breve o un siguiente paso concreto.

REGLAS QUE NO CAMBIAN:
- NO inventes datos, precios, plazos, números de teléfono ni direcciones que no tengas. Si no lo sabes, dilo y dirige a la persona a los canales del portal (formulario de contacto, WhatsApp o correo).
- Mantente dentro del ámbito de AJCM y la gestión de personal; si te preguntan algo fuera de tema, redirígelo con naturalidad.
- NO brindas asesoramiento legal formal. Para decisiones concretas, recomienda agendar una consulta.
- Cuando hables de leyes laborales (Ley 80, FLSA, despidos, nómina, etc.), añade en pocas palabras que es orientación general, no asesoría legal formal.`;

// --- Utilidad: respuesta JSON uniforme -------------------------------------
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// Extrae el texto visible de un fragmento/respuesta de Gemini, excluyendo las
// partes de razonamiento interno (thought: true) si el modelo las devolviera.
function extractText(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  return parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

const FALLBACK_REPLY =
  'Lo siento, no pude generar una respuesta para eso. ¿Puedo ayudarte con alguno de nuestros servicios de RRHH, o prefieres agendar una consulta directa?';

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No filtramos detalles internos; solo avisamos que falta configuración.
    return sendJson(res, 500, {
      error: 'El asistente no está configurado todavía. Falta la variable GEMINI_API_KEY en el servidor.',
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

  // Convertimos el historial al formato de Gemini:
  //   nuestro "assistant"  ->  "model"
  //   nuestro "user"       ->  "user"
  const contents = [];
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.slice(0, MAX_CHARS_PER_MSG).trim();
    if (!text) continue;
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }

  if (contents.length === 0) {
    return sendJson(res, 400, { error: 'No hay contenido de usuario válido para procesar.' });
  }

  // Cuerpo base de la petición a Gemini.
  const baseBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      temperature: 0.4,     // bajo = respuestas directas y fieles
      // Tope de seguridad, no de velocidad: el modelo se detiene al terminar sus
      // ~2 oraciones. Con 150 el "razonamiento interno" del modelo se comía el
      // presupuesto y las respuestas salían cortadas ("Revis…").
      maxOutputTokens: 300,
      topP: 0.9,
    },
    // Filtros de seguridad de Gemini en umbral estándar.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  try {
    // La key va como query parameter — es el método oficial para API keys de
    // AI Studio contra el endpoint REST. La URL nunca se expone al navegador
    // porque esta función corre en el servidor de Vercel.
    const url = wantsStream
      ? `${GEMINI_STREAM}?alt=sse&key=${encodeURIComponent(apiKey)}`
      : `${GEMINI_BASE}?key=${encodeURIComponent(apiKey)}`;

    // LATENCIA: los modelos Flash recientes "piensan" antes de responder y eso
    // es lo que más tarda. Intentamos minimizarlo; como cada generación de
    // modelos acepta un parámetro distinto, probamos en orden y recordamos el
    // que funcionó mientras la función siga "caliente" en Vercel.
    let upstream;
    let detail = '';
    const start = thinkingVariant >= 0 ? thinkingVariant : 0;
    for (let v = start; v < THINKING_VARIANTS.length; v++) {
      const body = { ...baseBody, generationConfig: { ...baseBody.generationConfig } };
      if (THINKING_VARIANTS[v]) body.generationConfig.thinkingConfig = THINKING_VARIANTS[v];
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (upstream.ok) { thinkingVariant = v; break; }
      detail = await upstream.text();
      // Solo un 400 por parámetro no soportado justifica probar la siguiente variante.
      if (upstream.status !== 400 || !/thinking/i.test(detail)) break;
    }

    if (!upstream.ok) {
      // Log para el servidor (visible en Vercel → Logs), sin exponer la key.
      // Si Google retira el modelo, aquí aparece un 404 NOT_FOUND con el sustituto recomendado.
      console.error('Error de Gemini:', upstream.status, GEMINI_MODEL, detail);
      return sendJson(res, 502, {
        error: 'El asistente no pudo responder en este momento. Intenta de nuevo en unos segundos.',
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
      let usage = null;

      // Gemini (alt=sse) envía líneas "data: {json}" separadas por líneas en blanco.
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        let chunk;
        try { chunk = JSON.parse(payload); } catch (_e) { return; }
        const text = extractText(chunk);
        if (text) { res.write(text); sent += text.length; }
        const c = chunk.candidates && chunk.candidates[0];
        if (c && c.finishReason) finishReason = c.finishReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
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
        // La conexión con Gemini se cortó a mitad de respuesta: se entrega lo recibido.
        console.error('Stream de Gemini interrumpido:', streamErr);
      }

      if (finishReason === 'MAX_TOKENS') {
        console.warn('Respuesta cortada por MAX_TOKENS', GEMINI_MODEL, usage);
      }
      // Sin texto (p. ej. bloqueado por filtros de seguridad): mensaje amable.
      if (sent === 0) res.write(FALLBACK_REPLY);
      return res.end();
    }

    // --- Rama JSON (sin streaming) -----------------------------------------
    const data = await upstream.json();
    const candidate = data && data.candidates && data.candidates[0];
    const reply = extractText(data).trim();

    if (candidate && candidate.finishReason === 'MAX_TOKENS') {
      // Diagnóstico en Vercel → Logs si una respuesta vuelve a cortarse.
      console.warn('Respuesta cortada por MAX_TOKENS', GEMINI_MODEL, data.usageMetadata);
    }

    // Sin texto: puede ocurrir si el contenido fue bloqueado por los filtros de seguridad.
    if (!reply) return sendJson(res, 200, { reply: FALLBACK_REPLY });

    return sendJson(res, 200, { reply });
  } catch (err) {
    console.error('Fallo al contactar a Gemini:', err);
    return sendJson(res, 500, {
      error: 'Ocurrió un error inesperado al procesar tu mensaje. Intenta más tarde.',
    });
  }
};
