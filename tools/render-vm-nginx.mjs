/** Render one public hostname; never read the private environment or write files. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function renderNginx(domain, stage) {
  // ASCII DNS names only. Reject directives, schemes, ports and wildcards.
  if (typeof domain !== 'string' || domain.length > 253 || !domain.includes('.') ||
      !domain.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s)) ||
      /^\d+(?:\.\d+){3}$/.test(domain) || /(^|\.)example\.(com|net|org)$/i.test(domain)) {
    throw new Error('Use your actual public DNS hostname, without scheme, port or path');
  }
  if (!['bootstrap', 'https'].includes(stage)) throw new Error('Stage must be bootstrap or https');
  const template = readFileSync(new URL(`../deploy/azure/nginx-${stage}.conf.template`, import.meta.url), 'utf8');
  return template.replaceAll('${HEIST_DOMAIN}', domain.toLowerCase());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const domain = args.find(a => a.startsWith('--domain='))?.slice(9);
  const stage = args.find(a => a.startsWith('--stage='))?.slice(8);
  try {
    if (args.length !== 2) throw new Error('Usage: node tools/render-vm-nginx.mjs --domain=YOUR_DNS_HOSTNAME --stage=bootstrap|https');
    process.stdout.write(renderNginx(domain, stage));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
