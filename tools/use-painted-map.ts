/**
 * Utility script to apply an exported painted map to the server.
 * Backs up maps/dev-map.json to maps/dev-map.backup.json,
 * bumps the map version by 1, and writes the new map.
 * Also syncs painted.json manifest to apps/client/public/art/painted.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

function main() {
  const rootDir = process.cwd();
  const devMapPath = path.resolve(rootDir, 'maps/dev-map.json');
  const backupMapPath = path.resolve(rootDir, 'maps/dev-map.backup.json');
  const clientArtManifestPath = path.resolve(rootDir, 'apps/client/public/art/painted.json');

  // Find source map.json
  const args = process.argv.slice(2);
  let srcMapPath = args[0];

  if (!srcMapPath) {
    // Check candidate locations
    const candidates = [
      path.resolve(rootDir, 'map.json'),
      path.resolve(rootDir, 'maps/painted-map.json'),
      path.resolve(rootDir, 'apps/client/public/art/map.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        srcMapPath = c;
        break;
      }
    }
  }

  if (!srcMapPath || !fs.existsSync(srcMapPath)) {
    console.error(`❌ Source map file not found. Specify path as argument: npx tsx tools/use-painted-map.ts <path/to/map.json>`);
    process.exit(1);
  }

  // Read current dev-map.json to get current version
  let currentVersion = 1;
  if (fs.existsSync(devMapPath)) {
    try {
      const currentData = JSON.parse(fs.readFileSync(devMapPath, 'utf-8'));
      if (typeof currentData.version === 'number') {
        currentVersion = currentData.version;
      }
      // Create backup
      fs.copyFileSync(devMapPath, backupMapPath);
      console.log(`📦 Backed up old map to: ${backupMapPath}`);
    } catch (err) {
      console.warn(`⚠️ Warning: could not parse existing dev-map.json for version, defaulting to 1`);
    }
  }

  // Load new map
  const newMapContent = fs.readFileSync(srcMapPath, 'utf-8');
  const newMap = JSON.parse(newMapContent);

  // Bump version
  newMap.version = currentVersion + 1;

  // Validate server format
  if (!newMap.width || !newMap.height || !Array.isArray(newMap.collision)) {
    console.error(`❌ Invalid map format. Expected width, height, and collision array.`);
    process.exit(1);
  }

  // Write updated map to maps/dev-map.json
  fs.writeFileSync(devMapPath, JSON.stringify(newMap, null, 2), 'utf-8');
  console.log(`✅ Applied painted map to: ${devMapPath}`);
  console.log(`   Dimensions: ${newMap.width}x${newMap.height} tiles`);
  console.log(`   Version: ${newMap.version} (bumped from ${currentVersion})`);
  console.log(`   Spawns: ${newMap.spawns?.length ?? 0}`);
  console.log(`   Hotspots: ${newMap.hotspots?.length ?? 0}`);

  // Check for painted.json manifest alongside map.json or in standard location
  let srcManifestPath = args[1];
  if (!srcManifestPath) {
    const candidateManifests = [
      path.resolve(path.dirname(srcMapPath), 'painted.json'),
      path.resolve(rootDir, 'painted.json'),
      clientArtManifestPath,
    ];
    for (const cm of candidateManifests) {
      if (fs.existsSync(cm)) {
        srcManifestPath = cm;
        break;
      }
    }
  }

  if (srcManifestPath && fs.existsSync(srcManifestPath) && srcManifestPath !== clientArtManifestPath) {
    fs.copyFileSync(srcManifestPath, clientArtManifestPath);
    console.log(`🎨 Synced painted manifest to: ${clientArtManifestPath}`);
  }

  console.log('\n======================================================');
  console.log('🚀 READY! To restart the server with the new map, run:');
  console.log('   npm run dev:server');
  console.log('======================================================\n');
}

main();
