// How it works, wide screens: whichever step is crossing the middle of the
// viewport is the active one. It brightens, and the pinned phone swaps to its
// screenshot. IntersectionObserver with a zero-height band at the centre line,
// so exactly one step counts as "in the middle" at a time.
(() => {
  const steps = [...document.querySelectorAll('.how .step')];
  const shots = [...document.querySelectorAll('.how-pin .phone img')];
  if (!steps.length || !('IntersectionObserver' in window)) return;

  const show = (i) => {
    steps.forEach((s, n) => s.classList.toggle('active', n === i));
    shots.forEach((img, n) => img.classList.toggle('on', n === i));
  };
  show(0);

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) show(steps.indexOf(e.target));
  }, { rootMargin: '-50% 0px -50% 0px' });
  steps.forEach((s) => io.observe(s));
})();
