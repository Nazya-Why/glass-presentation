/* Discrete slide deck with per-slide screenshot stepping (one photo at a time),
   side tick rail and lightbox. Background presets come from window.BG. */
(() => {
  const $ = (s, e = document) => e.querySelector(s);
  const $$ = (s, e = document) => [...e.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(2, '0');
  const W = 1920, H = 1080;

  const stage = $('#stage');
  const slides = $$('.slide');
  const N = slides.length;

  // stagger reveal elements
  slides.forEach((el) => $$('.r', el).forEach((n, i) => n.style.setProperty('--i', i)));

  // ---- read screenshot steps from each slide's .steps-data
  slides.forEach((el) => {
    const data = $('.steps-data', el);
    if (!data) return;
    el._steps = $$(':scope > div', data).map((d) => ({ fig: d.dataset.fig, cap: d.dataset.cap, url: d.dataset.url, html: d.innerHTML }));
    const segs = $('.segs', el);
    if (segs) segs.innerHTML = el._steps.map((_, k) => `<button data-step="${k}" aria-label="Крок ${k + 1}"></button>`).join('');
    const box = $('.shot-img', el);
    if (box && $$('img', box).length < 2) box.appendChild($('img', box).cloneNode());
    const tot = $('.stot', el); if (tot) tot.textContent = pad(el._steps.length);
    $$('.sn, .figno', el).forEach((n) => n.classList.add('roll'));
  });

  // ---- rail ticks + counter
  $('#tot').textContent = pad(N);
  $('#ticks').innerHTML = slides.map((s, i) => `<button data-go="${i}" title="${s.dataset.title || ''}" aria-label="${s.dataset.title || ''}"></button>`).join('');
  const ticks = $$('#ticks button');
  const cnt = $('#cnt');

  // ---- scale the stage to fit
  function fit() { stage.style.setProperty('--sc', Math.min(innerWidth / W, innerHeight / H)); }
  fit(); addEventListener('resize', fit);

  // ---- screenshot crossfade (dir: 1 fwd, -1 back, 0 enter)
  function swapShot(el, src, cap, dir) {
    const box = $('.shot-img', el);
    const [a, b] = $$('img', box);
    const shown = box._cur;
    if (shown && shown.getAttribute('src') === src) return;
    const nx = shown === a ? b : a;
    const tok = box._tok = (box._tok || 0) + 1;
    nx.className = dir > 0 ? 'from-f' : dir < 0 ? 'from-b' : 'from-up';
    nx.alt = cap; nx.src = src;
    const run = () => {
      if (box._tok !== tok) return;
      void nx.offsetWidth;
      nx.className = 'show';
      if (shown) shown.className = dir < 0 ? 'to-b' : 'to-f';
      box._cur = nx;
    };
    (nx.decode ? nx.decode() : Promise.resolve()).then(run, run);
  }
  const bump = (n) => { n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); };

  // ---- navigation state
  let cur = -1, first = true;
  const seen = new Set();
  const stepOf = new Map();

  function go(i, step = 0) {
    i = Math.max(0, Math.min(N - 1, i));
    if (i === cur) { if (slides[i]._steps) setStep(i, step); return; }
    const out = slides[cur], inn = slides[i];
    if (out) {
      out.classList.remove('is-active'); out.classList.add('is-leaving');
      clearTimeout(out._t);
      out._t = setTimeout(() => { out.classList.add('reset'); out.classList.remove('is-leaving'); void out.offsetWidth; out.classList.remove('reset'); }, 700);
    }
    clearTimeout(inn._t);
    inn.classList.add('reset'); inn.classList.remove('is-leaving', 'is-active');
    void inn.offsetWidth; inn.classList.remove('reset');
    void inn.offsetWidth; inn.classList.add('is-active');

    cur = i; seen.add(i);
    document.body.classList.toggle('is-content', !inn.classList.contains('hero'));
    if (window.BG) window.BG.setPreset(inn.dataset.bg || 'hero', first);
    first = false;
    chrome(i);
    if (inn._steps) { stepOf.delete(i); setStep(i, step, true); } else syncHash();
  }

  function next() {
    const el = slides[cur];
    if (el && el._steps) { const k = stepOf.get(cur) ?? 0; if (k < el._steps.length - 1) return setStep(cur, k + 1); }
    if (cur < N - 1) go(cur + 1);
  }
  function prev() {
    const el = slides[cur];
    if (el && el._steps) { const k = stepOf.get(cur) ?? 0; if (k > 0) return setStep(cur, k - 1); }
    if (cur > 0) { const p = cur - 1; go(p, slides[p]._steps ? slides[p]._steps.length - 1 : 0); }
  }

  function setStep(i, k, entering = false) {
    const el = slides[i], steps = el._steps;
    k = Math.max(0, Math.min(steps.length - 1, k));
    const prevK = stepOf.get(i);
    if (prevK === k && !entering) return;
    const dir = entering || prevK == null ? 0 : (k > prevK ? 1 : -1);
    stepOf.set(i, k);
    const st = steps[k];
    const lbl = st.cap.split(' — ')[0];
    $('.sn', el).textContent = pad(k + 1);
    $('.fig-lbl', el).textContent = lbl;
    $('.figno', el).textContent = lbl;
    if (dir) { bump($('.sn', el)); bump($('.figno', el)); }
    const su = $('.shot-url', el); if (su) su.textContent = st.url || '';
    $$('.segs button', el).forEach((btn, j) => { btn.classList.toggle('on', j === k); btn.classList.toggle('done', j < k); });

    const txt = $('.step-text', el);
    txt.style.transition = 'none'; txt.style.opacity = '0'; txt.style.transform = `translateY(${dir < 0 ? -14 : 14}px)`;
    setTimeout(() => {
      txt.innerHTML = st.html; void txt.offsetWidth;
      txt.style.transition = 'opacity .5s var(--ease), transform .6s var(--ease)';
      txt.style.opacity = '1'; txt.style.transform = 'none';
    }, entering ? 240 : 140);

    el._shot = { src: st.fig, cap: st.cap };
    swapShot(el, st.fig, st.cap, dir);
    [k + 1, k + 2].forEach((j) => { if (steps[j]) { const im = new Image(); im.src = steps[j].fig; } });
    if (cur === i) syncHash();
  }

  function chrome(i) {
    cnt.textContent = pad(i + 1); bump(cnt);
    ticks.forEach((t, k) => { t.classList.toggle('on', k === i); t.classList.toggle('seen', seen.has(k) && k !== i); });
  }

  function syncHash() {
    const k = stepOf.get(cur);
    const h = `#${cur + 1}${(slides[cur]._steps && k) ? '.' + (k + 1) : ''}`;
    try { if (location.hash !== h) history.replaceState(null, '', h); } catch (e) { /* sandboxed */ }
  }

  // ---- lightbox
  const lb = $('#lb'), lbImg = $('#lbImg'), lbCap = $('#lbCap');
  function openLb(src, cap) { lbImg.src = src; lbImg.alt = cap || ''; lbCap.textContent = cap || ''; lb.hidden = false; void lb.offsetWidth; lb.classList.add('open'); }
  function closeLb() { lb.classList.remove('open'); setTimeout(() => { lb.hidden = true; }, 500); }
  lb.addEventListener('click', closeLb);

  // ---- input
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go],[data-step],.frame.shot');
    if (!t) return;
    if (t.dataset.step != null) { e.preventDefault(); return setStep(cur, +t.dataset.step); }
    if (t.classList.contains('shot')) { e.preventDefault(); const s = slides[cur]._shot; if (s) openLb(s.src, s.cap); return; }
    if (t.dataset.go != null) { e.preventDefault(); go(+t.dataset.go); }
  });

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!lb.hidden) { if (['Escape', ' ', 'Enter'].includes(k)) { e.preventDefault(); closeLb(); } return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(N - 1); }
    else if (/^[fFаА]$/.test(k)) { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.().catch(() => {}); }
  });

  // wheel: one gesture = one step/slide
  let acc = 0, lockUntil = 0;
  addEventListener('wheel', (e) => {
    if (!lb.hidden) return;
    e.preventDefault();
    const now = performance.now();
    if (now < lockUntil) { lockUntil = Math.max(lockUntil, now + 140); return; }
    acc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(acc) > 48) { acc > 0 ? next() : prev(); acc = 0; lockUntil = now + 560; }
  }, { passive: false });

  let tx = 0, ty = 0;
  addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
    if (!lb.hidden) { closeLb(); return; }
    (Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0) ? next() : prev();
  }, { passive: true });

  // ---- start (hash #i or #i.k)
  const parseHash = () => {
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?/);
    return m ? [Math.max(0, Math.min(N - 1, +m[1] - 1)), m[2] ? +m[2] - 1 : 0] : [0, 0];
  };
  addEventListener('hashchange', () => { const [i, k] = parseHash(); if (i !== cur || (slides[i]._steps && k !== stepOf.get(i))) go(i, k); });
  const [i0, k0] = parseHash();
  go(i0, k0);

  // warm up screenshots
  setTimeout(() => slides.forEach((el) => el._steps && el._steps.forEach((s) => { const im = new Image(); im.src = s.fig; })), 1500);
})();
