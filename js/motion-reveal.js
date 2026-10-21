/* =========================================================================
   AJCM | RRHH CONSULTING — COREOGRAFÍA DE ENTRADA Y REVEAL AL SCROLL
   Motion 13.4.6 (copia local en js/vendor/, sin CDN).
   · Hero: AJCM aterriza primero y "RR HH" una fracción de segundo después.
   · Scroll: los bloques [data-reveal] y .reveal flotan hacia su sitio una
     sola vez.
   Con "reducir movimiento" o si Motion no carga, todo se muestra sin animar.
   ========================================================================= */
(() => {
  'use strict';

  window.__revealReady = true; // el failsafe del <head> ya no hace falta

  const hero = document.querySelectorAll('.main-acronym, .sub-descriptor');
  const blocks = document.querySelectorAll('[data-reveal], .reveal');
  const show = (els) => els.forEach((el) => el.classList.add('is-visible'));

  const Motion = window.Motion;
  if (!Motion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    show(hero);
    show(blocks);
    return;
  }
  const { animate, inView, stagger } = Motion;

  // Curva de desaceleración larga: arranca con decisión y se posa con suavidad
  const EASE = [0.22, 1, 0.36, 1];

  // Al terminar se limpia el estilo en línea: las tarjetas usan transform para el tilt
  const settle = (els) => els.forEach((el) => {
    el.style.removeProperty('transform');
    el.style.removeProperty('opacity');
  });

  const reveal = (els, options) => {
    show(els);
    animate(els, { opacity: [0, 1], y: [30, 0] }, { duration: 1, ease: EASE, ...options })
      .then(() => settle(els));
  };

  /* --- 1. Hero: entrada escalonada al cargar ----------------------------- */
  const heroEls = Array.from(hero);
  show(heroEls);
  animate(heroEls, { opacity: [0, 1], y: [40, 0] }, { duration: 1.2, ease: EASE, delay: stagger(0.15, { startDelay: 0.2 }) })
    .then(() => settle(heroEls));

  /* --- 2. Scroll: cada bloque aparece una vez al entrar en pantalla ------ */
  blocks.forEach((block) => {
    inView(block, () => reveal([block]), { margin: '0px 0px -100px 0px' });
  });
})();
