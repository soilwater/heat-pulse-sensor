/* Guided teaching tour for a digital twin. Generic: it knows nothing about heat pulses.
 *
 *   TwinTour.start({
 *     twin:   {time, duration, seek(t), ...anything the steps read},
 *     steps:  [{title, phase, time(ctx), focus: ['U1', ...], plain, what, why, live}],  // strings or fn(ctx)
 *             plain = a short everyday-language explanation shown above the technical text
 *     stage:  element kept sharp (everything listed in `blur` is dimmed),
 *     blur:   ['.selector', ...],
 *     camera: {focus(refs, options), highlight(refs | null)},
 *     onExit()
 *   })
 *
 * Space / → / Enter: run the simulation forward to the next event. ← / Backspace: back. Esc: exit.
 * Each step's time(ctx) returns the displayed simulation time at which that event happens; ctx holds
 * everything on `twin` (config, run, state, ...). Text fields may be functions of ctx for live values. */
(function (root) {
  'use strict';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const val = (x, ctx) => typeof x === 'function' ? x(ctx) : x;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  let active = null;

  function start(opts) {
    if (active) return active;
    const {twin, steps, stage, camera = {}, blur = []} = opts;
    let index = -1, anim = null, busy = false;
    const blurred = blur.flatMap(sel => [...document.querySelectorAll(sel)]);
    const ctx = () => new Proxy({}, {get: (_, key) => twin[key]});

    // ---------- card ----------
    const card = document.createElement('section');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Guided tour');
    card.innerHTML =
      '<div class="tour-top"><span class="tour-kicker">Guided tour</span><span class="tour-phase"></span>' +
      '<span class="tour-count"></span><button class="tour-close" aria-label="Exit tour" title="Exit (Esc)">×</button></div>' +
      '<h2 class="tour-title" aria-live="polite"></h2><div class="tour-parts"></div>' +
      '<div class="tour-sec tour-plain"><span>In plain terms</span><p></p></div>' +
      '<div class="tour-sec tour-what"><span>What happens</span><p></p></div>' +
      '<div class="tour-sec tour-why"><span>Why it’s here</span><p></p></div>' +
      '<p class="tour-live" aria-live="polite"></p>' +
      '<div class="tour-progress" role="group" aria-label="Tour steps"></div>' +
      '<div class="tour-controls"><button class="tour-prev">← Back</button>' +
      '<span class="tour-hint"><kbd>Space</kbd> next · <kbd>Esc</kbd> exit</span>' +
      '<button class="tour-next">Next →</button></div>';
    document.body.append(card);
    const q = s => card.querySelector(s);
    q('.tour-progress').innerHTML = steps.map((s, i) => '<button data-step="' + i + '" data-phase="' + esc(s.phase || '') +
      '" title="' + esc((i + 1) + '. ' + val(s.title, {})) + '" aria-label="Step ' + (i + 1) + '"></button>').join('');

    // ---------- layout: card beside the stage, or below it on narrow screens ----------
    function place() {
      const r = stage.getBoundingClientRect(), room = innerWidth - r.right - 32;
      card.classList.toggle('tour-card-below', room < 340);
      if (room >= 340) {
        card.style.left = (r.right + 24) + 'px'; card.style.width = Math.min(520, room) + 'px';
        card.style.top = Math.max(16, Math.min(r.top + 40, innerHeight - card.offsetHeight - 16)) + 'px'; card.style.bottom = '';
      } else {
        card.style.left = '16px'; card.style.width = (innerWidth - 32) + 'px'; card.style.top = ''; card.style.bottom = '16px';
      }
    }

    // ---------- rendering ----------
    function render(i, arrived) {
      const s = steps[i], c = ctx();
      card.dataset.phase = s.phase || '';
      q('.tour-phase').textContent = val(s.phaseLabel, c) || s.phase || '';
      q('.tour-count').textContent = (i + 1) + ' / ' + steps.length;
      q('.tour-title').textContent = val(s.title, c);
      q('.tour-parts').innerHTML = (s.focus || []).length ? '<span>' + (s.partsLabel ? esc(s.partsLabel) : (s.focus || []).map(esc).join(' · ')) + '</span>' : '';
      q('.tour-plain p').textContent = val(s.plain, c) || ''; q('.tour-plain').hidden = !s.plain;
      q('.tour-what p').textContent = val(s.what, c) || ''; q('.tour-what').hidden = !s.what;
      q('.tour-why p').textContent = val(s.why, c) || '';
      q('.tour-why').hidden = !s.why;
      const live = arrived ? val(s.live, c) : '';
      q('.tour-live').textContent = live || ''; q('.tour-live').hidden = !live;
      q('.tour-prev').disabled = i === 0;
      q('.tour-next').textContent = i === steps.length - 1 ? 'Finish' : 'Next →';
      card.querySelectorAll('.tour-progress button').forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.toggle('now', k === i); });
      if (!arrived) { card.classList.remove('tour-enter'); void card.offsetWidth; card.classList.add('tour-enter'); }  // animate on step change only
      place();
    }

    // ---------- moving between steps: camera glides, simulation runs forward to the event ----------
    function go(i) {
      if (i < 0 || i >= steps.length) return;
      if (anim) { cancelAnimationFrame(anim); anim = null; }
      const s = steps[i], target = Math.max(0, Math.min(twin.duration, val(s.time, ctx()) || 0));
      const forward = i > index && target >= twin.time;             // only animate time forwards
      index = i;
      if (camera.highlight) camera.highlight(s.focus && s.focus.length ? s.focus : null);  // no focus = whole board lit
      if (camera.focus) camera.focus(s.focus || [], s.camera || {});
      const from = forward ? twin.time : target, span = Math.abs(target - from);
      const ms = reduced() || !forward ? 0 : Math.min(2800, Math.max(500, span / 9 * 1000));
      render(i, false);
      if (!ms) { twin.seek(target); render(i, true); return; }
      busy = true;
      const t0 = performance.now();
      const tick = now => {
        const k = Math.min(1, (now - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        twin.seek(from + (target - from) * e);
        if (k < 1) anim = requestAnimationFrame(tick); else { anim = null; busy = false; render(i, true); }
      };
      anim = requestAnimationFrame(tick);
    }
    function next() {
      if (busy) { cancelAnimationFrame(anim); anim = null; busy = false; twin.seek(val(steps[index].time, ctx())); render(index, true); return; }
      if (index >= steps.length - 1) exit(); else go(index + 1);
    }

    // ---------- input ----------
    function onKey(e) {
      if (document.querySelector('dialog[open]')) return;          // let other dialogs keep their keys
      if (e.key === 'Escape') { e.preventDefault(); exit(); }
      else if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter' || e.key === 'PageDown') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'Backspace' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
    }
    q('.tour-next').addEventListener('click', next);
    q('.tour-prev').addEventListener('click', () => go(index - 1));
    q('.tour-close').addEventListener('click', () => exit());
    q('.tour-progress').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (b) go(Number(b.dataset.step)); });
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', place);

    function exit() {
      if (anim) cancelAnimationFrame(anim);
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', place);
      document.documentElement.classList.remove('tour-active');
      stage.classList.remove('tour-stage');
      blurred.forEach(el => { el.classList.remove('tour-blur'); el.removeAttribute('inert'); });
      card.remove(); active = null;
      if (opts.onExit) opts.onExit();
    }

    document.documentElement.classList.add('tour-active');
    stage.classList.add('tour-stage');
    blurred.forEach(el => { el.classList.add('tour-blur'); el.setAttribute('inert', ''); });
    active = {next, prev: () => go(index - 1), go, exit, get index() { return index; }};
    go(0);
    q('.tour-next').focus();
    return active;
  }

  root.TwinTour = {start, get active() { return active; }};
})(typeof globalThis !== 'undefined' ? globalThis : this);
