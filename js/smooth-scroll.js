/* =========================================================================
   AJCM | RRHH CONSULTING — SCROLL CON INERCIA (Lenis 1.3.25, js/vendor/)
   La rueda del mouse y el trackpad desplazan la página con suavidad y frenan
   de forma gradual. En pantallas táctiles se mantiene el scroll nativo del
   sistema (ya es suave y forzarlo se siente peor). Si el usuario pidió
   "reducir movimiento" o Lenis no carga, la página usa el scroll normal.
   ========================================================================= */
(() => {
  'use strict';

  if (typeof window.Lenis !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const lenis = new window.Lenis({
    autoRaf: true,        // Lenis gestiona su propio requestAnimationFrame
    lerp: 0.09,           // inercia: más bajo = más suave y "pesado"
    wheelMultiplier: 1,
    anchors: true,        // los enlaces #seccion del menú también se deslizan con inercia
    // Paneles con scroll propio: la rueda debe mover su contenido, no la página
    prevent: (node) => Boolean(node.closest && node.closest('.chat-panel, .modal')),
  });

  // Expuesto para que otros scripts (p. ej. js/modal.js) desplacen con la misma inercia
  window.lenis = lenis;

  // Con el modal abierto la página de fondo no debe moverse
  const syncWithModal = () => {
    if (document.body.classList.contains('modal-open')) lenis.stop();
    else lenis.start();
  };
  new MutationObserver(syncWithModal).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
