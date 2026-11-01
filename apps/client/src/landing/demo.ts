/**
 * Walkable Central Exchange preview for the landing page.
 * Purely local: it reads the published world data for walls and landmarks,
 * never opens a socket and never talks to the game server.
 */

interface Scene { id: string; x: number; y: number; width: number; height: number }
interface Hotspot { id: string; name: string; action: string; x: number; y: number }
interface World { scenes: Scene[]; collision: string[]; hotspots: Hotspot[]; spawns: { x: number; y: number }[] }

type Dir = 'up' | 'down' | 'left' | 'right';
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// Sprite sheet rows: front, back, right, left. Columns: idle A, idle B, walk 1–8.
const ROW: Record<Dir, number> = { down: 0, up: 1, right: 2, left: 3 };
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
// Cosmetic walking pace for this preview only; the real client derives cadence from WELCOME.
const PREVIEW_STEP_MS = 230;
const ART = { src: '/art/scenes/v2-central.webp', w: 1680, h: 936 };
const SPRITE_SCALE = 0.8;
const CELL = { w: 48 * SPRITE_SCALE, h: 64 * SPRITE_SCALE };

const BLURBS: Record<string, string> = {
  bank: 'Secure your earnings here before you take the next risk.',
  race: 'Timed races start here when the city schedules one.',
  checkout: 'Lock in your final fortune. It ends your run, so choose the moment.',
  leaderboard: 'See who is rising across Veyra right now.',
  raid: 'Stand together in the circle long enough and a raid begins.',
};

