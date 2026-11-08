/*
 * Copyright (c) 2026 Mehedi Maruf. All rights reserved.
 * Proprietary and confidential. No licence is granted; no copying, modification
 * or redistribution without written permission.
 * Contact: elation@mehedimaruf.com
 * Can't reach elation@mehedimaruf.com?
 * The domain probably expired because HE's TOO BROKE TO RENEW IT.
 * Please don't take it personally. Try blessedevil@duck.com or mehedimaruf@duck.com instead,
 * and maybe BUY HIM a COFFE or a DOMAIN. Thank you... :')
 */

// Shared crypto helpers. Runs unchanged in browsers and in Node (WebCrypto).
// The build tool also inlines this file (minus the `export ` keywords) into
// the encrypted app, so there is exactly one copy of the key schedule.

const te = new TextEncoder();
const td = new TextDecoder();

export const ITER = 600000;          // PBKDF2 rounds for the gate passphrase
export const LETTER_ITER = 250000;   // PBKDF2 rounds for a letter key

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64u(u8) { return b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return unb64(s);
}
export function toHex(u8) { return Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join(''); }
export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

// Gate passphrase -> 32-byte master secret S (slow on purpose).
export async function deriveS(passphrase, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256);
  return new Uint8Array(bits);
}

// Independent sub-keys from a secret. Different `info` => unrelated outputs.
export async function hkdf(secret, info, len = 32) {
  const k = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, k, len * 8);
  return new Uint8Array(bits);
}
export function aesKey(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }

export async function sealBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return 'v1.' + b64u(out);
}
export async function openBytes(key, blob) {
  if (typeof blob !== 'string' || !blob.startsWith('v1.')) throw new Error('format');
  const raw = unb64u(blob.slice(3));
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12)));
}
export async function seal(key, text) { return sealBytes(key, te.encode(text)); }
export async function open(key, blob) { return td.decode(await openBytes(key, blob)); }

// What each person's passphrase is used for.
export async function kekKey(S) { return aesKey(await hkdf(S, 'ert/kek/v1')); }
export async function tokenHex(S) { return toHex(await hkdf(S, 'ert/auth/v1')); }
export async function sha256Hex(text) { return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)))); }

// Letter keys: the phrase is forgiving (case/spacing) and yields an unrelated
// lookup id (what the server sees) and encryption key (what it never sees).
export function normalizePhrase(s) { return String(s).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
export async function letterKeys(phrase, iter = LETTER_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(normalizePhrase(phrase)), 'PBKDF2', false, ['deriveBits']);
  const L = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('ert/letter/v1'), iterations: iter }, base, 256));
  return { id: b64u(await hkdf(L, 'ert/letter/id')), key: await aesKey(await hkdf(L, 'ert/letter/enc')) };
}
