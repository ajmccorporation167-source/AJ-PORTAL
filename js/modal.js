/* =========================================================================
   modal.js — Modal de dos pasos, reveal al scroll, efecto magnético
   y guarda de configuración de WhatsApp.
   Aditivo: no modifica main.js ni supabase.js. Al terminar el paso 2 rellena
   #leadForm y lo envía con requestSubmit(), así el flujo real a Supabase
   (validación + inserción + correo) sigue siendo el de supabase.js.
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------------------------------------------------------------------
     1. Contenido del paso 1 por servicio (las claves coinciden con el <select>)
     --------------------------------------------------------------------- */
  var SERVICES = {
    auditoria: {
      name: 'Auditoría de Cumplimiento de RRHH',
      question: '¿Qué quieres revisar primero?',
      options: [
        'Expedientes de empleados y documentación',
        'Contratos, políticas y manual vigente',
        'Todo lo anterior: diagnóstico completo'
      ]
    },
    manual: {
      name: 'Manual Corporativo y Políticas',
      question: '¿Qué necesita tu empresa?',
      options: [
        'Crear el manual del empleado desde cero',
        'Actualizar un manual que ya tenemos',
        'Políticas específicas (acoso, asistencia, uso de tecnología)'
      ]
    },
    ley80: {
      name: 'Ley 80 y Relaciones Obrero-Patronales',
      question: '¿Cuál es tu situación?',
      options: [
        'Evaluar un despido antes de ejecutarlo',
        'Calcular o revisar una mesada',
        'Atender una querella o disputa laboral activa'
      ]
    },
    nomina: {
      name: 'Nómina',
      question: '¿Dónde necesitas ayuda?',
      options: [
        'Clasificación de empleados (exento / no exento)',
        'Revisión de retenciones y cumplimiento',
        'Administración completa de la nómina'
      ]
    },
    reclutamiento: {
      name: 'Reclutamiento y Selección',
      question: '¿Qué necesitas cubrir?',
      options: [
        'Una o dos posiciones puntuales',
        'Varias posiciones o un equipo nuevo',
        'Definir el perfil y el proceso de selección'
      ]
    },
    adiestramiento: {
      name: 'Adiestramientos Organizacionales',
      question: '¿A quién va dirigido?',
      options: [
        'Supervisores y gerencia (liderazgo)',
        'Todo el personal (prevención de acoso, cumplimiento)',
        'Un equipo específico'
      ]
    }
  };

  /* ---------------------------------------------------------------------
     2. Modal
     --------------------------------------------------------------------- */
  var modal = document.getElementById('serviceModal');
  if (modal) {
    var panel = modal.querySelector('.modal__panel');
    var titleEl = document.getElementById('modalTitle');
    var progressEl = document.getElementById('modalProgress');
    var barEl = document.getElementById('modalBar');
    var step1 = document.getElementById('modalStep1');
    var step2 = document.getElementById('modalStep2');
    var optionsEl = document.getElementById('modalOptions');
    var err1 = document.getElementById('modalError1');
    var nextBtn = document.getElementById('modalNext');
    var backBtn = document.getElementById('modalBack');

    var current = null;      // clave del servicio abierto
    var lastTrigger = null;  // para devolver el foco al cerrar

    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

    function renderStep1(key) {
      var data = SERVICES[key];
      titleEl.textContent = data.question;
      // Se limpia manteniendo el <legend> (primer hijo)
      while (optionsEl.children.length > 1) optionsEl.removeChild(optionsEl.lastChild);
      data.options.forEach(function (text, i) {
        var wrap = document.createElement('div');
        wrap.className = 'modal__option';
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'modalNeed';
        input.id = 'need-' + i;
        input.value = text;
        var label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = text;
        wrap.appendChild(input);
        wrap.appendChild(label);
        optionsEl.appendChild(wrap);
      });
    }

    function showStep(n) {
      var isOne = n === 1;
      step1.hidden = !isOne;
      step2.hidden = isOne;
      progressEl.textContent = 'Paso ' + n + ' de 2';
      barEl.style.width = isOne ? '50%' : '100%';
      titleEl.textContent = isOne ? SERVICES[current].question : 'Déjanos tus datos de contacto';
      var target = panel.querySelector(isOne ? 'input[type="radio"]' : '#mName');
      if (target) target.focus();
    }

    function openModal(key, trigger) {
      if (!SERVICES[key]) return;
      current = key;
      lastTrigger = trigger;
      err1.textContent = '';
      step2.reset();
      clearStep2Errors();
      renderStep1(key);
      modal.hidden = false;
      document.body.classList.add('modal-open');
      showStep(1);
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
    }

    // Apertura desde los botones dorados
    document.querySelectorAll('.service-card__cta').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn.getAttribute('data-service'), btn);
      });
    });

    // Cierre: backdrop, botones con data-modal-close y Escape
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-modal-close]')) closeModal();
    });

    // Trampa de foco + Escape
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(panel.querySelectorAll(FOCUSABLE), function (el) {
        return el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Paso 1 → 2
    nextBtn.addEventListener('click', function () {
      if (!optionsEl.querySelector('input:checked')) {
        err1.textContent = 'Selecciona una opción para continuar.';
        return;
      }
      err1.textContent = '';
      showStep(2);
    });
    optionsEl.addEventListener('change', function () { err1.textContent = ''; });

    backBtn.addEventListener('click', function () { showStep(1); });

    // Validación del paso 2
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var fields = [
      { id: 'mName', err: 'mErrName', msg: 'Escribe tu nombre completo.', test: function (v) { return v.trim().length >= 2; } },
      { id: 'mCompany', err: 'mErrCompany', msg: 'Escribe el nombre de tu empresa.', test: function (v) { return v.trim().length >= 2; } },
      { id: 'mEmail', err: 'mErrEmail', msg: 'Escribe un correo válido.', test: function (v) { return EMAIL_RE.test(v.trim()); } }
    ];

    function clearStep2Errors() {
      fields.forEach(function (f) {
        document.getElementById(f.err).textContent = '';
        document.getElementById(f.id).removeAttribute('aria-invalid');
      });
    }

    function setValue(el, value) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    step2.addEventListener('submit', function (e) {
      e.preventDefault();
      clearStep2Errors();
      var firstBad = null;
      fields.forEach(function (f) {
        var input = document.getElementById(f.id);
        if (!f.test(input.value)) {
          document.getElementById(f.err).textContent = f.msg;
          input.setAttribute('aria-invalid', 'true');
          if (!firstBad) firstBad = input;
        }
      });
      if (firstBad) { firstBad.focus(); return; }

      var need = optionsEl.querySelector('input:checked').value;
      var form = document.getElementById('leadForm');
      if (!form) return;

      // Se rellena el formulario real (misma tubería: validación + Supabase + correo)
      setValue(form.elements.fullName, document.getElementById('mName').value.trim());
      setValue(form.elements.company, document.getElementById('mCompany').value.trim());
      setValue(form.elements.email, document.getElementById('mEmail').value.trim());
      setValue(form.elements.service, current);
      setValue(form.elements.message, 'Necesidad indicada (' + SERVICES[current].name + '): ' + need);

      closeModal();
      var section = document.getElementById('contacto');
      if (section) {
        // Con Lenis activo (js/smooth-scroll.js) desplazamos con su misma inercia
        if (window.lenis) window.lenis.scrollTo(section);
        else section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }

      // requestSubmit dispara el evento "submit" que escucha supabase.js
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  /* ---------------------------------------------------------------------
     3. Reveal al hacer scroll (IntersectionObserver)
     --------------------------------------------------------------------- */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------------------------------------------------------------------
     4. Efecto magnético en botones (solo puntero fino y sin reduced-motion)
     --------------------------------------------------------------------- */
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
        var dy = (e.clientY - (r.top + r.height / 2)) * 0.22;
        el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    });
  }

  /* ---------------------------------------------------------------------
     5. Guarda: WhatsApp con número sin configurar
     --------------------------------------------------------------------- */
  var wa = document.getElementById('whatsappBtn');
  if (wa && /wa\.me\/1X+/i.test(wa.getAttribute('href') || '')) {
    wa.setAttribute('aria-disabled', 'true');
    wa.setAttribute('tabindex', '-1');
    wa.addEventListener('click', function (e) { e.preventDefault(); });
    if (window.console) console.warn('[AJCM] WhatsApp deshabilitado: reemplaza 1XXXXXXXXXX en index.html por el número real.');
  }
})();
