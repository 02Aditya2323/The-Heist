import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './landing.css';
import { apiLogin, apiRegister } from './net/api.js';
import { benchmarkCards, benchmarkMethodology, loadBenchmarks } from './benchmark-results.js';
import { boot, finePointer, installClock, installCursor, installMagnetic, installRain, installTilt, reduceMotion, scramble } from './landing/fx.js';
import { installDemo } from './landing/demo.js';

gsap.registerPlugin(ScrollTrigger);
const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(s));

/* ------------------------------------------------------------------ data */

const districts = [
  { id: 'central', name: 'Central Exchange', line: 'Every route leads to a decision.', purpose: ['Banking', 'Races', 'Checkout'], color: '#e7b76b' },
  { id: 'tech', name: 'Tech Quarter', line: 'Bright minds. Better opportunities.', purpose: ['Code', 'Logic', 'Contracts'], color: '#7dd3e1' },
  { id: 'black', name: 'Black Grid', line: 'Fortune favours those who read the risk.', purpose: ['Challenges', 'CTF', 'High stakes'], color: '#ef7d7a' },
  { id: 'nexus', name: 'NEXUS Plaza', line: 'At the heart of every signal.', purpose: ['City uplink', 'Events', 'Social'], color: '#b69adb' },
  { id: 'harbor', name: 'Data Harbor', line: 'Follow the current. Find your opening.', purpose: ['Terminals', 'OSINT', 'Contracts'], color: '#7fcab8' },
  { id: 'under', name: 'Undercity', line: 'Even a quiet street keeps its secrets.', purpose: ['Safehouses', 'Market', 'Homes'], color: '#d6a77f' },
];

const steps = [
  ['Explore', 'Read the city.', 'Six distinct districts. Follow the connected streets, learn the routes and find the places that matter.', '⌖'],
  ['Interact', 'Find your opening.', 'Walk up to an entrance or terminal. A prompt tells you what you can do from where you stand.', '◎'],
  ['Accept contracts', 'Take on the challenge.', 'Pick an open contract. Read the brief, work the problem and submit your answer.', '▤'],
  ['Cross districts', 'Make your move.', 'Travel gates and connector routes carry you from one opportunity to the next.', '⇄'],
  ['Earn wealth', 'Turn a solution into a fortune.', 'Paid contracts move money from the shared economy into your account.', '◆'],
  ['Secure or risk it', 'Protect what you built.', 'Keep cash at Home, lock it in the Bank or put it back on the line.', '⛨'],
  ['Aim higher', 'Build the next opportunity.', 'Progress opens new activities. Watch the city schedule and choose your next move.', '↗'],
] as const;

const gallery: Record<string, { image: string; label: string; caption: string; alt: string }> = {
  gameplay: { image: 'gameplay.png', label: 'FIELD HUD', caption: 'Minimal by default. Contextual when it matters.', alt: 'Actual Veyra City gameplay with the compact operator HUD' },
  map: { image: 'operations-map.png', label: 'OPERATIONS MAP', caption: 'Read the districts. Find your route. Plan your next move.', alt: 'The actual city operations map with region navigation and layer controls' },
  terminal: { image: 'terminal.png', label: 'CONTRACT TERMINAL', caption: 'The brief, the workbench and the outcome. All in one place.', alt: 'An actual Veyra City terminal interface' },
};

const broadcasts = ['Every fortune begins with a first contract.', 'Protect your wealth. Choose your risks.', 'Six districts. One shared economy.', 'Your next opportunity is somewhere in Veyra.', 'Operators are moving in Central Exchange.'];

/* ----------------------------------------------------------------- build */

const track = $('#districts');
const routeNodes = $('#route-nodes');
districts.forEach((d, i) => {
  const panel = document.createElement('article');
  panel.className = 'district';
  panel.style.setProperty('--accent', d.color);
  panel.innerHTML = `
    <div class="district-art"><img src="/art/landing/districts/${d.id}.webp" alt="${d.name}, original in-game artwork" loading="lazy" width="1400" height="780"></div>
    <div class="district-shade"></div>
    <span class="district-index">0${i + 1}</span>
    <div class="district-copy">
      <small>DISTRICT / 0${i + 1}</small>
      <h3>${d.name}</h3>
      <p>${d.line}</p>
      <ul>${d.purpose.map((p) => `<li>${p}</li>`).join('')}</ul>
    </div>
    <i class="district-corner" aria-hidden="true"></i>`;
  track.append(panel);
  const node = document.createElement('li');
  node.style.setProperty('--accent', d.color);
  node.innerHTML = `<i></i><span>${d.name}</span>`;
  routeNodes.append(node);
});

