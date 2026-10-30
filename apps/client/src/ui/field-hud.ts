import type { GameStore } from '../game/store.js';

/** Presentation only: existing controls retain ownership of every game action. */
export function installFieldHud(store: GameStore, pause: (value: boolean) => void) {
  const button = (text: string, action: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', action); return b;
  };
  const mast = document.querySelector('.hud-mast')!;
  mast.insertBefore(document.querySelector('.world-heading')!, document.querySelector('.hud-clock'));
  const wallet = document.querySelector<HTMLElement>('.hud-wallet')!;
  const expand = button('Account details', () => {
    const expanded = wallet.dataset.expanded !== 'true';
    wallet.dataset.expanded = String(expanded); expand.setAttribute('aria-expanded', String(expanded));
    expand.textContent = expanded ? 'Close details' : 'Account details';
  });
  expand.className = 'account-toggle'; expand.setAttribute('aria-expanded', 'false'); wallet.append(expand);
  const utility = document.createElement('nav'); utility.className = 'field-utilities'; utility.setAttribute('aria-label', 'Operator utilities');
  const trigger = (id: string) => document.getElementById(id)?.click();
  utility.append(button('? Help', () => trigger('help-open')), button('M Map', () => trigger('inspect-map')),
    button('J Journal', () => trigger('open-journal')), button('H HUD', () => trigger('hud-collapse')));
  const settings = document.createElement('dialog'); settings.className = 'field-settings'; settings.setAttribute('aria-label', 'Display settings');
  const title = document.createElement('h2'); title.textContent = 'Field settings';
  const copy = document.createElement('p'); copy.textContent = 'Tune your view of Veyra City.';
  const controls = document.querySelector('.world-controls')!;
  const audio = document.getElementById('toggle-audio')!;
  const readout = document.createElement('output'); readout.className = 'field-diagnostics'; document.body.append(readout);
  setInterval(() => {
    if (document.body.dataset.hudMode !== 'diagnostics') return;
    const self = store.selfEntity; readout.textContent = `UPLINK ${store.connectionStatus.state} · ${store.pingMs} ms\nNEARBY ${store.entities.size} · TILE ${self?.tileX ?? '—'}, ${self?.tileY ?? '—'}\nSERVER TICK ${store.serverTick}`;
  }, 500);
  const diagnostics = button('Diagnostics: off', () => {
    const enabled = document.body.dataset.hudMode !== 'diagnostics';
    document.body.dataset.hudMode = enabled ? 'diagnostics' : 'normal';
    diagnostics.textContent = `Diagnostics: ${enabled ? 'on' : 'off'}`;
  });
  settings.append(title, copy, controls, audio, diagnostics, button('Close · Esc', () => settings.close()));
  settings.addEventListener('close', () => pause(!!document.querySelector('dialog[open]')));
  utility.append(button('⚙ Settings', () => { if (!document.querySelector('dialog[open]')) { settings.showModal(); pause(true); } }));
  document.body.append(settings); document.getElementById('operator-hud')!.append(utility);
  const intro = document.createElement('aside'); intro.className = 'district-intro'; intro.hidden = true; intro.setAttribute('aria-live', 'polite');
  const label = document.createElement('small'); label.textContent = 'VEYRA CITY / DISTRICT UPLINK';
  const name = document.createElement('strong'); intro.append(label, name); document.body.append(intro);
  let previous = '', timeout: ReturnType<typeof setTimeout>;
  const district = document.getElementById('district-title')!;
  new MutationObserver(() => {
    if (!store.selfEntity || district.textContent === previous) return;
    previous = district.textContent || ''; name.textContent = previous; intro.hidden = false;
    clearTimeout(timeout); timeout = setTimeout(() => { intro.hidden = true; }, 2600);
  }).observe(district, { childList: true });
  const tracker = document.createElement('details'); tracker.className = 'field-objectives';
  const summary = document.createElement('summary'); summary.textContent = 'Objectives';
  const objective = document.createElement('p');
  tracker.append(summary, objective, button('Open journal →', () => trigger('open-journal')));
  document.getElementById('operator-hud')!.append(tracker);
  const directive = document.getElementById('next-directive')!;
  const sync = () => { objective.textContent = directive.textContent; };
  new MutationObserver(sync).observe(directive, { childList: true }); sync();
}
