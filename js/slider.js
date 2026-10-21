/* =========================================================================
   AJCM | RRHH CONSULTING — CARRUSELES DE SERVICIOS
   Cada [data-slider] de la página (servicios en texto y presentación con
   imágenes) es un carrusel independiente.
   El deslizamiento lo hace CSS (scroll-snap). Este script solo añade:
   flechas anterior/siguiente, indicadores (dots) y el estado activo.
   Si falla o no carga, el carrusel sigue funcionando con el dedo o el trackpad.
   ========================================================================= */
(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('[data-slider]').forEach((root) => {
    const track = root.querySelector('.services-presentation');
    if (!track) return;

    const slides = Array.from(track.querySelectorAll('.slide'));
    const dots = Array.from(root.querySelectorAll('.slider__dot'));
    const prevBtn = root.querySelector('[data-slider-prev]');
    const nextBtn = root.querySelector('[data-slider-next]');
    let current = 0;

    // Centra la diapositiva indicada dentro del track (mismo criterio que scroll-snap-align: center)
    const goTo = (index) => {
      const i = Math.max(0, Math.min(slides.length - 1, index));
      const slide = slides[i];
      const left = slide.offsetLeft - (track.clientWidth - slide.clientWidth) / 2;
      track.scrollTo({ left, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      setActive(i); // estado inmediato al hacer clic; los eventos de scroll lo confirman después
    };

    const setActive = (index) => {
      current = index;
      dots.forEach((dot, i) => {
        if (i === index) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      // Diapositivas a ancho completo: los extremos se determinan por índice
      if (prevBtn) prevBtn.disabled = index <= 0;
      if (nextBtn) nextBtn.disabled = index >= slides.length - 1;
    };

    // La diapositiva activa es la más cercana al centro visible del track.
    // En los extremos se fuerza la primera/última: con slides anchas el centro
    // del track nunca coincide con ellas aunque estén completamente visibles.
    const updateFromScroll = () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (track.scrollLeft <= 4) return setActive(0);
      if (track.scrollLeft >= maxScroll - 4) return setActive(slides.length - 1);
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDistance = Infinity;
      slides.forEach((slide, i) => {
        const distance = Math.abs(slide.offsetLeft + slide.clientWidth / 2 - center);
        if (distance < bestDistance) { bestDistance = distance; best = i; }
      });
      setActive(best);
    };

    // Cálculo directo en cada evento: son pocas diapositivas, no hace falta throttling
    track.addEventListener('scroll', updateFromScroll, { passive: true });
    // Respaldo: fija el estado final al terminar el desplazamiento (navegadores que soportan scrollend)
    track.addEventListener('scrollend', updateFromScroll);

    if (prevBtn) prevBtn.addEventListener('click', () => goTo(current - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goTo(current + 1));
    dots.forEach((dot) => {
      dot.addEventListener('click', () => goTo(Number(dot.getAttribute('data-slide-to'))));
    });

    // Teclado: con el foco en el track, las flechas del teclado pasan de diapositiva
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
    });

    window.addEventListener('resize', updateFromScroll);
    updateFromScroll();
  });
})();
