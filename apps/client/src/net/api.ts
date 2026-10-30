/**
 * HTTP REST API integration for authentication and static map loading.
 */

import { loadMap, type GameMap, type MapData } from '@heist/shared';

export interface AuthResponse {
  token: string;
  playerId: string;
  username: string;
}

export function getApiBaseUrl(): string {
  return '';
}

export function getWsBaseUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Optional contact details for the organizer's roster. Every field may be
 * omitted: registration must never fail because somebody left one blank.
 */
export interface RegisterProfile {
  fullName?: string;
  email?: string;
  phone?: string;
  team?: string;
}

export async function apiRegister(
  username: string,
  password: string,
  profile: RegisterProfile = {},
): Promise<AuthResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...profile }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Registration failed');
  }
  return data as AuthResponse;
}

export async function apiLogin(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Login failed');
  }
  return data as AuthResponse;
}

export async function fetchMap(): Promise<GameMap> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/map`, { cache: 'no-store' });
      if (!res.ok) throw new Error('The city server is unavailable. Retry in a moment.');
      return loadMap((await res.json()) as MapData);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}
