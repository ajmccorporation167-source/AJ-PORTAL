/* =========================================================================
   AJCM | RRHH CONSULTING — INTERACCIONES DEL FRONTEND
   Sin dependencias externas. Respeta prefers-reduced-motion en cada efecto.
   ========================================================================= */
(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -----------------------------------------------------------------------
     1. NAVEGACIÓN MÓVIL (hamburguesa accesible)
     ----------------------------------------------------------------------- */
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isOpen));
      navMenu.classList.toggle('is-open', !isOpen);
      navToggle.setAttribute('aria-label', isOpen ? 'Abrir menú de navegación' : 'Cerrar menú de navegación');
    });

    // Cierra el menú al navegar a una sección (mejora la UX en móvil)
    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        navMenu.classList.remove('is-open');
      });
    });
  }

  /* 2. El reveal al hacer scroll vive en js/motion-reveal.js (Motion) */

  /* -----------------------------------------------------------------------
     3. PARALLAX SUAVE EN EL HERO (solo capas decorativas, nunca el texto)
     ----------------------------------------------------------------------- */
  const heroGlows = document.querySelectorAll('.hero__glow');
  if (!prefersReducedMotion && heroGlows.length) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        heroGlows.forEach((glow, i) => {
          const speed = i === 0 ? 0.12 : 0.08;
          glow.style.transform = `translateY(${y * speed}px)`;
        });
        ticking = false;
      });
    }, { passive: true });
  }

  /* -----------------------------------------------------------------------
     4. TILT 3D EN LAS TARJETAS DE SERVICIO (efecto magnético acotado)
     ----------------------------------------------------------------------- */
  if (!prefersReducedMotion) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      const MAX_TILT = 6; // grados — acotado para que nunca se sienta exagerado

      const onMove = (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;  // 0..1
        const py = (e.clientY - rect.top) / rect.height;  // 0..1
        const ry = (px - 0.5) * (MAX_TILT * 2);
        const rx = (0.5 - py) * (MAX_TILT * 2);
        card.style.setProperty('--tilt-rx', `${rx}deg`);
        card.style.setProperty('--tilt-ry', `${ry}deg`);
        card.style.setProperty('--tilt-y', `-4px`);
      };

      const onLeave = () => {
        card.style.setProperty('--tilt-rx', `0deg`);
        card.style.setProperty('--tilt-ry', `0deg`);
        card.style.setProperty('--tilt-y', `0px`);
      };

      card.addEventListener('pointermove', onMove);
      card.addEventListener('pointerleave', onLeave);
      // Teclado: sin posición de puntero, no se aplica tilt — el foco visible ya cubre la señal de interacción
    });
  }

  /* -----------------------------------------------------------------------
     5. PROTECCIÓN ANTI-SCRAPING DEL CORREO ELECTRÓNICO
     El correo nunca existe como texto plano en el HTML servido; se construye
     en memoria a partir de dos atributos data-* y se inyecta al cargar.
     ----------------------------------------------------------------------- */
  const emailDisplay = document.getElementById('emailDisplay');
  let fullEmail = '';

  if (emailDisplay) {
    const user = emailDisplay.getAttribute('data-user') || '';
    const domain = emailDisplay.getAttribute('data-domain') || '';
    fullEmail = `${user}@${domain}`;
    emailDisplay.textContent = fullEmail;
  }

  /* -----------------------------------------------------------------------
     6. COPIAR CORREO AL PORTAPAPELES (con tooltip de confirmación)
     ----------------------------------------------------------------------- */
  const copyEmailBtn = document.getElementById('copyEmailBtn');
  const copyTooltip = document.getElementById('copyTooltip');

  if (copyEmailBtn && copyTooltip) {
    copyEmailBtn.addEventListener('click', async () => {
      if (!fullEmail) return;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(fullEmail);
        } else {
          // Fallback para contextos sin Clipboard API (http local, navegadores viejos)
          const tempInput = document.createElement('textarea');
          tempInput.value = fullEmail;
          tempInput.setAttribute('readonly', '');
          tempInput.style.position = 'absolute';
          tempInput.style.left = '-9999px';
          document.body.appendChild(tempInput);
          tempInput.select();
          document.execCommand('copy');
          document.body.removeChild(tempInput);
        }

        copyTooltip.textContent = '¡Copiado!';
        copyTooltip.classList.add('is-visible');
        setTimeout(() => copyTooltip.classList.remove('is-visible'), 2000);
      } catch (err) {
        copyTooltip.textContent = 'No se pudo copiar';
        copyTooltip.classList.add('is-visible');
        setTimeout(() => copyTooltip.classList.remove('is-visible'), 2000);
      }
    });
  }

  /* -----------------------------------------------------------------------
     7. VALIDACIÓN DEL FORMULARIO DE CONTACTO
        Este listener solo valida. Si falla, stopImmediatePropagation() impide
        que el listener de js/supabase.js envíe datos vacíos o inválidos.
     ----------------------------------------------------------------------- */
  const leadForm = document.getElementById('leadForm');
  const formStatus = document.getElementById('formStatus');

  const VALIDATORS = {
    fieldName: (v) => v.trim().length >= 2 || 'Ingresa tu nombre completo.',
    fieldCompany: (v) => v.trim().length >= 2 || 'Ingresa el nombre de tu empresa.',
    fieldEmail: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Ingresa un correo electrónico válido.',
    fieldPhone: (v) => v.trim() === '' || /^[0-9+()\-\s]{7,15}$/.test(v.trim()) || 'Ingresa un teléfono válido.',
    fieldService: (v) => v.trim() !== '' || 'Selecciona un servicio de interés.',
  };

  function validateField(field) {
    const validator = VALIDATORS[field.id];
    if (!validator) return true;

    const result = validator(field.value);
    const errorEl = document.getElementById(`error-${field.id}`);
    const wrapper = field.closest('.field');

    if (result === true) {
      if (errorEl) errorEl.textContent = '';
      if (wrapper) wrapper.classList.remove('has-error');
      return true;
    }

    if (errorEl) errorEl.textContent = result;
    if (wrapper) wrapper.classList.add('has-error');
    return false;
  }

  if (leadForm) {
    // Validación en vivo al salir de cada campo (mejor UX que solo al enviar)
    Object.keys(VALIDATORS).forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.addEventListener('blur', () => validateField(field));
    });

    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();

      let isValid = true;
      Object.keys(VALIDATORS).forEach((id) => {
        const field = document.getElementById(id);
        if (field && !validateField(field)) isValid = false;
      });

      if (!isValid) {
        // Detener la propagación para que supabase.js NO intente enviar datos inválidos
        e.stopImmediatePropagation();
        if (formStatus) {
          formStatus.textContent = 'Revisa los campos marcados en rojo antes de continuar.';
          formStatus.style.color = '#f0a0a0';
        }
        // Enfoca el primer campo con error para navegación por teclado/lectores de pantalla
        const firstError = leadForm.querySelector('.has-error input, .has-error select, .has-error textarea');
        if (firstError) firstError.focus();
        return;
      }

      // La validación pasó. El envío real a Supabase lo maneja js/supabase.js
      // que escucha el mismo evento submit. No hacemos reset aquí — supabase.js
      // se encarga de todo el ciclo post-validación.
      // (Este listener solo valida; el siguiente en la cadena hace el POST.)
    });
  }

  /* -----------------------------------------------------------------------
     8. AÑO ACTUAL EN EL FOOTER
     ----------------------------------------------------------------------- */
  const yearEl = document.getElementById('currentYear');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
