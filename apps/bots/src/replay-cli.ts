/**
 * apps/bots/src/replay-cli.ts
 *
 * CLI handler for `npm run bots:replay -- bot-runs/<run-folder>`
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateReplayHtml } from './tools/replay-generator.js';

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith('--'));

  if (!targetArg) {
    console.error('Usage: npm run bots:replay -- bot-runs/<run-folder>');
    process.exit(1);
  }

  const runDir = resolve(process.cwd(), targetArg);
  if (!existsSync(runDir)) {
    console.error(`Error: Run folder not found at ${runDir}`);
    process.exit(1);
  }

  // Load map data
  let mapData: any = null;
  const devMapPath = resolve(process.cwd(), 'maps/dev-map.json');
  if (existsSync(devMapPath)) {
    try {
      mapData = JSON.parse(readFileSync(devMapPath, 'utf8'));
    } catch {}
  }

  console.log(`[replay-cli] Generating replay viewer for ${runDir}...`);
  const replayHtmlPath = generateReplayHtml(runDir, mapData);

  console.log(`\n✅ Replay viewer ready at:\nfile://${replayHtmlPath}\n`);
  console.log(`To open in default browser on macOS, run:`);
  console.log(`open "${replayHtmlPath}"\n`);
}

main().catch((err) => {
  console.error('[replay-cli] Fatal error:', err);
  process.exit(1);
});
