/* =========================================================================
   AJCM | RRHH CONSULTING — ARRANQUE (se carga en el <head>, antes de pintar)
   Vive en un archivo y no en línea para que la Content-Security-Policy de
   vercel.json pueda prohibir todo script en línea (script-src 'self').
   ========================================================================= */
document.documentElement.classList.add('js');
// Failsafe: si js/motion-reveal.js no llega a ejecutarse, nada se queda oculto
addEventListener('load', function () { if (!window.__revealReady) document.documentElement.classList.add('reveal-failsafe'); });

// La página SIEMPRE abre en el hero (AJCM):
// · scrollRestoration manual: al recargar o reabrir la pestaña, el navegador
//   no regresa a la última posición (p. ej. el formulario).
// · Se quita el #seccion de la dirección (p. ej. #contacto en un enlace compartido)
//   antes de que el navegador salte a esa sección.
// Los enlaces internos del menú siguen funcionando al tocarlos.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
window.addEventListener('load', function () { if (window.scrollY > 0) window.scrollTo(0, 0); });