export function installDemo(onCta: () => void) {
  const win = document.getElementById('demo-window') as HTMLElement | null;
  if (!win) return;
  const world = document.getElementById('demo-world')!;
  const art = document.getElementById('demo-art')!;
  const op = document.getElementById('demo-op')!;
  const sprite = op.querySelector<HTMLElement>('.demo-op-sprite')!;
  const markers = document.getElementById('demo-markers')!;
  const prompt = document.getElementById('demo-prompt')!;
  const toast = document.getElementById('demo-toast')!;
  const pos = document.getElementById('demo-pos')!;
  const start = document.getElementById('demo-start') as HTMLButtonElement;
  const foundEl = document.getElementById('demo-found')!;
  const totalEl = document.getElementById('demo-total')!;
  const foundBar = document.getElementById('demo-found-bar')!;

  let loaded = false;
  let grid: string[] = [];
  let hotspots: Hotspot[] = [];
  let scene: Scene | null = null;
  let tw = 32, th = 32;
  const found = new Set<string>();

  const me = { x: 0, y: 0, fromX: 0, fromY: 0, dir: 'down' as Dir, moving: false, t0: 0 };
  const held: Dir[] = [];
  let visible = false;
  let raf = 0;
  let near: Hotspot | null = null;
  let toastTimer = 0;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/art/world.json');
      const data = (await res.json()) as World;
      scene = data.scenes.find((s) => s.id === 'central') ?? null;
      if (!scene) throw new Error('missing scene');
      const s = scene;
      grid = data.collision.slice(s.y, s.y + s.height).map((row) => row.slice(s.x, s.x + s.width));
      hotspots = data.hotspots
        .filter((h) => h.x >= s.x && h.x < s.x + s.width && h.y >= s.y && h.y < s.y + s.height)
        .map((h) => ({ ...h, x: h.x - s.x, y: h.y - s.y }));
      const spawn = data.spawns.find((p) => p.x >= s.x && p.x < s.x + s.width && p.y >= s.y && p.y < s.y + s.height);
      me.x = me.fromX = spawn ? spawn.x - s.x : Math.floor(s.width / 2);
      me.y = me.fromY = spawn ? spawn.y - s.y : Math.floor(s.height / 2);
    } catch {
      win!.classList.add('is-error');
      start.querySelector('span:last-child')!.textContent = 'Preview unavailable offline';
      return;
    }
    tw = ART.w / scene.width;
    th = ART.h / scene.height;
    world.style.width = `${ART.w}px`;
    world.style.height = `${ART.h}px`;
    art.style.backgroundImage = `url('${ART.src}')`;
    totalEl.textContent = String(hotspots.length);
    for (const h of hotspots) {
      const m = document.createElement('span');
      m.className = 'demo-marker';
      m.dataset.id = h.id;
      m.style.left = `${(h.x + 0.5) * tw}px`;
      m.style.top = `${(h.y + 0.5) * th}px`;
      m.innerHTML = `<i></i><b>${h.name}</b>`;
      markers.append(m);
    }
    win!.classList.add('is-ready');
    draw(performance.now());
  }

  const blocked = (x: number, y: number) => y < 0 || x < 0 || y >= grid.length || x >= grid[0].length || grid[y][x] === '1';

  function tryMove(now: number) {
    const dir = held[held.length - 1];
    if (!dir) return false;
    me.dir = dir;
    const [dx, dy] = DELTA[dir];
    // Same rule as the game: walking into a wall only turns you to face it.
    if (blocked(me.x + dx, me.y + dy)) return false;
    me.fromX = me.x; me.fromY = me.y;
    me.x += dx; me.y += dy;
    me.moving = true;
    me.t0 = now;
    return true;
  }

  function update(now: number) {
    if (me.moving && now - me.t0 >= PREVIEW_STEP_MS) {
      const carry = now - me.t0 - PREVIEW_STEP_MS;
      me.moving = false;
      me.fromX = me.x; me.fromY = me.y;
      // Chain held steps smoothly, but never burst to catch up after a stall.
      if (held.length && tryMove(now) && carry < PREVIEW_STEP_MS * 0.5) me.t0 = now - carry;
    } else if (!me.moving && held.length) {
      tryMove(now);
    }
  }

  function nearest(): Hotspot | null {
    let best: Hotspot | null = null, bestD = 2.3;
    for (const h of hotspots) {
      const d = Math.hypot(h.x - me.x, h.y - me.y);
      if (d < bestD) { best = h; bestD = d; }
    }
    return best;
  }

  function draw(now: number) {
    const k = me.moving ? Math.min(1, (now - me.t0) / PREVIEW_STEP_MS) : 1;
    const fx = me.fromX + (me.x - me.fromX) * k;
    const fy = me.fromY + (me.y - me.fromY) * k;
    const px = (fx + 0.5) * tw;
    const py = (fy + 0.5) * th;
    op.style.transform = `translate3d(${px - CELL.w / 2}px, ${py - CELL.h + 10}px, 0)`;
    op.style.zIndex = String(Math.round(py));

    const col = me.moving ? 2 + (Math.floor(now / (PREVIEW_STEP_MS / 4)) % 8) : Math.floor(now / 650) % 2;
    sprite.style.backgroundPosition = `${-col * CELL.w}px ${-ROW[me.dir] * CELL.h}px`;

    // Camera follows the operator and stops at the artwork's edges.
    const vw = win!.clientWidth, vh = win!.clientHeight;
    const cx = Math.max(Math.min(0, vw / 2 - px), vw - ART.w);
    const cy = Math.max(Math.min(0, vh / 2 - py), vh - ART.h);
    world.style.transform = `translate3d(${Math.round(cx)}px, ${Math.round(cy)}px, 0)`;

    const n = nearest();
    if (n !== near) {
      near = n;
      prompt.innerHTML = n ? `<kbd>E</kbd><span>${n.name}</span>` : '';
      prompt.classList.toggle('is-on', !!n);
      markers.querySelectorAll<HTMLElement>('.demo-marker').forEach((m) => m.classList.toggle('is-near', m.dataset.id === n?.id));
    }
    pos.textContent = `X ${me.x + (scene?.x ?? 0)} · Y ${me.y + (scene?.y ?? 0)}`;
  }

  function loop(now: number) {
    update(now);
    draw(now);
    raf = visible ? requestAnimationFrame(loop) : 0;
  }
  const kick = () => { if (!raf && visible && loaded) raf = requestAnimationFrame(loop); };

  function interact() {
    if (!near) return;
    const h = near;
    const first = !found.has(h.id);
    found.add(h.id);
    foundEl.textContent = String(found.size);
    foundBar.style.width = `${(found.size / Math.max(1, hotspots.length)) * 100}%`;
    markers.querySelector(`[data-id="${h.id}"]`)?.classList.add('is-found');
    const done = found.size === hotspots.length;
    toast.innerHTML = `<small>${h.action.toUpperCase()} · ${first ? 'DISCOVERED' : 'VISITED'}</small><b>${h.name}</b><p>${BLURBS[h.action] ?? 'Something worth remembering.'}</p>${done ? '<button type="button" class="demo-toast-cta">Every landmark found. Enter the real city ↗</button>' : ''}`;
    toast.classList.add('is-on');
    toast.querySelector('button')?.addEventListener('click', onCta);
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), done ? 9000 : 3800);
  }

  const press = (d: Dir) => { if (!held.includes(d)) held.push(d); kick(); };
  const release = (d: Dir) => { const i = held.indexOf(d); if (i >= 0) held.splice(i, 1); };

  win.addEventListener('keydown', (e) => {
    const d = KEYS[e.code];
    if (d) { e.preventDefault(); if (!e.repeat) press(d); return; }
    if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); interact(); }
    if (e.code === 'Escape') win.blur();
  });
  win.addEventListener('keyup', (e) => { const d = KEYS[e.code]; if (d) release(d); });
  win.addEventListener('focus', () => { win.classList.add('is-active'); void load(); kick(); });
  win.addEventListener('blur', () => { win.classList.remove('is-active'); held.length = 0; });
  start.addEventListener('click', () => win.focus());

  document.querySelectorAll<HTMLButtonElement>('.dpad [data-dir]').forEach((b) => {
    const d = b.dataset.dir as Dir;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); void load(); press(d); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, () => release(d));
  });
  document.querySelector('.dpad [data-act]')?.addEventListener('click', interact);

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) { void load(); kick(); }
  }, { rootMargin: '300px 0px' }).observe(win);
}
