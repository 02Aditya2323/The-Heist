/**
 * apps/bots/src/main.ts
 *
 * CLI Entrypoint for running bot scenarios:
 * - npm run bots -- --scenario=probes
 * - npm run bots -- --scenario=canary
 * - npm run bots -- --scenario=realistic --bots=20 --duration=300 --seed=1
 * - npm run bots -- --scenario=realistic --bots=50 --duration=480 --seed=2
 * - npm run bots -- --scenario=realistic --bots=100 --duration=600 --seed=3
 */

import { ConformanceProbes } from './scenarios/probes.js';
import { CanarySuite } from './scenarios/canary.js';
import { RealisticRunner } from './scenarios/realistic.js';
import { TestHarness, type ScenarioResult } from './harness.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npm run bots -- [options]

Options:
  --scenario=<name>    Scenario to run:
                       'probes'    - Phase 0 Conformance Probes (P1-P8)
                       'canary'    - Fault-injecting Proxy Canary Suite (C1-C6)
                       'realistic' - Realistic N-bot long-running verification
                       'quick'     - Quick sanity check (20 bots, 30s)
  --bots=<number>      Number of bots (default: 20)
  --duration=<seconds> Run duration in seconds (default: 300)
  --seed=<number>      RNG seed for reproducibility (default: 1)
  --help, -h           Show this help message

Examples:
  npm run bots -- --scenario=probes
  npm run bots -- --scenario=canary
  npm run bots -- --scenario=realistic --bots=20  --duration=300 --seed=1
  npm run bots -- --scenario=realistic --bots=50  --duration=480 --seed=2
  npm run bots -- --scenario=realistic --bots=100 --duration=600 --seed=3
`);
    process.exit(0);
  }

  const httpUrl = process.env.HTTP_URL || 'http://127.0.0.1:8080';
  const wsUrl = process.env.WS_URL || 'ws://127.0.0.1:8080';
  const debugToken = process.env.DEBUG_TOKEN;
  const serverPid = process.env.SERVER_PID ? parseInt(process.env.SERVER_PID, 10) : undefined;

  console.log(`[bot-harness] Targeting server at ${httpUrl}`);

  // Check server health first
  try {
    const healthRes = await fetch(`${httpUrl}/health`);
    if (!healthRes.ok) throw new Error('Server returned non-200');
  } catch (err) {
    console.error(`[bot-harness] ERROR: Cannot reach server at ${httpUrl}/health.`);
    console.error(`[bot-harness] Please start the server first with: npm run dev:server`);
    process.exit(1);
  }

  const scenarioArg = args.find((a) => a.startsWith('--scenario='))?.split('=')[1] || 'realistic';
  const botsArg = args.find((a) => a.startsWith('--bots='))?.split('=')[1];
  const durationArg = args.find((a) => a.startsWith('--duration='))?.split('=')[1];
  const seedArg = args.find((a) => a.startsWith('--seed='))?.split('=')[1];

  const botCount = botsArg ? parseInt(botsArg, 10) : 20;
  const durationSec = durationArg ? parseInt(durationArg, 10) : 300;
  const seed = seedArg ? parseInt(seedArg, 10) : 1;

  if (scenarioArg === 'probes') {
    const probes = new ConformanceProbes({ httpUrl, wsUrl, debugToken });
    await probes.init();
    const results = await probes.runAll();
    const allPassed = results.every((r) => r.passed);
    process.exit(allPassed ? 0 : 1);
  }

  if (scenarioArg === 'canary') {
    const canarySuite = new CanarySuite({ httpUrl, wsUrl });
    await canarySuite.init();
    const results = await canarySuite.runAll();
    const allDetected = results.every((r) => r.detected);
    if (allDetected) {
      console.log('✅ ALL CANARIES DETECTED: Verification layers successfully caught all injected faults.');
      process.exit(0);
    } else {
      console.error('❌ CANARY FAILURE: One or more canaries were NOT detected by verification layers.');
      process.exit(1);
    }
  }

  if (scenarioArg === 'realistic') {
    const runner = new RealisticRunner({
      botCount,
      durationSec,
      seed,
      httpUrl,
      wsUrl,
      debugToken,
      serverPid,
    });
    const summary = await runner.run();
    console.log(`\n======================================================`);
    console.log(`🏁 Realistic Run Complete: Status = ${summary.status}`);
    console.log(`   Artifacts saved to: ${summary.runDir}`);
    console.log(`======================================================\n`);
    process.exit(summary.status === 'PASS' ? 0 : 1);
  }

  if (scenarioArg === 'quick') {
    const runner = new RealisticRunner({
      botCount: 20,
      durationSec: 90,
      seed: 1,
      httpUrl,
      wsUrl,
      debugToken,
      serverPid,
    });
    const summary = await runner.run();
    console.log(`\n======================================================`);
    console.log(`🏁 Quick Run Complete: Status = ${summary.status}`);
    console.log(`======================================================\n`);
    process.exit(summary.status === 'PASS' ? 0 : 1);
  }

  // Fallback to legacy TestHarness for traffic / login / reconnect
  const harness = new TestHarness({ httpUrl, wsUrl });
  await harness.init();
  const results: ScenarioResult[] = [];
  try {
    if (scenarioArg === 'login' || scenarioArg === 'all') {
      const res = await harness.runLoginStorm(botCount, durationSec * 1000);
      results.push(res);
    }
    if (scenarioArg === 'reconnect' || scenarioArg === 'all') {
      const res = await harness.runReconnectStorm(botCount);
      results.push(res);
    }
    if (scenarioArg === 'traffic' || scenarioArg === 'all') {
      const res = await harness.runTrafficValidation(botCount, durationSec);
      results.push(res);
    }
  } finally {
    harness.stopAll();
  }
  harness.printReport(results);
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((err) => {
  console.error('[bot-harness] Fatal error:', err);
  process.exit(1);
});
