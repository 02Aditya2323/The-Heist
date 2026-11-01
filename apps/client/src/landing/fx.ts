/** Small, self-contained visual effects for the landing page. */

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*/<>';

/** Decodes text from random glyphs into its final value. */
export function scramble(el: HTMLElement, duration = 900) {
  const final = el.dataset.final ?? el.textContent ?? '';
  el.dataset.final = final;
  if (reduceMotion) { el.textContent = final; return; }
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    const settled = Math.floor(p * final.length);
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const c = final[i];
      out += i < settled || c === ' ' || c === '.' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Boot sequence. Resolves when the hero image is ready (or after a short cap). */
export function boot(): Promise<void> {
  const root = document.getElementById('boot');
  if (!root || reduceMotion || sessionStorage.getItem('heist_booted')) {
    root?.remove();
    document.body.classList.remove('is-booting');
    return Promise.resolve();
  }
  sessionStorage.setItem('heist_booted', '1');
  const lines = document.getElementById('boot-lines')!;
  const bar = document.getElementById('boot-bar')!;
  const count = document.getElementById('boot-count')!;
  const script = ['> handshake veyra.city:443', '> session token .......... OK', '> world map 333×390 ....... OK', '> six districts ........... ONLINE', '> authority tick ......... 20 Hz'];

  const img = new Image();
  let imageReady = false;
  img.onload = img.onerror = () => { imageReady = true; };
  img.src = '/art/landing/veyra-hero.webp';

  return new Promise((resolve) => {
    const t0 = performance.now();
    let shown = 0;
    const step = (now: number) => {
      const elapsed = now - t0;
      // Progress eases toward 90% until the art is ready, then completes.
      const target = imageReady && elapsed > 900 ? 1 : Math.min(0.9, elapsed / 1400);
      const current = parseFloat(bar.dataset.p ?? '0');
      const next = elapsed > 2600 ? 1 : current + (target - current) * 0.12;
      bar.dataset.p = String(next);
      bar.style.transform = `scaleX(${next})`;
      count.textContent = String(Math.round(next * 100)).padStart(3, '0');
      const want = Math.min(script.length, Math.floor(next * script.length + 0.4));
      while (shown < want) {
        const line = document.createElement('div');
        line.textContent = script[shown++];
        lines.append(line);
      }
      if (next > 0.995) {
        root.classList.add('is-done');
        document.body.classList.remove('is-booting');
        setTimeout(() => root.remove(), 1100);
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Crosshair cursor with contextual labels. */
export function installCursor() {
  const el = document.querySelector<HTMLElement>('.reticle');
  if (!el || !finePointer || reduceMotion) { el?.remove(); return; }
  document.documentElement.classList.add('has-reticle');
  const ring = el.querySelector<HTMLElement>('.reticle-ring')!;
  const dot = el.querySelector<HTMLElement>('.reticle-dot')!;
  const label = el.querySelector<HTMLElement>('.reticle-label')!;
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; el.classList.add('is-on'); }, { passive: true });
  document.addEventListener('pointerleave', () => el.classList.remove('is-on'));
  addEventListener('pointerdown', () => el.classList.add('is-down'));
  addEventListener('pointerup', () => el.classList.remove('is-down'));
  document.addEventListener('pointerover', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('a, button, [data-cursor], input, summary, [role=tab]');
    el.classList.toggle('is-hover', !!t);
    el.classList.toggle('is-text', !!t?.matches('input'));
    const text = t?.dataset.cursor ?? '';
    label.textContent = text;
    el.classList.toggle('has-label', !!text);
  });
  const loop = () => {
    rx += (x - rx) * 0.2; ry += (y - ry) * 0.2;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    label.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Buttons lean toward the pointer. */
export function installMagnetic() {
  if (!finePointer || reduceMotion) return;
  document.querySelectorAll<HTMLElement>('.magnetic').forEach((el) => {
    const strength = 0.28;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
      el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/** Cards tilt in 3D and track a light spot. */
export function installTilt() {
  if (!finePointer || reduceMotion) return;
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 8}deg) rotateY(${(px - 0.5) * 10}deg) translateY(-4px)`;
      el.style.setProperty('--lx', `${px * 100}%`);
      el.style.setProperty('--ly', `${py * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/** Rain over the skyline. Pauses when offscreen or hidden. */
export function installRain(canvas: HTMLCanvasElement) {
  if (reduceMotion) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let w = 0, h = 0, dpr = 1, running = true;
  type Drop = { x: number; y: number; l: number; v: number; a: number };
  let drops: Drop[] = [];
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((w * h) / 9000);
    drops = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, l: 8 + Math.random() * 22, v: 7 + Math.random() * 10, a: 0.05 + Math.random() * 0.22 }));
  };
  resize();
  addEventListener('resize', resize);
  let looping = false;
  const startLoop = () => { if (!looping && running) { looping = true; requestAnimationFrame(frame); } };
  new IntersectionObserver((e) => { running = e[0].isIntersecting; startLoop(); }).observe(canvas);
  const slant = 0.18;
  function frame() {
    // requestAnimationFrame already sleeps in hidden tabs; stop entirely when offscreen.
    if (!running) { looping = false; return; }
    ctx!.clearRect(0, 0, w, h);
    ctx!.lineCap = 'round';
    for (const d of drops) {
      ctx!.strokeStyle = `rgba(190,215,235,${d.a})`;
      ctx!.lineWidth = d.l > 22 ? 1.2 : 0.8;
      ctx!.beginPath();
      ctx!.moveTo(d.x, d.y);
      ctx!.lineTo(d.x - d.l * slant, d.y + d.l);
      ctx!.stroke();
      d.y += d.v; d.x -= d.v * slant;
      if (d.y > h) { d.y = -d.l; d.x = Math.random() * (w + 200); }
    }
    requestAnimationFrame(frame);
  }
  running = true;
  startLoop();
}

/** Ticking local clock in the header. */
export function installClock() {
  const el = document.getElementById('city-clock');
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const tick = () => { el.textContent = fmt.format(new Date()); };
  tick();
  setInterval(tick, 1000);
}
