/* =========================================================================
   AJCM | RRHH CONSULTING — ASISTENTE VIRTUAL (lógica del chat)
   -------------------------------------------------------------------------
   Sin dependencias externas. Inyecta el widget en el DOM, maneja la
   conversación y llama a la función serverless /api/chat (que esconde la
   API key de Gemini en el servidor). Respeta prefers-reduced-motion.
   ========================================================================= */
(() => {
  'use strict';

  // Endpoint de nuestra función serverless (NO llamamos a Google directo desde
  // el navegador: eso expondría la key). Solo funciona en Vercel o con `vercel dev`.
  const API_URL = '/api/chat';

  // Mensaje de bienvenida (solo visual; no se envía como historial a la IA).
  const GREETING =
    '¡Hola! Soy el asistente virtual de AJCM RRHH Consulting. ' +
    'Puedo orientarte sobre auditorías de cumplimiento, manuales, Ley 80, ' +
    'nómina, reclutamiento y adiestramientos. ¿En qué te ayudo?';

  // Historial real de la conversación que se envía a la IA.
  // Formato: { role: 'user' | 'assistant', content: string }
  const history = [];
  let isSending = false;

  /* ---------------------------------------------------------------------
     1. CONSTRUIR EL WIDGET (launcher + panel) e inyectarlo en <body>
     --------------------------------------------------------------------- */
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'chat-launcher';
  launcher.id = 'chatLauncher';
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'chatPanel');
  launcher.innerHTML = `
    <svg class="chat-launcher__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9M7.5 12h5.25M21 11.25c0 4.28-4.03 7.75-9 7.75-1.02 0-2-.15-2.92-.42L3 20.25l1.4-3.64A7.33 7.33 0 0 1 3 11.25C3 6.97 7.03 3.5 12 3.5s9 3.47 9 7.75Z"/>
    </svg>
    <span>Asistente AJCM</span>
    <span class="chat-launcher__pulse" aria-hidden="true"></span>
  `;

  const panel = document.createElement('section');
  panel.className = 'chat-panel';
  panel.id = 'chatPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'Asistente virtual de AJCM RRHH Consulting');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <header class="chat-header">
      <span class="chat-header__avatar" aria-hidden="true">AJ</span>
      <span class="chat-header__meta">
        <span class="chat-header__title">Asistente AJCM</span>
        <span class="chat-header__status">RRHH Consulting · Puerto Rico</span>
      </span>
      <button type="button" class="chat-header__close" id="chatClose" aria-label="Cerrar chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18"/>
        </svg>
      </button>
    </header>

    <div class="chat-messages" id="chatMessages" role="log" aria-live="polite" aria-atomic="false"></div>

    <div class="chat-input">
      <form class="chat-input__row" id="chatForm">
        <textarea
          id="chatText"
          rows="1"
          placeholder="Escribe tu pregunta…"
          aria-label="Escribe tu mensaje"
          maxlength="2000"
        ></textarea>
        <button type="submit" class="chat-input__send" id="chatSend" aria-label="Enviar mensaje">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/>
          </svg>
        </button>
      </form>
      <p class="chat-disclaimer">
        Orientación general de RRHH. No sustituye asesoría legal formal.
      </p>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  // Referencias internas
  const messagesEl = panel.querySelector('#chatMessages');
  const formEl = panel.querySelector('#chatForm');
  const textEl = panel.querySelector('#chatText');
  const sendEl = panel.querySelector('#chatSend');
  const closeEl = panel.querySelector('#chatClose');

  /* ---------------------------------------------------------------------
     2. UTILIDADES DE UI
     --------------------------------------------------------------------- */
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Crea una burbuja de mensaje. `type`: 'bot' | 'user' | 'error'
  function addBubble(text, type) {
    const bubble = document.createElement('div');
    bubble.className = `chat-msg chat-msg--${type}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.id = 'chatTyping';
    typing.setAttribute('aria-label', 'El asistente está escribiendo');
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    scrollToBottom();
  }

  function hideTyping() {
    const typing = messagesEl.querySelector('#chatTyping');
    if (typing) typing.remove();
  }

  // Autoajuste de altura del textarea
  function autoGrow() {
    textEl.style.height = 'auto';
    textEl.style.height = Math.min(textEl.scrollHeight, 110) + 'px';
  }

  /* ---------------------------------------------------------------------
     3. ABRIR / CERRAR
     --------------------------------------------------------------------- */
  let greeted = false;

  function openChat() {
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.classList.add('is-hidden');
    launcher.setAttribute('aria-expanded', 'true');

    // La primera vez, mostramos el saludo.
    if (!greeted) {
      addBubble(GREETING, 'bot');
      greeted = true;
    }
    setTimeout(() => textEl.focus(), 100);
  }

  function closeChat() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    launcher.classList.remove('is-hidden');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', openChat);
  closeEl.addEventListener('click', closeChat);

  // Esc cierra el chat
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) closeChat();
  });

  /* ---------------------------------------------------------------------
     4. ENVIAR MENSAJE A LA IA
     --------------------------------------------------------------------- */
  async function sendMessage(text) {
    if (isSending) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    isSending = true;
    sendEl.disabled = true;

    // Pinta el mensaje del usuario y lo guarda en el historial.
    addBubble(trimmed, 'user');
    history.push({ role: 'user', content: trimmed });

    // Limpia el input.
    textEl.value = '';
    autoGrow();

    showTyping();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // stream: true → el servidor envía el texto por fragmentos a medida que se genera.
        body: JSON.stringify({ messages: history, stream: true }),
      });

      // --- Respuesta en streaming: pintamos el texto a medida que llega ---------
      const contentType = res.headers.get('Content-Type') || '';
      if (res.ok && res.body && contentType.includes('text/plain')) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let bubble = null;
        let full = '';
        // aria-busy: los lectores de pantalla esperan a que termine para leer la
        // respuesta completa, en vez de anunciar cada fragmento.
        messagesEl.setAttribute('aria-busy', 'true');
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const piece = decoder.decode(value, { stream: true });
            if (!piece) continue;
            full += piece;
            if (!bubble) {
              hideTyping(); // los puntos se quitan con la primera palabra, no antes
              bubble = addBubble('', 'bot');
            }
            bubble.textContent = full;
            scrollToBottom();
          }
          full += decoder.decode();
        } finally {
          messagesEl.removeAttribute('aria-busy');
          hideTyping();
        }

        full = full.trim();
        if (!full) {
          addBubble('No pude responder en este momento. Intenta de nuevo, o escríbenos por WhatsApp.', 'error');
          return;
        }
        if (bubble) bubble.textContent = full;
        history.push({ role: 'assistant', content: full });
        return;
      }

      hideTyping();

      // --- Respuesta JSON (errores, o servidor sin streaming) -------------------
      // Leemos como texto primero: si Vercel devuelve una página HTML (404, crash
      // de la función) en vez de JSON, así lo vemos en la consola.
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch (_e) {
        console.error('[AJCM chat] La respuesta de /api/chat no es JSON. Status:', res.status, '\n', raw.slice(0, 500));
      }

      if (!res.ok || !data.reply) {
        console.groupCollapsed(`[AJCM chat] Error ${res.status} en ${API_URL}`);
        console.error('Respuesta completa:', data);
        if (res.status === 502) {
          console.error('502: Gemini rechazó la petición. La causa exacta está en Vercel → Logs ("Error de Gemini").');
        } else if (res.status === 404) {
          console.error('404: Vercel no encontró la función /api/chat (¿api/chat.js no se desplegó?).');
        } else if (res.status === 500 && /GEMINI_API_KEY/.test(data.error || '')) {
          console.error('Falta GEMINI_API_KEY en el entorno de Vercel (o no se hizo redeploy después de añadirla).');
        }
        console.groupEnd();

        const msg =
          (data && data.error) ||
          'No pude responder en este momento. Intenta de nuevo, o escríbenos por WhatsApp.';
        addBubble(msg, 'error');
        // No guardamos el error en el historial para no contaminar la conversación.
        return;
      }

      addBubble(data.reply, 'bot');
      history.push({ role: 'assistant', content: data.reply });
    } catch (err) {
      // fetch solo lanza aquí por red caída, CORS o bloqueo por CSP/extensiones.
      console.error('[AJCM chat] fetch falló antes de recibir respuesta (red, CORS o CSP):', err);
      hideTyping();
      addBubble(
        'Hubo un problema de conexión. Revisa tu internet e intenta otra vez.',
        'error'
      );
    } finally {
      isSending = false;
      sendEl.disabled = false;
      textEl.focus();
    }
  }

  /* ---------------------------------------------------------------------
     5. EVENTOS DEL FORMULARIO
     --------------------------------------------------------------------- */
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(textEl.value);
  });

  // Enter envía; Shift+Enter hace salto de línea.
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(textEl.value);
    }
  });

  textEl.addEventListener('input', autoGrow);
})();
