import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const original = process.env.HOST;
afterEach(() => {
  if (original === undefined) delete process.env.HOST;
  else process.env.HOST = original;
});
describe('deployment listener configuration', () => {
  it('preserves the existing LAN listener when no host override is set', () => {
    delete process.env.HOST;
    expect(loadConfig().host).toBe('0.0.0.0');
  });
  it('allows the VM to bind only to loopback behind HTTPS', () => {
    process.env.HOST = '127.0.0.1';
    expect(loadConfig().host).toBe('127.0.0.1');
  });
});
