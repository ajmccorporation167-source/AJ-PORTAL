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
// Modelo: gemini-2.0-flash es rápido y económico. Si quieres otro, cámbialo aquí.
const GEMINI_MODEL = 'gemini-2.0-flash';
// La key va como query param (?key=), NO en headers. El header x-goog-api-key
// solo funciona con OAuth / service accounts, no con API keys públicas de AI Studio.
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Límites defensivos para controlar costo y abuso.
const MAX_MESSAGES = 20;       // cuántos turnos aceptamos en una conversación
const MAX_CHARS_PER_MSG = 2000; // largo máximo por mensaje del usuario

// --- Instrucciones del agente (System Prompt interno) ----------------------
// Prohíbe alucinar, lo ancla a los servicios de AJCM y fuerza el disclaimer legal.
const SYSTEM_PROMPT = `Eres el Asistente Virtual de AJCM RRHH Consulting, una firma boutique de
consultoría en Recursos Humanos y gestión empresarial con base en San Juan y Bayamón, Puerto Rico,
fundada por Alexis J. Mercado Colón (registrada bajo NAICS 541611).

SERVICIOS QUE OFRECE LA FIRMA (son los únicos que puedes recomendar):
1. Auditorías de cumplimiento de RRHH.
2. Redacción de manuales corporativos y políticas internas.
3. Ley 80 y relaciones obrero-patronales.
4. Optimización y administración de nómina.
5. Reclutamiento y selección de talento.
6. Adiestramientos organizacionales.

REGLAS ESTRICTAS:
- Responde SIEMPRE en español, con tono profesional, claro y cercano.
- NO inventes datos, precios, plazos, números de teléfono ni direcciones que no tengas. Si no lo sabes, dilo y dirige a la persona a los canales de contacto del portal (formulario, WhatsApp, correo o el calendario de consulta).
- Mantente dentro del ámbito de AJCM RRHH Consulting y la gestión de personal. Si te preguntan algo fuera de tema, redirígelo con amabilidad hacia cómo la firma puede ayudar.
- NO brindas asesoramiento legal formal. Explica conceptos de forma general y, para decisiones concretas, recomienda agendar una consulta con un consultor de AJCM.
- Sé conciso: respuestas de 2 a 5 oraciones salvo que pidan más detalle.

DISCLAIMER OBLIGATORIO: Cuando des información sobre leyes laborales (Ley 80, FLSA, despidos, nómina, etc.), aclara que es orientación general y NO sustituye asesoría legal formal, e invita a agendar una consulta.`;

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
      maxOutputTokens: 800,
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
      // Log para el servidor (visible solo en Vercel), sin exponer la key.
      const detail = await upstream.text();
      console.error('Error de Gemini:', upstream.status, detail);
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