const stepsEl = $('#loop-steps');
steps.forEach(([label, title, text, glyph], i) => {
  const li = document.createElement('li');
  li.className = 'step';
  li.innerHTML = `<span class="step-glyph" aria-hidden="true">${glyph}</span><div><small>0${i + 1} / ${label.toUpperCase()}</small><h3>${title}</h3><p>${text}</p></div>`;
  stepsEl.append(li);
});
const dialTicks = $('.dial-ticks');
for (let i = 0; i < steps.length; i++) {
  // The SVG is rotated -90°, so angle 0 already points straight up.
  const a = (i / steps.length) * Math.PI * 2;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  line.setAttribute('cx', String(100 + Math.cos(a) * 88));
  line.setAttribute('cy', String(100 + Math.sin(a) * 88));
  line.setAttribute('r', '3');
  dialTicks.append(line);
}

// Seamless marquees: duplicate each track once.
$$('.marquee-track').forEach((t) => { t.innerHTML += t.innerHTML; });

// Tick row: twenty lamps, one per authoritative tick in a second.
const tickRow = $('#tick-row');
for (let i = 0; i < 20; i++) { const s = document.createElement('i'); s.style.animationDelay = `${i * 50}ms`; tickRow.append(s); }

/* ---------------------------------------------------------- smooth scroll */

let lenis: Lenis | null = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

function scrollToTarget(target: string | HTMLElement) {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else el.scrollIntoView();
}
$$<HTMLAnchorElement>('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href')!;
  if (id.length < 2) return;
  e.preventDefault();
  closeMenu();
  scrollToTarget(id === '#home' ? document.body : id);
}));

/* ----------------------------------------------------------------- header */

const header = $('.site-header');
const progress = $('.scroll-progress span');
let lastY = 0;
function onScroll(y: number) {
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  header.classList.toggle('is-scrolled', y > 40);
  if (Math.abs(y - lastY) < 6) return;
  const down = y > lastY;
  header.classList.toggle('is-hidden', down && y > innerHeight * 0.9 && !document.body.classList.contains('menu-open'));
  lastY = y;
}
if (lenis) lenis.on('scroll', ({ scroll }: { scroll: number }) => onScroll(scroll));
else addEventListener('scroll', () => onScroll(scrollY), { passive: true });

const indicator = $('.nav-indicator');
function setActiveNav(id: string | null) {
  const link = id ? document.querySelector<HTMLElement>(`[data-nav="${id}"]`) : null;
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a === link));
  if (!link) { indicator.style.opacity = '0'; return; }
  indicator.style.opacity = '1';
  indicator.style.transform = `translateX(${link.offsetLeft}px)`;
  indicator.style.width = `${link.offsetWidth}px`;
}
['world', 'demo', 'gameplay', 'systems', 'tech'].forEach((id) => {
  ScrollTrigger.create({
    trigger: `#${id}`, start: 'top 55%', end: 'bottom 55%',
    onToggle: (self) => { if (self.isActive) setActiveNav(id); else if (id === 'world' && self.direction < 0) setActiveNav(null); },
  });
});
// `gallery` belongs to the Loop link visually, `finale` clears the indicator.
ScrollTrigger.create({ trigger: '#gallery', start: 'top 55%', end: 'bottom 55%', onToggle: (s) => s.isActive && setActiveNav('gameplay') });
ScrollTrigger.create({ trigger: '#finale', start: 'top 55%', onEnter: () => setActiveNav(null), onLeaveBack: () => setActiveNav('tech') });

const menu = $<HTMLButtonElement>('.menu-toggle');
function closeMenu() { menu.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open'); lenis?.start(); }
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open);
  if (open) lenis?.stop(); else lenis?.start();
});

/* ------------------------------------------------------------------- hero */

installRain($<HTMLCanvasElement>('.hero-rain'));
installCursor();
installMagnetic();
installTilt();
installClock();

