/**
 * Main application entrypoint orchestrating UI, Networking, Prediction, and Rendering.
 * Strictly adheres to FRONTEND_CONTRACT.md and AGENTS.md.
 */

import { CLOSE_CODE, KICK_REASON, DIR, loadMap, sceneAt } from '@heist/shared';
import { GameStore } from './game/store.js';
import { RealBackend } from './net/backend.js';
import { apiLogin, apiRegister, fetchMap } from './net/api.js';
import { KeyboardInputHandler } from './engine/input.js';
import { MovementPredictor } from './engine/prediction.js';
import { Camera } from './engine/camera.js';
import { GameLoop } from './engine/loop.js';
import { ArtWorldRenderer } from './render/art-world.js';
import { UIManager } from './ui/index.js';
import { WorldUI } from './ui/world-ui.js';
import { EventUI } from './ui/event-ui.js';
import { StaffUI } from './ui/staff-ui.js';
import { OperatorConsole } from './ui/operator-console.js';
import { installHudCollapse } from './ui/hud-collapse.js';
import { installHelp } from './ui/help.js';
import { installFinalReport } from './ui/final-report.js';
import { installCustodyNotice } from './ui/custody-notice.js';
import { StaffApi } from './net/staff-api.js';
import type { EventView } from '@heist/shared';
import './ui/world.css';
import './ui/event.css';
import './ui/terminal.css';
import './ui/workbench-revamp.css';
import './ui/hud-revamp.css';
import './ui/field-hud.css';
import { installFieldHud } from './ui/field-hud.js';

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('#game-canvas element not found');

  const store = new GameStore();
  const ui = new UIManager();
  ui.init();

  const input = new KeyboardInputHandler();
  for(const [id,direction]of [['touch-up',DIR.UP],['touch-down',DIR.DOWN],['touch-left',DIR.LEFT],['touch-right',DIR.RIGHT]] as const){
    const button=document.getElementById(id)!;
    button.addEventListener('pointerdown',event=>{event.preventDefault();input.setTouchDirection(direction);button.setPointerCapture(event.pointerId);});
    button.addEventListener('pointerup',()=>input.setTouchDirection(null));
    button.addEventListener('pointercancel',()=>input.setTouchDirection(null));
    button.addEventListener('lostpointercapture',()=>input.setTouchDirection(null));
  }
  const camera = new Camera();

  const renderer = new ArtWorldRenderer(canvas);
  let paused = false;
  const setPaused=(value:boolean)=>{paused=value;if(value)input.disable();else if(store.cadence&&store.connectionStatus.state==='CONNECTED'&&(!store.event||!store.event.player.checkedOut&&!store.event.player.insideHome&&store.event.player.jailedUntil<=store.event.serverTime))input.enable();};
  const eventUI=new EventUI(store,setPaused);
  const finalReport=installFinalReport(setPaused);
  const custody=installCustodyNotice();
  const staffUI=new StaffUI(setPaused),staffApi=new StaffApi(()=>store.token);
  staffUI.bind({catalogue:()=>staffApi.catalogue(),dashboard:()=>staffApi.dashboard(),open:id=>staffApi.open(id),challenge:r=>staffApi.challenge(r),control:body=>staffApi.control(body)});
  // The operator console is the super-admin surface: event control, live
  // settings, per-operator actions and the money trail. It is a sibling of the
  // staff challenge browser rather than a tab inside it, because the two have
  // different audiences and different blast radii.
  const operatorConsole=new OperatorConsole(setPaused);
  operatorConsole.bind({
    dashboard:()=>staffApi.dashboard(),
    control:body=>staffApi.control(body),
    settings:()=>staffApi.settings(),
    saveSettings:overrides=>staffApi.saveSettings(overrides),
    restoreSettings:()=>staffApi.restoreSettings(),
    player:body=>staffApi.player(body),
    roster:()=>staffApi.roster(),
    rosterCsv:()=>staffApi.rosterCsv(),
  });
  const operatorDock=document.createElement('button');
  operatorDock.id='operator-console-dock';
  operatorDock.className='operator-dock';
  operatorDock.type='button';
  operatorDock.hidden=true;
  operatorDock.textContent='EVENT CONTROL';
  operatorDock.addEventListener('click',()=>void operatorConsole.open());
  // Inside the world status bar, beside City maps, so it takes part in that
  // bar's layout. As a separately fixed element it sat on top of the latency
  // readout, the nearby count and the City maps button.
  const statusBar=document.querySelector('.world-status');
  if(statusBar)statusBar.prepend(operatorDock);else document.body.append(operatorDock);
  installHudCollapse();
  const help = installHelp(setPaused);
  const worldUI = new WorldUI(store, renderer, setPaused);
  installFieldHud(store, setPaused);
  try {
    const response = await fetch('/art/world.json');
    if (!response.ok) throw new Error('City map unavailable');
    store.map = loadMap(await response.json());
    worldUI.setMap(store.map);
  } catch {
    ui.setAuthStatus('City artwork is unavailable. Run npm run build:art-world.', true);
  }
  document.getElementById('auth-preview')!.addEventListener('click', () => {
    ui.hideAuth(); worldUI.toggleInspector(true);
  });
  document.getElementById('return-to-game')!.addEventListener('click', () => {
    if (!store.selfEntity) ui.showAuth();
  });
  document.getElementById('atlas-close')!.addEventListener('click', () => {
    if (!store.selfEntity) ui.showAuth();
  });

  let backend: RealBackend;
  let predictor: MovementPredictor;

  backend = new RealBackend({
    onWelcome: (msg) => {
      if (store.map?.version !== msg.mapVersion) {
        input.disable(); predictor.clearPending();
        ui.showBanner('Updating city map…');
        void fetchMap().then(map => {
          store.map = map; worldUI.setMap(map);
          backend.disconnect();
          if (store.token) backend.connect(store.token);
        }).catch(() => ui.showBanner('Map update failed. Refresh to retry.', 'error'));
        return;
      }
      store.resetOnWelcome(
        msg.selfId,
        msg.x,
        msg.y,
        msg.dir,
        msg.tickRate,
        msg.stepTicks,
        msg.serverTick
      );

      if (store.map && store.selfEntity) {
        predictor.resetOnWelcome(msg.tickRate, msg.stepTicks, store.selfEntity, store.map);
      }

      // Input is strictly enabled only after WELCOME arrives
      if (!paused) input.enable();
      ui.hideAuth();
      ui.hideBanner();
    },

    onEntityEnter: (msg) => {
      store.handleEntityEnter(msg.id, msg.x, msg.y, msg.dir, msg.name);
    },

    onEntityLeave: (msg) => {
      store.handleEntityLeave(msg.id);
    },

    onEntityMove: (msg) => {
      store.handleEntityMove(msg.id, msg.x, msg.y, msg.dir);
    },

    onMoveAck: (msg) => {
      predictor.handleAck(msg);
    },

    onMoveReject: (msg) => {
      predictor.handleReject(msg);
      store.rejectsCount = predictor.rejectsCount;
    },

    onPong: (rttMs, serverTick) => {
      store.pingMs = rttMs;
      store.serverTick = serverTick;
    },

    onKick: (msg) => {
      let kickNotice = 'Disconnected by server';
      switch (msg.reason) {
        case KICK_REASON.INVALID_TOKEN:
          kickNotice = 'Kicked: Invalid or expired session';
          break;
        case KICK_REASON.REPLACED:
          kickNotice = 'Session opened in another window';
          break;
        case KICK_REASON.RATE_LIMIT:
          kickNotice = 'Kicked: Movement rate limit exceeded';
          break;
        case KICK_REASON.SERVER_FULL:
          kickNotice = 'Server reached maximum capacity';
          break;
        case KICK_REASON.HEARTBEAT_TIMEOUT:
          kickNotice = 'Kicked: Heartbeat ping timeout';
          break;
      }
      ui.showBanner(kickNotice, 'warning');
    },

    onTeleport: (msg) => {
      store.handleEntityTeleport(msg.id, msg.x, msg.y, msg.dir);
      predictor.handleTeleport(msg);
    },

    onJsonMessage: (payload) => {
      if(payload&&typeof payload==='object'&&(payload as {type?:string}).type==='event_state'){
        store.event=payload as EventView;
        staffUI.setRole(store.event.role??'player');
        operatorDock.hidden=(store.event.role??'player')!=='superadmin';
        finalReport.update(store.event);
        custody.update(store.event);
        if(store.event.player.checkedOut||store.event.player.insideHome||store.event.player.jailedUntil>store.event.serverTime)input.disable();else if(!paused&&store.cadence&&backend.isConnected())input.enable();
      }
      worldUI.showTerminal(payload);
      if(payload&&typeof payload==='object')eventUI.showTerminal(payload as Record<string,unknown>);
      eventUI.receive(payload);
    },

    onStatusChange: (status) => {
      store.connectionStatus = status;

      if (status.state === 'RECONNECTING') {
        predictor.clearPending();
        input.disable();
        ui.showBanner(
          `Connection lost. Reconnecting (attempt #${status.reconnectAttempt}, in ${status.nextDelayMs}ms)...`,
          'warning'
        );
      } else if (status.state === 'CONNECTED') {
        ui.hideBanner();
      } else if (status.state === 'DISCONNECTED') {
        predictor.clearPending();
        input.disable();

        if (status.closeCode === CLOSE_CODE.INVALID_TOKEN) {
          staffUI.setRole('player');
          operatorDock.hidden=true;
          store.clearSession();
          ui.showBanner('Session expired. Please log in.', 'error');
          ui.setFormDisabled(false);
          ui.showAuth();
        } else if (status.closeCode === CLOSE_CODE.REPLACED) {
          ui.showBanner('Session opened in another window.', 'warning');
        } else if (status.closeCode === CLOSE_CODE.SERVER_FULL) {
          // The server reuses this code for two unrelated refusals: a genuine
          // connection cap, and the event declining to enrol the operator —
          // late registration closed, no operator places left, no Home
          // addresses left. It sends the real reason as the close reason, so
          // show that. Reporting "at capacity" for a closed registration sent
          // players away retrying something retrying cannot fix.
          const reason = (status.closeReason || '').trim();
          ui.showBanner(
            reason && reason !== 'Server full'
              ? `${reason} Ask the organizer if you expected to be admitted.`
              : 'Server at capacity, retry later. Use Enter City to retry.',
            'warning',
          );
          ui.setFormDisabled(false); ui.showAuth();
        }
      }
    },

    onCloseCode: (_code, _reason) => {
      predictor.clearPending();
      input.disable();
    },
  });

  predictor = new MovementPredictor(backend, input);
  eventUI.bind(request=>{if(backend.isConnected())backend.sendJson(request);});
  worldUI.bindInteraction((selected) => {
    if (paused || !store.selfEntity || !store.map || !backend.isConnected()) return;
    if(selected.kind==='event'){backend.sendJson({type:'game_action',action:'event_enter',id:selected.id==='courier'?'GH-02':'GH-01'});return;}
    backend.sendJson({ type: 'interact', id: selected.id });
  });

  // The world fills the viewport. Floating HUD surfaces never resize the map.
  const syncViewport = () => {
    const height = Math.max(160, Math.round(window.visualViewport?.height ?? window.innerHeight));
    document.documentElement.style.setProperty('--hud-top', '0px');
    document.documentElement.style.setProperty('--hud-bottom', '0px');
    renderer.resize(window.innerWidth, height);
    camera.resize(window.innerWidth, height);
  };

  let viewportFrame = 0;
  const scheduleViewportSync = () => {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      syncViewport();
    });
  };
  window.addEventListener('resize', scheduleViewportSync);
  window.visualViewport?.addEventListener('resize', scheduleViewportSync);
  syncViewport();

  // Auth orchestration handlers
  const handleAuthSuccess = async (token: string, username: string) => {
    store.saveSession(token, username);
    ui.setAuthStatus('Loading city routes…');

    try {
      store.map = await fetchMap();
      worldUI.setMap(store.map);
      worldUI.toggleInspector(false);
      ui.setAuthStatus('Entering Veyra City…');
      backend.connect(token);
      // First-timers get the briefing once they are actually in the city.
      help?.offerOnFirstEntry();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.setAuthStatus(msg, true);
      ui.setFormDisabled(false);
    }
  };

  const handleLogin = async (user: string, pass: string) => {
    if (!user || !pass) {
      ui.setAuthStatus('Please enter codename and access key', true);
      return;
    }
    ui.setFormDisabled(true);
    ui.setAuthStatus('Authenticating agent...');
    try {
      const res = await apiLogin(user, pass);
      await handleAuthSuccess(res.token, res.username);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.setAuthStatus(msg, true);
      ui.setFormDisabled(false);
    }
  };

  const handleRegister = async (user: string, pass: string) => {
    if (!user || !pass) {
      ui.setAuthStatus('Please enter codename and access key', true);
      return;
    }
    ui.setFormDisabled(true);
    ui.setAuthStatus('Enrolling agent with server...');
    try {
      // Read the optional organizer fields straight from the form. A missing
      // input or an empty value is simply omitted; nothing here can block the
      // sign-up, which is why none of it is validated client-side.
      const field = (id: string) =>
        (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ||
        undefined;
      const res = await apiRegister(user, pass, {
        fullName: field('auth-fullname'),
        email: field('auth-email'),
        phone: field('auth-phone'),
        team: field('auth-team'),
      });
      await handleAuthSuccess(res.token, res.username);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ui.setAuthStatus(msg, true);
      ui.setFormDisabled(false);
    }
  };

  ui.bindAuthButtons(handleLogin, handleRegister);

  // Auto-resume if stored token exists in sessionStorage (30-second ghost window)
  if (store.token) {
    ui.setFormDisabled(true);
    ui.setAuthStatus('Found active session. Resuming...');
    handleAuthSuccess(store.token, store.username);
  } else {
    ui.showAuth();
  }

  // Expose game context for diagnostics and testing
  (window as unknown as { __GAME__: unknown }).__GAME__ = {
    store,
    ui,
    input,
    predictor,
    backend,
    camera,
    renderer,
    worldUI,
  };

  // Start game loop: update logic separated from rendering
  const loop = new GameLoop(
    (_dt, now) => {
      predictor.update(now);
    },
    (_interp, now) => {
      renderer.render(store, input.debugOverlayVisible, input.debugCollisionVisible, now);
      worldUI.update(now);
      eventUI.update(now);
    }
  );

  loop.start();
}

window.addEventListener('DOMContentLoaded', () => {
  main().catch((err) => console.error('[The Heist Main Fatal Error]:', err));
});
