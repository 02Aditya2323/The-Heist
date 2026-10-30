/**
 * apps/bots/src/tools/replay-generator.ts
 *
 * Generates a self-contained, single-file replay.html driven by server-truth positions (server-positions.jsonl)
 * with map rendering, trails, entity inspector, timeline scrub, event markers, and metrics line charts.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function generateReplayHtml(runDir: string, mapData: any): string {
  const serverPositionsFile = join(runDir, 'server-positions.jsonl');
  const metricsCsvFile = join(runDir, 'metrics.csv');
  const eventsJsonFile = join(runDir, 'events.json');
  const reportJsonFile = join(runDir, 'report.json');
  const botsDir = join(runDir, 'bots');

  // Read server positions
  const positionsLines = existsSync(serverPositionsFile)
    ? readFileSync(serverPositionsFile, 'utf8').split('\n').filter(Boolean)
    : [];
  const frames = positionsLines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

  // Read metrics CSV
  let metricsRows: any[] = [];
  if (existsSync(metricsCsvFile)) {
    const lines = readFileSync(metricsCsvFile, 'utf8').split('\n').filter(Boolean);
    const headers = lines[0]?.split(',') || [];
    metricsRows = lines.slice(1).map((l) => {
      const parts = l.split(',');
      const row: Record<string, any> = {};
      headers.forEach((h, i) => {
        row[h.trim()] = parseFloat(parts[i]) || parts[i];
      });
      return row;
    });
  }

  // Read events
  let events: any[] = [];
  if (existsSync(eventsJsonFile)) {
    try {
      events = JSON.parse(readFileSync(eventsJsonFile, 'utf8'));
    } catch {}
  }

  // Read report
  let report: any = null;
  if (existsSync(reportJsonFile)) {
    try {
      report = JSON.parse(readFileSync(reportJsonFile, 'utf8'));
    } catch {}
  }

  // Read bot traces (last 20 events per bot)
  const botTraces: Record<string, any[]> = {};
  if (existsSync(botsDir)) {
    const files = readdirSync(botsDir).filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      const botId = f.replace('.jsonl', '');
      const content = readFileSync(join(botsDir, f), 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const eventsList = lines.map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      }).filter(Boolean);
      botTraces[botId] = eventsList.slice(-25); // last 25 events
    }
  }

  const payload = {
    map: mapData,
    frames,
    metrics: metricsRows,
    events,
    report,
    botTraces,
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>The Heist - Realistic Bot Replay Viewer</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--panel);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
    header .stats-badge { font-size: 13px; color: var(--text-muted); }
    .main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .viewport {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      background: #020617;
    }
    .canvas-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: auto;
    }
    canvas#mapCanvas {
      background: #020617;
      border: 1px solid var(--border);
      cursor: crosshair;
    }
    .sidebar {
      width: 340px;
      background: var(--panel);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px;
      gap: 16px;
    }
    .card {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
    }
    .card h3 { font-size: 14px; margin-bottom: 8px; color: var(--accent); }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .controls {
      background: var(--panel);
      border-top: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .timeline-bar {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    input[type=range] {
      flex: 1;
      cursor: pointer;
    }
    .btn-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    button {
      background: #334155;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
    }
    button:hover { background: #475569; }
    button.active { background: var(--accent); color: #020617; }
    .chart-container {
      display: flex;
      gap: 16px;
      height: 90px;
      background: #090d16;
      border-top: 1px solid var(--border);
      padding: 6px 16px;
    }
    .chart-box {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .chart-box span { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
    canvas.chartCanvas { width: 100%; height: 65px; }
    .event-item {
      font-size: 11px;
      font-family: monospace;
      padding: 4px 6px;
      border-bottom: 1px solid #1e293b;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>The Heist - Realistic Replay</h1>
      <span class="stats-badge" id="headerSummary">Loading run data...</span>
    </div>
    <div class="stats-badge" id="frameCounter">Frame 0 / 0</div>
  </header>

  <div class="main-container">
    <div class="viewport">
      <div class="canvas-wrap">
        <canvas id="mapCanvas" width="768" height="768"></canvas>
      </div>

      <div class="chart-container">
        <div class="chart-box">
          <span>Connected Players Over Time</span>
          <canvas id="playersChart" class="chartCanvas"></canvas>
        </div>
        <div class="chart-box">
          <span>Server Tick p99 (ms)</span>
          <canvas id="tickChart" class="chartCanvas"></canvas>
        </div>
      </div>

      <div class="controls">
        <div class="timeline-bar">
          <button id="playBtn">Play</button>
          <input type="range" id="timeSlider" min="0" max="100" value="0">
          <span id="timeLabel" style="font-size: 12px; font-family: monospace; min-width: 60px;">0.0s</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="btn-group">
            <button id="speed1" class="active">1x</button>
            <button id="speed4">4x</button>
            <button id="speed16">16x</button>
            <button id="toggleTrails" class="active">Trails</button>
            <button id="toggleGrid">Chunk Grid</button>
            <button id="toggleLabels">Labels</button>
          </div>
          <div style="font-size: 12px; color: var(--text-muted);">
            Tip: Click any bot dot to view its trace log
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar">
      <div class="card" id="inspectorCard">
        <h3>Bot Inspector</h3>
        <p style="font-size: 12px; color: var(--text-muted);">Click on any entity dot in the map to inspect its real-time telemetry and last 20 trace events.</p>
      </div>

      <div class="card">
        <h3>Legend</h3>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px;">
          <div><span style="color:#3b82f6;">●</span> Roamer (45%)</div>
          <div><span style="color:#10b981;">●</span> Hotspot (20%)</div>
          <div><span style="color:#a855f7;">●</span> Explorer (10%)</div>
          <div><span style="color:#f59e0b;">●</span> Border (10%)</div>
          <div><span style="color:#06b6d4;">●</span> AFK (5%)</div>
          <div><span style="color:#f97316;">●</span> Reconnector (5%)</div>
          <div><span style="color:#ec4899;">●</span> Pauser (5%)</div>
          <div><span style="color:#6b7280;">●</span> Disconnected / Ghost</div>
        </div>
      </div>

      <div class="card" id="eventsCard">
        <h3>Scheduled Timeline Events</h3>
        <div id="eventsList" style="font-size: 12px; display:flex; flex-direction:column; gap:4px;"></div>
      </div>
    </div>
  </div>

  <script>
    const DATA = ${JSON.stringify(payload)};

    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const timeSlider = document.getElementById('timeSlider');
    const timeLabel = document.getElementById('timeLabel');
    const playBtn = document.getElementById('playBtn');
    const frameCounter = document.getElementById('frameCounter');

    let currentFrameIdx = 0;
    let isPlaying = false;
    let playSpeed = 1;
    let showTrails = true;
    let showGrid = false;
    let showLabels = false;
    let selectedEntityId = null;

    const frames = DATA.frames || [];
    const totalFrames = frames.length;
    timeSlider.max = Math.max(0, totalFrames - 1);

    // Trails history: Map of entityId -> Array<{x, y, tick}>
    const trailsMap = new Map();

    const BEHAVIOUR_COLORS = {
      'roamer': '#3b82f6',
      'hotspot-goer': '#10b981',
      'explorer': '#a855f7',
      'border-crosser': '#f59e0b',
      'afk': '#06b6d4',
      'reconnector': '#f97316',
      'human-pauser': '#ec4899',
    };

    function initUI() {
      if (DATA.report) {
        document.getElementById('headerSummary').textContent =
          DATA.report.runId + ' | Bots: ' + (DATA.report.botCount || 'N/A') + ' | Status: ' + (DATA.report.status || 'PASS');
      }

      const eventsList = document.getElementById('eventsList');
      if (DATA.events && DATA.events.length > 0) {
        eventsList.innerHTML = DATA.events.map(e =>
          '<div style="color:var(--accent);">t=' + (e.timeSec || 0) + 's: ' + (e.name || e.event) + '</div>'
        ).join('');
      } else {
        eventsList.textContent = 'None scheduled';
      }

      drawCharts();
      renderFrame(0);
    }

    function renderFrame(idx) {
      if (!frames[idx]) return;
      currentFrameIdx = idx;
      const frame = frames[idx];

      frameCounter.textContent = 'Frame ' + (idx + 1) + ' / ' + totalFrames + ' (tick ' + (frame.tick || idx) + ')';
      timeSlider.value = idx;
      timeLabel.textContent = ((frame.tick || idx) * 0.05).toFixed(1) + 's';

      const map = DATA.map;
      const tileSize = canvas.width / (map ? map.width : 48);

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw map collision
      if (map && map.collision) {
        ctx.fillStyle = '#1e293b';
        for (let y = 0; y < map.height; y++) {
          const row = map.collision[y] || '';
          for (let x = 0; x < map.width; x++) {
            if (row[x] === '1') {
              ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
          }
        }
      }

      // Draw chunk grid
      if (showGrid) {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        const chunkSize = 16 * tileSize;
        for (let x = 0; x < canvas.width; x += chunkSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += chunkSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // Draw hotspots
      if (map && map.hotspots) {
        for (const spot of map.hotspots) {
          ctx.fillStyle = 'rgba(234, 179, 8, 0.2)';
          ctx.beginPath();
          ctx.arc((spot.x + 0.5) * tileSize, (spot.y + 0.5) * tileSize, tileSize * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#eab308';
          ctx.font = '10px sans-serif';
          ctx.fillText(spot.name, spot.x * tileSize - 10, spot.y * tileSize - 6);
        }
      }

      // Record trails
      const entities = frame.entities || [];
      for (const ent of entities) {
        if (!trailsMap.has(ent.id)) trailsMap.set(ent.id, []);
        const trail = trailsMap.get(ent.id);
        trail.push({ x: ent.x, y: ent.y, tick: frame.tick });
        if (trail.length > 25) trail.shift();
      }

      // Draw trails
      if (showTrails) {
        for (const [id, trail] of trailsMap) {
          if (trail.length < 2) continue;
          ctx.strokeStyle = id === selectedEntityId ? '#ef4444' : 'rgba(56, 189, 248, 0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo((trail[0].x + 0.5) * tileSize, (trail[0].y + 0.5) * tileSize);
          for (let i = 1; i < trail.length; i++) {
            ctx.lineTo((trail[i].x + 0.5) * tileSize, (trail[i].y + 0.5) * tileSize);
          }
          ctx.stroke();
        }
      }

      // Draw entities
      for (const ent of entities) {
        const cx = (ent.x + 0.5) * tileSize;
        const cy = (ent.y + 0.5) * tileSize;

        let color = '#3b82f6';
        if (DATA.report && DATA.report.perBot) {
          const bInfo = DATA.report.perBot.find(b => b.id === ent.name);
          if (bInfo) color = BEHAVIOUR_COLORS[bInfo.behaviour] || '#3b82f6';
        }
        if (!ent.connected) color = '#6b7280'; // grey for ghost

        ctx.fillStyle = ent.id === selectedEntityId ? '#ef4444' : color;
        ctx.beginPath();
        ctx.arc(cx, cy, ent.id === selectedEntityId ? tileSize * 0.7 : tileSize * 0.45, 0, Math.PI * 2);
        ctx.fill();

        if (showLabels) {
          ctx.fillStyle = '#f8fafc';
          ctx.font = '9px monospace';
          ctx.fillText(ent.name || ent.id, cx + 4, cy - 4);
        }
      }
    }

    function drawCharts() {
      const pCanvas = document.getElementById('playersChart');
      const tCanvas = document.getElementById('tickChart');
      if (!DATA.metrics || DATA.metrics.length === 0) return;

      const pCtx = pCanvas.getContext('2d');
      const tCtx = tCanvas.getContext('2d');

      pCanvas.width = pCanvas.clientWidth * 2;
      pCanvas.height = pCanvas.clientHeight * 2;
      tCanvas.width = tCanvas.clientWidth * 2;
      tCanvas.height = tCanvas.clientHeight * 2;

      // Draw players chart
      const rows = DATA.metrics;
      const maxPlayers = Math.max(...rows.map(r => r.players || 0), 10);
      pCtx.strokeStyle = '#38bdf8';
      pCtx.lineWidth = 2;
      pCtx.beginPath();
      rows.forEach((r, i) => {
        const x = (i / (rows.length - 1)) * pCanvas.width;
        const y = pCanvas.height - ((r.players || 0) / maxPlayers) * pCanvas.height;
        if (i === 0) pCtx.moveTo(x, y);
        else pCtx.lineTo(x, y);
      });
      pCtx.stroke();

      // Draw tick chart
      const maxTick = Math.max(...rows.map(r => r.tickDurationP99 || r.tickP99 || 5), 10);
      tCtx.strokeStyle = '#a855f7';
      tCtx.lineWidth = 2;
      tCtx.beginPath();
      rows.forEach((r, i) => {
        const val = r.tickDurationP99 || r.tickP99 || 0;
        const x = (i / (rows.length - 1)) * tCanvas.width;
        const y = tCanvas.height - (val / maxTick) * tCanvas.height;
        if (i === 0) tCtx.moveTo(x, y);
        else tCtx.lineTo(x, y);
      });
      tCtx.stroke();
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const map = DATA.map;
      const tileSize = canvas.width / (map ? map.width : 48);

      const frame = frames[currentFrameIdx];
      if (!frame) return;

      let found = null;
      for (const ent of frame.entities || []) {
        const cx = (ent.x + 0.5) * tileSize;
        const cy = (ent.y + 0.5) * tileSize;
        const dist = Math.hypot(clickX - cx, clickY - cy);
        if (dist < tileSize * 1.5) {
          found = ent;
          break;
        }
      }

      if (found) {
        selectedEntityId = found.id;
        inspectBot(found);
        renderFrame(currentFrameIdx);
      }
    });

    function inspectBot(ent) {
      const card = document.getElementById('inspectorCard');
      const bInfo = DATA.report?.perBot?.find(b => b.id === ent.name);
      const traces = DATA.botTraces[ent.name] || [];

      let traceHtml = traces.map(t =>
        '<div class="event-item">[' + new Date(t.ts).toISOString().slice(14, 21) + '] ' + t.event + ' ' + (t.seq !== undefined ? 'seq=' + t.seq : '') + ' ' + (t.x !== undefined ? '(' + t.x + ',' + t.y + ')' : '') + '</div>'
      ).join('');

      card.innerHTML =
        '<h3>Inspector: ' + (ent.name || ent.id) + '</h3>' +
        '<div style="font-size:12px; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">' +
        '  <div><strong>Behaviour:</strong> ' + (bInfo?.behaviour || 'unknown') + '</div>' +
        '  <div><strong>Network:</strong> ' + (bInfo?.profile || 'unknown') + '</div>' +
        '  <div><strong>Position:</strong> (' + ent.x + ', ' + ent.y + ')</div>' +
        '  <div><strong>Connected:</strong> ' + (ent.connected ? 'YES' : 'NO (GHOST)') + '</div>' +
        '  <div><strong>Steps ACKed:</strong> ' + (bInfo?.stepsAcked || 0) + '</div>' +
        '  <div><strong>Tiles Travelled:</strong> ' + (bInfo?.tilesTravelled || 0) + '</div>' +
        '  <div><strong>Chunk Crossings:</strong> ' + (bInfo?.chunkCrossings || 0) + '</div>' +
        '</div>' +
        '<h4>Recent Trace Events (L1)</h4>' +
        '<div style="max-height: 200px; overflow-y:auto; background:#020617; border-radius:4px;">' +
        (traceHtml || '<div class="event-item">No trace events recorded</div>') +
        '</div>';
    }

    // Playback loop
    function step() {
      if (isPlaying) {
        if (currentFrameIdx < totalFrames - 1) {
          renderFrame(currentFrameIdx + 1);
          setTimeout(step, 1000 / (20 * playSpeed));
        } else {
          isPlaying = false;
          playBtn.textContent = 'Play';
        }
      }
    }

    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? 'Pause' : 'Play';
      if (isPlaying) step();
    });

    timeSlider.addEventListener('input', (e) => {
      renderFrame(parseInt(e.target.value, 10));
    });

    document.getElementById('speed1').addEventListener('click', (e) => { setSpeed(1, e.target); });
    document.getElementById('speed4').addEventListener('click', (e) => { setSpeed(4, e.target); });
    document.getElementById('speed16').addEventListener('click', (e) => { setSpeed(16, e.target); });

    function setSpeed(s, btn) {
      playSpeed = s;
      document.querySelectorAll('.btn-group button').forEach(b => {
        if (b.id.startsWith('speed')) b.classList.remove('active');
      });
      btn.classList.add('active');
    }

    document.getElementById('toggleTrails').addEventListener('click', (e) => {
      showTrails = !showTrails;
      e.target.classList.toggle('active');
      renderFrame(currentFrameIdx);
    });

    document.getElementById('toggleGrid').addEventListener('click', (e) => {
      showGrid = !showGrid;
      e.target.classList.toggle('active');
      renderFrame(currentFrameIdx);
    });

    document.getElementById('toggleLabels').addEventListener('click', (e) => {
      showLabels = !showLabels;
      e.target.classList.toggle('active');
      renderFrame(currentFrameIdx);
    });

    initUI();
  </script>
</body>
</html>`;

  const outputPath = join(runDir, 'replay.html');
  writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}