const coord = $('#hud-coord');
const hero = $('.hero');
if (finePointer && !reduceMotion) {
  const media = $('.hero-media');
  const mx = gsap.quickTo(media, 'x', { duration: 1.2, ease: 'power3' });
  const my = gsap.quickTo(media, 'y', { duration: 1.2, ease: 'power3' });
  hero.addEventListener('pointermove', (e) => {
    const px = e.clientX / innerWidth - 0.5, py = e.clientY / innerHeight - 0.5;
    mx(px * -26); my(py * -16);
    coord.textContent = `X ${(140 + px * 120 + 60).toFixed(3)} · Y ${(120 + py * 140 + 70).toFixed(3)}`;
  });
}

function heroIntro() {
  const letters = $$('.wm-l');
  const ins = $$('[data-hero-in]');
  document.documentElement.classList.remove('intro');
  if (reduceMotion) return;
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.fromTo('.hero-art', { scale: 1.18, filter: 'brightness(.3) saturate(.6)' }, { scale: 1.04, filter: 'brightness(1) saturate(1)', duration: 2.4, ease: 'power3.out' }, 0)
    .fromTo(letters, { yPercent: 115, opacity: 0, skewX: -18 }, { yPercent: 0, opacity: 1, skewX: 0, duration: 1.3, stagger: 0.055 }, 0.15)
    .fromTo(ins, { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, stagger: 0.08 }, 0.55)
    .fromTo('.hud-frame', { opacity: 0 }, { opacity: 1, duration: 1.4 }, 0.9)
    .add(() => scramble($('[data-scramble]'), 1100), 0.7);
  gsap.fromTo('.wm-sheen', { attr: { x: -200 } }, { attr: { x: 900 }, duration: 1.8, ease: 'power2.inOut', repeat: -1, repeatDelay: 4.5, delay: 1.6 });
}

if (!reduceMotion) {
  // Scroll: the skyline pushes in while the title drifts apart and away.
  const heroTl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
  heroTl.to('.hero-media', { scale: 1.18, yPercent: 7, ease: 'none' }, 0)
    .to('.hero-content', { yPercent: -18, opacity: 0, ease: 'none' }, 0)
    .to('.wm-l', { x: (i) => (i - 3.5) * 16, ease: 'none' }, 0)
    .to('.hero-foot, .hud-frame', { opacity: 0, y: -40, ease: 'none' }, 0)
    .to('.hero-vignette', { opacity: 1, ease: 'none' }, 0);
}

let broadcast = 0;
setInterval(() => {
  if (document.hidden || reduceMotion || dialog.open) return;
  broadcast = (broadcast + 1) % broadcasts.length;
  const el = $('#city-broadcast');
  el.dataset.final = broadcasts[broadcast];
  scramble(el, 700);
}, 6000);

/* --------------------------------------------------------------- marquees */

if (!reduceMotion) {
  const tweens = $$('.marquee').map((m) => {
    const dir = Number(m.dataset.speed ?? 1);
    const t = $('.marquee-track', m);
    return dir > 0
      ? gsap.fromTo(t, { xPercent: 0 }, { xPercent: -50, duration: 38, ease: 'none', repeat: -1 })
      : gsap.fromTo(t, { xPercent: -50 }, { xPercent: 0, duration: 46, ease: 'none', repeat: -1 });
  });
  lenis?.on('scroll', ({ velocity, direction }: { velocity: number; direction: number }) => {
    const boost = 1 + Math.min(Math.abs(velocity) * 0.22, 6);
    tweens.forEach((t) => gsap.to(t, { timeScale: (direction || 1) * boost, duration: 0.25, overwrite: true }));
    gsap.to('.marquee-track', { skewX: Math.max(-8, Math.min(8, velocity * -0.35)), duration: 0.4, overwrite: 'auto' });
  });
}

/* -------------------------------------------------------------- manifesto */

function splitWords(root: HTMLElement) {
  const out: HTMLElement[] = [];
  const walk = (node: Node, accent: boolean, into: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent!.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { into.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span');
          w.className = accent ? 'w w-accent' : 'w';
          w.textContent = part;
          into.appendChild(w);
          out.push(w);
        });
      } else if (child instanceof HTMLElement) {
        walk(child, accent || child.tagName === 'EM', into);
      }
    });
  };
  const frag = document.createDocumentFragment();
  walk(root, false, frag);
  root.replaceChildren(frag);
  return out;
}
const words = splitWords($('[data-words]'));
if (!reduceMotion) {
  gsap.fromTo(words, { opacity: 0.1, y: 6 }, {
    opacity: 1, y: 0, stagger: 0.04, ease: 'none',
    scrollTrigger: { trigger: '.manifesto-text', start: 'top 80%', end: 'bottom 40%', scrub: 0.6 },
  });
  gsap.from('.pillar', { y: 80, opacity: 0, duration: 1.1, stagger: 0.12, ease: 'expo.out', scrollTrigger: { trigger: '.manifesto-grid', start: 'top 85%' } });
}

