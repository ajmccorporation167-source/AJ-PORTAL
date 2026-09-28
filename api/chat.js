// =====================================================================
// AJMC RRHH Consulting — POST /api/chat  (Vercel Serverless, Node 18+)
// Usa Google Gemini (plan gratuito). La llave vive SOLO en Vercel.
// Recibe: { messages: [{ role: 'system'|'user'|'assistant', content }] }
// Devuelve: texto plano en streaming (lo que espera tu index.html).
// =====================================================================

const MODEL = 'gemini-2.5-flash';
const ALLOWED_ORIGINS = [
  'https://aj-portal-lovat.vercel.app',
  'https://aj-portal-ajmc1.vercel.app',
  'https://ajmccorporation167-source.github.io',
];
const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;

// Límite básico: 20 mensajes por IP cada 10 minutos
const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length <= 20;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).send('Origen no permitido');

  // Usa la llave que ya guardaste en Vercel (cualquiera de los dos nombres sirve)
  const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).send('Falta la llave de Gemini en Vercel');

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!allowed(ip)) return res.status(429).send('Demasiados mensajes. Intenta en unos minutos.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0 || messages.length > MAX_MESSAGES + 1) {
    return res.status(400).send('Solicitud inválida');
  }

  // Separa el system prompt y convierte el historial al formato de Gemini
  let systemText = '';
  const contents = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string') return res.status(400).send('Solicitud inválida');
    if (m.role === 'system') { systemText = m.content.slice(0, 20000); continue; }
    if (m.role !== 'user' && m.role !== 'assistant') return res.status(400).send('Solicitud inválida');
    if (m.content.length > MAX_CHARS) return res.status(400).send('Mensaje demasiado largo');
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    return res.status(400).send('Solicitud inválida');
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: 800, temperature: 0.4 },
      }),
    }
  ).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    const detail = upstream ? await upstream.text().catch(() => '') : 'sin conexión';
    console.error('Gemini error', upstream?.status, detail);
    return res.status(502).send('El asistente no está disponible ahora.');
  }

  // Reenvía solo el texto al navegador, trozo a trozo
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200);

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const json = JSON.parse(line.slice(5).trim());
        const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        if (text) res.write(text);
      } catch { /* línea incompleta: se ignora */ }
    }
  }
  res.end();
}
