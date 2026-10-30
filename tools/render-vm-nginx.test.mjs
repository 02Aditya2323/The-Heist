import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNginx } from './render-vm-nginx.mjs';

test('bootstrap serves ACME only, never the game over plaintext', () => {
  const config = renderNginx('heist.westus.cloudapp.azure.com', 'bootstrap');
  assert(config.includes('server_name heist.westus.cloudapp.azure.com;'));
  assert(config.includes('location / { return 404; }'));
  assert(!config.includes('proxy_pass'));
  assert(!config.includes('${HEIST_DOMAIN}'));
});
test('HTTPS renders certificate paths while preserving nginx request variables', () => {
  const config = renderNginx('Heist.westus.cloudapp.azure.com', 'https');
  assert(config.includes('/live/heist.westus.cloudapp.azure.com/fullchain.pem'));
  assert(config.includes('https://heist.westus.cloudapp.azure.com$request_uri'));
  assert(config.includes('try_files $uri =404'));
  assert(config.includes('include /etc/nginx/snippets/heist-player.conf'));
});
test('rejects placeholder, IP, invalid hostname and directive injection', () => {
  for (const domain of [undefined, '', 'example.com', 'replace-me.example.com', '127.0.0.1',
    'https://heist.test', 'heist.test:443', 'heist.test/a', 'heist.test; include /tmp/x;',
    'heist.test\n}', '*.heist.test', '-heist.test', 'heist..test', 'x'.repeat(64) + '.test']) {
    assert.throws(() => renderNginx(domain, 'https'));
  }
  assert.throws(() => renderNginx('heist.test', 'unknown'));
});