/* -------------------------------------------------------------- districts */

const mm = gsap.matchMedia();
const routeItems = $$('li', routeNodes);
const routeFill = $('.route-line span');
function setDistrict(p: number) {
  const idx = Math.min(districts.length - 1, Math.round(p * (districts.length - 1)));
  routeItems.forEach((n, i) => { n.classList.toggle('is-active', i === idx); n.classList.toggle('is-past', i < idx); });
  routeFill.style.transform = `scaleX(${p})`;
}
setDistrict(0);

mm.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
  const world = $('.world');
  world.classList.add('is-pinned');
  const distance = () => track.scrollWidth - innerWidth + parseFloat(getComputedStyle(track).paddingLeft);
  const horizontal = gsap.to(track, {
    x: () => -distance(), ease: 'none',
    scrollTrigger: {
      trigger: world, pin: true, start: 'top top', end: () => `+=${distance()}`, scrub: 0.8,
      invalidateOnRefresh: true, anticipatePin: 1, refreshPriority: 1,
      onUpdate: (self) => setDistrict(self.progress),
    },
  });
  $$('.district').forEach((panel) => {
    gsap.fromTo($('.district-art img', panel), { xPercent: -7, scale: 1.18 }, {
      xPercent: 7, scale: 1.08, ease: 'none',
      scrollTrigger: { trigger: panel, containerAnimation: horizontal, start: 'left right', end: 'right left', scrub: true },
    });
    gsap.from($$('.district-copy > *', panel), {
      y: 40, opacity: 0, stagger: 0.07, duration: 0.9, ease: 'expo.out',
      scrollTrigger: { trigger: panel, containerAnimation: horizontal, start: 'left 70%', toggleActions: 'play none none reverse' },
    });
  });
  return () => world.classList.remove('is-pinned');
});
mm.add('(max-width: 899px), (prefers-reduced-motion: reduce)', () => {
  const onScrollX = () => setDistrict(track.scrollLeft / Math.max(1, track.scrollWidth - track.clientWidth));
  track.addEventListener('scroll', onScrollX, { passive: true });
  return () => track.removeEventListener('scroll', onScrollX);
});

/* ------------------------------------------------------------------- demo */

const dialog = $<HTMLDialogElement>('#entry-dialog');
installDemo(() => openDialog(null));
if (!reduceMotion) {
  gsap.from('.demo-shell', { y: 90, rotateX: 14, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.demo', start: 'top 70%' } });
  gsap.from('.demo-copy > *', { y: 40, opacity: 0, duration: 1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '.demo', start: 'top 70%' } });
}

/* ------------------------------------------------------------------- loop */

const stepEls = $$('.step', stepsEl);
const loopNum = $('#loop-num'), loopLabel = $('#loop-label');
const dialFill = $<SVGCircleElement>('.dial-fill' as string);
const ticks = $$<SVGCircleElement>('.dial-ticks circle');
function setStep(i: number) {
  stepEls.forEach((s, j) => s.classList.toggle('is-active', j === i));
  ticks.forEach((t, j) => t.classList.toggle('is-lit', j <= i));
  const n = `0${i + 1}`;
  if (loopNum.textContent !== n) {
    loopNum.textContent = n;
    loopLabel.textContent = steps[i][0];
    if (!reduceMotion) gsap.fromTo([loopNum, loopLabel], { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'expo.out', stagger: 0.04 });
  }
}
setStep(0);
stepEls.forEach((s, i) => ScrollTrigger.create({ trigger: s, start: 'top 55%', end: 'bottom 55%', onToggle: (self) => self.isActive && setStep(i) }));
ScrollTrigger.create({
  trigger: stepsEl, start: 'top 55%', end: 'bottom 55%',
  onUpdate: (self) => { dialFill.style.strokeDashoffset = String(1 - self.progress); },
});

/* -------------------------------------------------------------- interface */

const tabs = $$<HTMLButtonElement>('[data-gallery]');
const ink = $('.tabs-ink');
const image = $<HTMLImageElement>('#gallery-image');
function moveInk(b: HTMLElement) { ink.style.transform = `translateX(${b.offsetLeft}px)`; ink.style.width = `${b.offsetWidth}px`; }
function showGallery(b: HTMLButtonElement) {
  const g = gallery[b.dataset.gallery!];
  tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
  moveInk(b);
  const swap = () => {
    image.src = `/art/landing/${g.image}`;
    image.alt = g.alt;
    $('#gallery-label').textContent = `VEYRA CITY / ${g.label}`;
    $('#gallery-caption').textContent = g.caption;
  };
  if (reduceMotion) { swap(); return; }
  gsap.timeline()
    .set('.screen-wipe', { transformOrigin: 'left center' })
    .fromTo('.screen-wipe', { scaleX: 0 }, { scaleX: 1, duration: 0.38, ease: 'expo.in' })
    .add(swap)
    .set('.screen-wipe', { transformOrigin: 'right center' })
    .to('.screen-wipe', { scaleX: 0, duration: 0.55, ease: 'expo.out' })
    .fromTo(image, { scale: 1.06, filter: 'brightness(1.6)' }, { scale: 1, filter: 'brightness(1)', duration: 0.8, ease: 'expo.out' }, '<');
}
tabs.forEach((b, i) => {
  b.tabIndex = i ? -1 : 0;
  b.addEventListener('click', () => showGallery(b));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showGallery(next);
    next.focus();
  });
});
requestAnimationFrame(() => moveInk(tabs[0]));
addEventListener('resize', () => { moveInk(tabs.find((t) => t.getAttribute('aria-selected') === 'true')!); });

