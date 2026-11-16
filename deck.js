(() => {
  const deck = document.getElementById('deck');
  const slides = [...document.querySelectorAll('.slide')];
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  const sectionTabs = [...document.querySelectorAll('#sections [data-section]')];
  const pad = (n) => String(n).padStart(2, '0');

  // Wrap each slide's content in a 1920×1080 box we can scale to fit the viewport,
  // and tag the reveal elements with a stagger index.
  slides.forEach((s) => {
    const inner = document.createElement('div');
    inner.className = 'slide-inner';
    while (s.firstChild) inner.appendChild(s.firstChild);
    s.appendChild(inner);
    inner.querySelectorAll('.r').forEach((el, i) => el.style.setProperty('--i', i));
  });

  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--k', k);
  }
  window.addEventListener('resize', fit);
  fit();

  let index = -1;
  let first = true;

  function activate(n) {
    if (n === index || !slides[n]) return;
    if (slides[index]) slides[index].classList.remove('active');
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

  // IO only drives the deck after the initial scroll has settled, so a hash deep-link
  // (opening straight on slide 13) can't be snapped back to slide 1 mid-init.
  let armed = false;

  // The slide that fills most of the viewport becomes active (and its reveals play).
  const io = new IntersectionObserver((entries) => {
    if (!armed) return;
    let best = null;
    entries.forEach((e) => { if (e.isIntersecting && (!best || e.intersectionRatio > best.intersectionRatio)) best = e; });
    if (best && best.intersectionRatio >= 0.5) activate(slides.indexOf(best.target));
  }, { root: deck, threshold: [0.5, 0.75, 1] });
  slides.forEach((s) => io.observe(s));

  // When a slide leaves the viewport entirely, reset it so its reveals replay on return.
  const ioOut = new IntersectionObserver((entries) => {
    if (!armed) return;
    entries.forEach((e) => { if (!e.isIntersecting && slides.indexOf(e.target) !== index) e.target.classList.remove('active'); });
  }, { root: deck, threshold: 0 });
  slides.forEach((s) => ioOut.observe(s));

  const scrollToSlide = (i) => {
    i = Math.max(0, Math.min(slides.length - 1, i));
    slides[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); scrollToSlide(index + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); scrollToSlide(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); scrollToSlide(0); }
    else if (e.key === 'End') { e.preventDefault(); scrollToSlide(slides.length - 1); }
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    }
  });

  // Open on the slide named in the hash (#5), else the first. Scroll synchronously
  // (before the IntersectionObserver's first async callback) so it can't snap back to slide 1.
  const start = parseInt(location.hash.slice(1), 10);
  const i0 = (Number.isFinite(start) && start > 1) ? Math.min(start - 1, slides.length - 1) : 0;
  activate(i0);
  const jump = () => { if (i0 > 0) deck.scrollTop = slides[i0].offsetTop; };
  jump();
  // re-assert across two frames (layout/snap can shift the first set), then hand over to IO
  requestAnimationFrame(() => { jump(); requestAnimationFrame(() => { jump(); armed = true; }); });
})();
