/* eslint-disable security/detect-non-literal-fs-filename -- every path derives from configDir() (our own config dir), never from untrusted content */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TokenSet } from './oauth.js';

/** Where credentials live (overridable via SITEWRIGHT_CONFIG_DIR — used by tests). */
export function configDir(): string {
  return process.env.SITEWRIGHT_CONFIG_DIR ?? join(homedir(), '.sitewright');
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

/** Issuer URL → token set. */
type Store = Record<string, TokenSet>;

function normalize(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

function readStore(): Store {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  // Write-then-rename: atomic on POSIX, so a concurrent login/refresh can't observe
  // or lose a half-written store. 0600 — the file holds bearer + refresh tokens.
  const dest = credentialsPath();
  const tmp = `${dest}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(tmp, dest);
}

export function loadCredentials(issuer: string): TokenSet | null {
  return readStore()[normalize(issuer)] ?? null;
}

export function saveCredentials(issuer: string, tokens: TokenSet): void {
  const store = readStore();
  store[normalize(issuer)] = tokens;
  writeStore(store);
}

export function clearCredentials(issuer: string): void {
  const store = readStore();
  delete store[normalize(issuer)];
  writeStore(store);
}
