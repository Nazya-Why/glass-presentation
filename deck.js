(() => {
  const stage = document.getElementById('stage');
  const slides = [...document.querySelectorAll('.slide')];
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  const sectionTabs = [...document.querySelectorAll('#sections [data-section]')];
  const pad = (n) => String(n).padStart(2, '0');

  // stagger index for reveal animation
  slides.forEach((s) => s.querySelectorAll('.r').forEach((el, i) => el.style.setProperty('--i', i)));

  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${k})`;
  }
  window.addEventListener('resize', fit);
  fit();

  let index = -1;
  let first = true;
  function go(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (n === index) return;
    const prev = slides[index];
    if (prev) {
      prev.classList.remove('active');
      prev.classList.add('leaving');
      setTimeout(() => prev.classList.remove('leaving'), 450);
    }
    index = n;
    const s = slides[index];
    s.classList.add('active');
    counter.textContent = `${pad(index + 1)} / ${pad(slides.length)}`;
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
    sectionTabs.forEach((t) => t.classList.toggle('on', t.dataset.section === s.dataset.section));
    document.body.classList.toggle('is-content', !s.classList.contains('hero'));
    if (window.BG) window.BG.setPreset(s.dataset.bg || 'hero', first);
    first = false;
    try { history.replaceState(null, '', `#${index + 1}`); } catch (e) { /* sandboxed viewer */ }
  }

  const next = () => go(index + 1);
  const prev = () => go(index - 1);

  window.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }
  });
  window.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input')) return;
    (e.clientX > window.innerWidth * 0.3 ? next : prev)();
  });
  let touchX = null;
  window.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
    touchX = null;
  });

  const start = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(start) ? start - 1 : 0);
})();
