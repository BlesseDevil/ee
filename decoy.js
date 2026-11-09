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

// The public face: a fake terminal. Anything typed is treated as a possible
// key; if it opens the vault, this page is replaced by the real app.
import * as C from './ertcrypto.mjs';

const V = window.__ERT;
const $ = (id) => document.getElementById(id);
const out = $('out'), form = $('f'), input = $('k'), term = $('term');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Everything that keeps running is registered here so it can be killed
// before the page is swapped for the app.
const timers = new Set();
const listeners = [];
let raf = 0, dead = false;
const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
const on = (t, ev, fn) => { t.addEventListener(ev, fn); listeners.push([t, ev, fn]); };
function stopAll() {
  dead = true;
  cancelAnimationFrame(raf);
  timers.forEach(clearTimeout); timers.clear();
  listeners.forEach(([t, ev, fn]) => t.removeEventListener(ev, fn));
  listeners.length = 0;
}

function line(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text + '\n';
  out.appendChild(s);
  term.scrollTop = term.scrollHeight;
  return s;
}
const sleep = (ms) => new Promise((r) => later(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---- background rain --------------------------------------------------------
function rain() {
  const cv = $('rain'), cx = cv.getContext('2d');
  const glyphs = 'アイウエオカキクケコサシスセソ0123456789ABCDEF<>/\\|=+*'.split('');
  let cols = [], size = 16, w = 0, h = 0, last = 0;
  const fit = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr;
    size = 16 * dpr;
    cols = Array.from({ length: Math.ceil(w / size) }, () => Math.random() * -50);
    cx.font = size + 'px monospace';
  };
  fit();
  on(window, 'resize', fit);
  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 55) return;
    last = t;
    cx.fillStyle = 'rgba(3,10,5,.12)'; cx.fillRect(0, 0, w, h);
    cx.fillStyle = '#38e070';
    for (let i = 0; i < cols.length; i++) {
      cx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, cols[i] * size);
      if (cols[i] * size > h && Math.random() > 0.975) cols[i] = 0;
      cols[i] += 1;
    }
  };
  raf = requestAnimationFrame(frame);
}

// ---- unlocking -------------------------------------------------------------
async function tryOpen(S) {
  const kek = await C.kekKey(S);
  for (const slot of V.slots) {
    let M;
    try { M = await C.openBytes(kek, slot); } catch { continue; }
    try { return JSON.parse(await C.open(await C.aesKey(M), V.payload)); } catch { return null; }
  }
  return null;
}

function launch(app, S) {
  stopAll();
  try { sessionStorage.setItem('ert.s', C.b64(S)); } catch { /* session simply will not persist */ }
  const cfg = JSON.stringify(app.cfg).replace(/</g, '\\u003c');
  const html = app.html.replace('<!--CFG-->', () => '<script>window.__CFG=' + cfg + '<\/script>');
  document.open();
  document.write(html);
  document.close();
}

let attempts = 0, busy = false;

async function submit(ev) {
  ev.preventDefault();
  if (busy || dead) return;
  const pass = input.value;
  if (!pass) return;
  busy = true;
  input.value = ''; input.disabled = true;
  line('access key > ' + '*'.repeat(Math.min(pass.length, 24)), 'dim');
  const spin = line('verifying signature ', 'dim');
  let n = 0;
  const tick = setInterval(() => { spin.textContent = 'verifying signature ' + '▒'.repeat(1 + (n++ % 6)) + '\n'; }, 160);
  timers.add(tick);

  // Separate "the browser cannot do this" (e.g. plain http has no WebCrypto) from "wrong key",
  // so a missing certificate never masquerades as a rejected passphrase.
  let app = null, S = null, envFail = false;
  try { S = await C.deriveS(pass, C.unb64(V.salt), V.iter); } catch { envFail = true; }
  if (!envFail) { try { app = await tryOpen(S); } catch { app = null; } }
  clearInterval(tick); timers.delete(tick);

  if (envFail) {
    spin.textContent = 'verifying signature ▒ failed\n';
    line('ERR: secure channel required. open this node over https.', 'bad');
    busy = false; input.disabled = false; input.focus();
    return;
  }

  if (app) {
    spin.textContent = 'verifying signature ▒▒▒▒▒▒ done\n';
    line('ACCESS GRANTED', 'ok');
    await sleep(reduced ? 150 : 650);
    launch(app, S);
    return;
  }
  attempts++;
  line(pick(['ACCESS DENIED', 'ACCESS DENIED: signature mismatch', 'ACCESS DENIED: key rejected']), 'bad');
  if (attempts >= 3) {
    line('repeated failures from this host. tracing route...', 'warn');
    for (let i = 1; i <= 5; i++) {
      await sleep(reduced ? 80 : 420);
      line(`  hop ${i}: ${[10, (Math.random() * 223 + 1) | 0, (Math.random() * 255) | 0, (Math.random() * 255) | 0].join('.')}  ${(Math.random() * 90 + 8).toFixed(1)} ms`, 'dim');
    }
    await sleep(reduced ? 80 : 600);
    line('trace lost. session reset.', 'warn');
    attempts = 0;
    await sleep(reduced ? 80 : 1200);
  }
  busy = false; input.disabled = false; input.focus();
}

// ---- plain http: say so, show the https link, and take them there -----------------------
// Browsers switch off the encryption this page needs on http, so a key could never work. localhost is exempt.
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
function insecure() {
  document.documentElement.classList.remove('resuming');
  const url = 'https://' + location.host + location.pathname + location.search;
  line('relay-69  secure shell gateway  v4.2.1', '');
  line('', '');
  line('[ fail ] insecure channel detected (http)', 'bad');
  line('this node only answers over https. rerouting...', 'warn');
  const a = document.createElement('a');
  a.href = url; a.textContent = url; a.className = 'lnk';
  const s = document.createElement('span');
  s.append('open it securely > ', a, '\n');
  out.appendChild(s);
  later(() => location.replace(url), 1800);
}

// ---- boot ------------------------------------------------------------------
async function boot() {
  if (location.protocol === 'http:' && !isLocalHost) return insecure();
  try {
    const S = sessionStorage.getItem('ert.s');
    if (S) {
      const app = await tryOpen(C.unb64(S));
      if (app) return launch(app, C.unb64(S));
      sessionStorage.removeItem('ert.s');
    }
  } catch { /* fall through to the terminal */ }
  document.documentElement.classList.remove('resuming');

  rain();
  on(form, 'submit', submit);
  on(document, 'click', () => { if (!input.disabled) input.focus(); });

  const lines = [
    ['relay-69  secure shell gateway  v4.2.1', ''],
    ['', ''],
    ['[  ok  ] loading kernel modules', 'ok'],
    ['[  ok  ] mounting encrypted volumes', 'ok'],
    ['[  ok  ] negotiating handshake with upstream', 'ok'],
    ['[ warn ] unauthorised access is logged', 'warn'],
    ['', ''],
  ];
  for (const [t, c] of lines) { line(t, c); await sleep(reduced ? 0 : 150 + Math.random() * 180); }
  if (!window.isSecureContext || !(window.crypto && crypto.subtle)) line('[ fail ] no secure channel: this node only answers over https', 'bad');
  line('restricted node. authorised personnel only.', 'dim');
  line('', '');
  form.hidden = false;
  input.focus();
}

boot();
