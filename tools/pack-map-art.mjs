/** Lossless transport encoding only: no resize, sharpening, recoloring or AI modification. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const root = resolve(import.meta.dirname, '..');
const v2=process.argv.includes('--v2');
const layout = JSON.parse(readFileSync(resolve(root, v2?'maps/art-world-v2.layout.json':'maps/art-world.layout.json'), 'utf8'));
const report = [];
const packed=new Set();
for (const scene of layout.scenes) {
  const name=`${layout.assetPrefix||''}${scene.asset||scene.id}`;if(packed.has(name))continue;packed.add(name);
  const source = resolve(root, layout.sourceRoot||'THE_HEIST_ZERO_HOUR_Visual_Reference_Pack', scene.source);
  const destination = resolve(root, 'apps/client/public/art/scenes', `${name}.webp`);
  const original = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const encoded = await sharp(source).webp({lossless:true, effort:6}).toFile(destination);
  const decoded = await sharp(destination).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if (!original.data.equals(decoded.data)) throw new Error(`Decoded pixels changed: ${scene.id}`);
  report.push({scene:scene.id,asset:name,width:original.info.width,height:original.info.height,pngBytes:readFileSync(source).length,webpBytes:encoded.size,identicalDecodedPixels:true,
    sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),webpSha256:createHash('sha256').update(readFileSync(destination)).digest('hex')});
}
writeFileSync(resolve(root, v2?'maps/art-transport-report-v2.json':'maps/art-transport-report.json'), JSON.stringify(report,null,2)+'\n');
const before = report.reduce((n,r)=>n+r.pngBytes,0), after = report.reduce((n,r)=>n+r.webpBytes,0);
console.log(`All ${report.length} maps verified pixel-identical. ${(before/1048576).toFixed(1)} MiB → ${(after/1048576).toFixed(1)} MiB (${Math.round((1-after/before)*100)}% smaller).`);