if (!reduceMotion) {
  gsap.fromTo('#screen', { rotateX: 32, scale: 0.84, yPercent: 8 }, {
    rotateX: 0, scale: 1, yPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '.screen-stage', start: 'top 95%', end: 'top 20%', scrub: true },
  });
  if (finePointer) {
    const screen = $('#screen');
    screen.addEventListener('pointermove', (e) => {
      const r = screen.getBoundingClientRect();
      screen.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
      screen.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
    });
  }
}

/* ---------------------------------------------------------------- systems */

const packetsEl = $('#pipe-packets');
const outbound = ['MOVE', 'PING', 'JSON', 'MOVE'];
const inbound = ['MOVE_ACK', 'ENTITY_MOVE', 'PONG', 'ENTITY_ENTER', 'MOVE_ACK'];
let pipeTimer = 0;
function spawnPacket() {
  const out = Math.random() < 0.5;
  const list = out ? outbound : inbound;
  const p = document.createElement('span');
  p.className = `packet ${out ? 'is-out' : 'is-in'}`;
  p.textContent = list[(Math.random() * list.length) | 0];
  packetsEl.append(p);
  gsap.fromTo(p, { '--p': out ? 0 : 1, opacity: 0 }, {
    '--p': out ? 1 : 0, duration: 2.6 + Math.random() * 0.8, ease: 'none',
    onComplete: () => p.remove(),
  });
  gsap.to(p, { opacity: 1, duration: 0.25 });
  gsap.to(p, { opacity: 0, duration: 0.3, delay: 2.4 });
}
if (!reduceMotion) {
  ScrollTrigger.create({
    trigger: '.pipeline', start: 'top bottom', end: 'bottom top',
    onToggle: (self) => {
      clearInterval(pipeTimer);
      if (self.isActive) pipeTimer = window.setInterval(() => { if (!document.hidden) spawnPacket(); }, 520);
    },
  });
  gsap.from('.pipe-node', { y: 50, opacity: 0, duration: 1, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: '.pipeline', start: 'top 80%' } });
  gsap.from('.pipe-wire', { scaleX: 0, transformOrigin: 'left center', duration: 1.6, ease: 'expo.inOut', scrollTrigger: { trigger: '.pipeline', start: 'top 80%' } });
  gsap.from('.notes article', { y: 40, opacity: 0, duration: 1, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: '.notes', start: 'top 85%' } });
}

/* ------------------------------------------------------------- benchmarks */

