// Fades sections up as they scroll into view (site.css .reveal / .in).
// IntersectionObserver, not a scroll listener, so it costs nothing while
// scrolling. Without it, everything is simply shown.
(() => {
  // iOS Safari only applies :active (the button press) when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
  els.forEach((el) => io.observe(el));
})();
