/* =========================================================================
   AJCM | RRHH CONSULTING — FUNCIÓN SERVERLESS DEL ASISTENTE (Gemini)
   -------------------------------------------------------------------------
   Esta función corre EN EL SERVIDOR de Vercel, nunca en el navegador.
   Por eso aquí es seguro leer la API key: el visitante jamás la ve.

   Ruta pública: /api/chat   (Vercel enruta /api/*.js automáticamente)
   Método: POST
   Body esperado (JSON): { "messages": [ { "role": "user"|"assistant", "content": "..." }, ... ] }
   Respuesta (JSON):      { "reply": "texto del asistente" }

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

// Límites defensivos para controlar costo y abuso.
const MAX_MESSAGES = 20;       // cuántos turnos aceptamos en una conversación
const MAX_CHARS_PER_MSG = 2000; // largo máximo por mensaje del usuario

// --- Instrucciones del agente (System Prompt interno) ----------------------
// Prohíbe alucinar, lo ancla a los servicios de AJCM y fuerza el disclaimer legal.
const SYSTEM_PROMPT = `Eres el Asistente Ejecutivo de AJCM. Responde de manera extremadamente natural,
humana, conversacional y directa. NO suenes como un robot genérico de IA. Sé muy conciso, directo al
grano y utiliza un tono profesional pero cercano. Evita listas largas a menos que se soliciten estrictamente.

CONTEXTO: AJCM RRHH Consulting es una firma boutique de consultoría en Recursos Humanos y gestión
empresarial con base en San Juan y Bayamón, Puerto Rico, fundada por Alexis J. Mercado Colón
(registrada bajo NAICS 541611).

SERVICIOS QUE OFRECE LA FIRMA (son los únicos que puedes recomendar):
auditorías de cumplimiento de RRHH; manuales corporativos y políticas internas; Ley 80 y relaciones
obrero-patronales; optimización y administración de nómina; reclutamiento y selección de talento;
adiestramientos organizacionales.

ESTILO:
- Responde SIEMPRE en español, como lo haría un consultor senior en una conversación real.
- Por defecto, 1 a 3 oraciones. Amplía solo si la persona lo pide.
- Nada de saludos de relleno, frases hechas de IA ni repetir la pregunta. Ve directo a la respuesta.
- Cuando tenga sentido, cierra con una sola pregunta breve o un siguiente paso concreto.

REGLAS QUE NO CAMBIAN:
- NO inventes datos, precios, plazos, números de teléfono ni direcciones que no tengas. Si no lo sabes, dilo y dirige a la persona a los canales del portal (formulario, WhatsApp, correo o calendario).
- Mantente dentro del ámbito de AJCM y la gestión de personal; si te preguntan algo fuera de tema, redirígelo con naturalidad.
- NO brindas asesoramiento legal formal. Para decisiones concretas, recomienda agendar una consulta.
- Cuando hables de leyes laborales (Ley 80, FLSA, despidos, nómina, etc.), aclara en una frase corta que es orientación general y no sustituye asesoría legal formal.`;

// --- Utilidad: respuesta JSON uniforme -------------------------------------
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
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

  // Cuerpo de la petición a Gemini.
  const geminiBody = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: {
      temperature: 0.4,     // bajo = respuestas más fieles, menos "creativas"
      maxOutputTokens: 400, // respuestas cortas = menos tokens generados = chat más rápido
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
    const upstream = await fetch(`${GEMINI_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    if (!upstream.ok) {
      // Log para el servidor (visible en Vercel → Logs), sin exponer la key.
      const detail = await upstream.text();
      // Si Google retira el modelo, aquí aparece un 404 NOT_FOUND con el sustituto recomendado.
      console.error('Error de Gemini:', upstream.status, GEMINI_MODEL, detail);
      return sendJson(res, 502, {
        error: 'El asistente no pudo responder en este momento. Intenta de nuevo en unos segundos.',
      });
    }

    const data = await upstream.json();

    // Extracción segura del texto de respuesta.
    const reply =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!reply) {
      // Puede ocurrir si el contenido fue bloqueado por los filtros de seguridad.
      return sendJson(res, 200, {
        reply:
          'Lo siento, no pude generar una respuesta para eso. ¿Puedo ayudarte con alguno de nuestros servicios de RRHH, o prefieres agendar una consulta directa?',
      });
    }

    return sendJson(res, 200, { reply: reply.trim() });
  } catch (err) {
    console.error('Fallo al contactar a Gemini:', err);
    return sendJson(res, 500, {
      error: 'Ocurrió un error inesperado al procesar tu mensaje. Intenta más tarde.',
    });
  }
};
