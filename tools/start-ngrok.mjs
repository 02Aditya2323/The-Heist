import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import ngrok from '@ngrok/ngrok';
import { playerTrafficPolicy } from './ngrok-policy.mjs';

// This helper only adds a tunnel: no database access, reset, restart or clock change.
try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let listener;
const keepAlive = setInterval(() => {}, 60_000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  await listener?.close().catch(() => {});
  await ngrok.disconnect().catch(() => {});
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

try {
  if (!process.env.NGROK_AUTHTOKEN) {
    throw new Error('Set NGROK_AUTHTOKEN in the ignored root .env file first.');
  }
  const health = await fetch('http://127.0.0.1:8080/health', {
    signal: AbortSignal.timeout(5_000),
  });
  if (!health.ok || !(await health.json()).ok) {
    throw new Error('The game must already be running on localhost:8080.');
  }
  listener = await ngrok.forward({
    addr: '127.0.0.1:8080',
    authtoken_from_env: true,
    schemes: ['https'],
    traffic_policy: JSON.stringify(playerTrafficPolicy),
  });
  console.log(`GAME_PUBLIC_URL=${listener.url()}`);
  console.log('Share that HTTPS address with your friend; use separate player accounts.');
  console.log('Staff/editor/diagnostic paths are blocked on this tunnel. Keep this process and the game server running.');
  console.log('Press Ctrl+C to close only the tunnel (the game keeps running).');
} catch (error) {
  // SDK authentication errors may contain credentials: always redact before printing.
  const secret = process.env.NGROK_AUTHTOKEN;
  const message = String(error.message ?? error);
  console.error(secret ? message.split(secret).join('[redacted]') : message);
  await stop();
  process.exitCode = 1;
}