void loadBenchmarks().then((data) => {
  if (!data) return;
  const cards = benchmarkCards(data);
  const els = $$('.bench', $('#bench-grid'));
  els.forEach((el, i) => {
    const c = cards[i];
    $('small', el).textContent = c.label;
    $('.bench-note', el).textContent = c.note;
    const v = $('.bench-v', el);
    if (c.value === null) { v.textContent = '—'; return; }
    const fmt = (n: number) => (c.decimals ? n.toFixed(c.decimals) : Math.round(n).toLocaleString('en-US'));
    v.textContent = reduceMotion ? fmt(c.value) : fmt(0);
    if (reduceMotion) return;
    const counter = { n: 0 };
    ScrollTrigger.create({
      trigger: el, start: 'top 88%', once: true,
      onEnter: () => gsap.to(counter, { n: c.value!, duration: 2.2, ease: 'expo.out', delay: i * 0.08, onUpdate: () => { v.textContent = fmt(counter.n); } }),
    });
  });
  // One lamp per tested player.
  const crowd = $('.bench-crowd');
  const lamps = Array.from({ length: Math.min(600, data.core.players) }, () => crowd.appendChild(document.createElement('i')));
  crowd.classList.add('is-live');
  if (!reduceMotion) {
    gsap.set(lamps, { opacity: 0.08 });
    ScrollTrigger.create({
      trigger: crowd, start: 'top 85%', once: true,
      onEnter: () => gsap.to(lamps, { opacity: 1, duration: 0.4, stagger: { each: 0.004, from: 'random' }, ease: 'none' }),
    });
  }
  $('#bench-copy').textContent = 'Distributed, actively moving clients. An authoritative tick loop. Measured application latency. These results test the core engine independently of the event and contract workload.';
  const foot = $('#bench-foot');
  foot.textContent = `Controlled loopback measurement · ${data.environment.node} · ${data.environment.tickRate} Hz · ${new Date(data.measuredAt).toLocaleDateString('en-GB')}.`;
  foot.after(benchmarkMethodology(data));
  ScrollTrigger.refresh();
});
if (!reduceMotion) gsap.from('.bench', { y: 60, opacity: 0, duration: 1.1, stagger: 0.08, ease: 'expo.out', scrollTrigger: { trigger: '#bench-grid', start: 'top 85%' } });

/* ----------------------------------------------------------------- finale */

const finale = $('.finale');
finale.addEventListener('pointermove', (e) => {
  const r = finale.getBoundingClientRect();
  finale.style.setProperty('--sx', `${e.clientX - r.left}px`);
  finale.style.setProperty('--sy', `${e.clientY - r.top}px`);
});
if (!reduceMotion) {
  gsap.from('.finale-title .line > span', { yPercent: 110, duration: 1.3, stagger: 0.1, ease: 'expo.out', scrollTrigger: { trigger: '.finale', start: 'top 60%' } });
  gsap.fromTo('.finale-art', { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.finale', start: 'top bottom', end: 'bottom bottom', scrub: true } });
  gsap.fromTo('.footer-mark', { yPercent: 60, opacity: 0.2 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });
  // Generic section headings and metadata.
  $$('.section-meta, .display:not(#world-title):not(.demo-copy .display)').forEach((el) => {
    gsap.from(el, { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
  });
}

/* ----------------------------------------------------------- entry dialog */

let returnFocus: HTMLElement | null = null;
function openDialog(from: HTMLElement | null) {
  returnFocus = from;
  dialog.showModal();
  lenis?.stop();
  $('#entry-name').focus();
}
$$<HTMLButtonElement>('[data-play]').forEach((b) => b.addEventListener('click', () => openDialog(b)));
$('.entry-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { lenis?.start(); returnFocus?.focus(); });

let busy = false;
async function authenticate(register = false) {
  if (busy) return;
  const form = $<HTMLFormElement>('#entry-form');
  if (!form.reportValidity()) return;
  const username = $<HTMLInputElement>('#entry-name').value.trim();
  const password = $<HTMLInputElement>('#entry-password').value;
  const status = $('#entry-status');
  busy = true;
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((e) => (e.disabled = true));
  status.textContent = register ? 'Creating your operator…' : 'Establishing uplink…';
  status.dataset.error = 'false';
  try {
    const session = register ? await apiRegister(username, password) : await apiLogin(username, password);
    sessionStorage.setItem('heist_session_token', session.token);
    sessionStorage.setItem('heist_session_username', session.username);
    location.assign('/game.html');
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Uplink unavailable. Please try again.';
    status.dataset.error = 'true';
    busy = false;
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((e) => (e.disabled = false));
  }
}
$('#entry-form').addEventListener('submit', (e) => { e.preventDefault(); void authenticate(); });
$('#entry-register').addEventListener('click', () => void authenticate(true));

/* ------------------------------------------------------------------- boot */

void boot().then(() => {
  heroIntro();
  ScrollTrigger.refresh();
});
addEventListener('load', () => ScrollTrigger.refresh());
