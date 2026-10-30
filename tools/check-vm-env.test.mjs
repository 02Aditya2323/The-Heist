import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVmEnv } from './check-vm-env.mjs';

const valid = {
  DATABASE_BACKEND: 'mongodb', NODE_ENV: 'production', DEBUG_ENDPOINTS: 'false',
  HOST: '127.0.0.1', PORT: '8080', MONGODB_DATABASE: 'isolated_example',
  MONGODB_URI: 'mongodb+srv://fixture:fixture-only@cluster.example.com/?appName=Test',
};
test('accepts VM settings without requiring ngrok', () => assert.doesNotThrow(() => validateVmEnv(valid)));
for (const [key, value] of Object.entries({
  DATABASE_BACKEND: 'sqlite', NODE_ENV: 'development', DEBUG_ENDPOINTS: 'true',
  HOST: '0.0.0.0', PORT: '5173', MONGODB_DATABASE: '', MONGODB_URI: 'not-a-uri',
})) {
  test(`rejects unsafe or missing ${key}`, () => assert.throws(() => validateVmEnv({ ...valid, [key]: value })));
}
test('rejects a copied placeholder without exposing its value', () => {
  const uri = 'mongodb+srv://USERNAME:PASSWORD@HOST/?appName=TheHeist';
  assert.throws(() => validateVmEnv({ ...valid, MONGODB_URI: uri }), (error) => !error.message.includes(uri));
});
test('rejects non-Mongo protocols without exposing credentials', () => {
  const uri = 'https://private-user:private-pass@example.com';
  assert.throws(() => validateVmEnv({ ...valid, MONGODB_URI: uri }), (error) => !error.message.includes(uri));
});
test('does not reject real values just because a password contains the word password', () => {
  assert.doesNotThrow(() => validateVmEnv({ ...valid,
    MONGODB_URI: 'mongodb+srv://fixture:ExamplePasswordWithMoreCharacters@cluster.example.com/' }));
});
