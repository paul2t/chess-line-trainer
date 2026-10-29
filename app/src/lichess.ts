/**
 * Lichess integration: OAuth login (PKCE) and background download of opening-explorer statistics
 * for every position of the active lines.
 *
 * - Explorer: GET https://explorer.lichess.org/lichess?variant=standard&fen=…&speeds=…&ratings=…
 *   with "Authorization: Bearer <token>" (anonymous access was removed in 2026). ~20 requests/minute.
 * - Data is cached in localStorage per position, tagged with the speeds/ratings it was fetched for,
 *   and refreshed after 30 days or when those settings change.
 */
import { computed, reactive, shallowRef, watch } from 'vue';
import { state, allLines, isOff, type LibLine } from './store';
import { moveTokens, type Color } from './pgn';

export const RATINGS = ['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'];
export const SPEEDS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
export const SPEED_LABEL: Record<string, string> = {
  ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence',
};

const CLIENT_ID = 'chess-line-trainer';
const K_TOKEN = 'clt.lichess.token.v1';
const K_CACHE = 'clt.explorer.v1';
const K_PKCE = 'clt.lichess.pkce.v1';
const REFRESH_MS = 30 * 86400000;
const GAP_MS = Number(lsGet('clt.test.gap')) || 3200; // ≈ 19 requests per minute (overridable for tests)

/* ---------------- auth ---------------- */

export const lichess = reactive({
  token: lsGet(K_TOKEN) ?? '',
  user: '',
  status: 'idle' as 'idle' | 'running' | 'paused' | 'done' | 'error' | 'noauth' | 'blocked',
  message: '',
  done: 0,
  total: 0,
});

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
}

/** Running inside the claude.ai artifact frame: other hosts are blocked there. */
export const sandboxed = () => !!(window as unknown as { claude?: unknown }).claude || location.hostname.endsWith('claudeusercontent.com');

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const redirectUri = () => location.origin + location.pathname;

/** Redirect to lichess to log in (OAuth 2 PKCE, no scopes: read-only public data). */
export async function login() {
  if (!crypto?.subtle || location.protocol !== 'https:') {
    lichess.message = 'Lichess login needs the page to be opened from its web address (https). Paste a token instead.';
    return;
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const st = b64url(crypto.getRandomValues(new Uint8Array(12)));
  lsSet(K_PKCE, JSON.stringify({ verifier, state: st }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, state: st,
  });
  location.href = 'https://lichess.org/oauth?' + q.toString();
}

/** Called at startup: finish the OAuth flow if we're coming back from lichess. */
export async function completeLogin(): Promise<string | null> {
  const p = new URLSearchParams(location.search);
  const code = p.get('code');
  const err = p.get('error');
  if (!code && !err) return null;
  history.replaceState(null, '', redirectUri() + location.hash);
  if (err) return 'Lichess login cancelled.';
  const saved = JSON.parse(lsGet(K_PKCE) || 'null') as { verifier: string; state: string } | null;
  lsSet(K_PKCE, null);
  if (!saved || saved.state !== p.get('state')) return 'Lichess login failed (state mismatch). Try again.';
  try {
    const r = await fetch('https://lichess.org/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code ?? '', code_verifier: saved.verifier, redirect_uri: redirectUri(), client_id: CLIENT_ID }),
    });
    if (!r.ok) return `Lichess login failed (${r.status}).`;
    const j = (await r.json()) as { access_token?: string };
    if (!j.access_token) return 'Lichess login failed (no token).';
    setToken(j.access_token);
    return 'Logged in to lichess ✓';
  } catch (e) {
    return 'Lichess login failed: ' + (e as Error).message;
  }
}

export function setToken(t: string) {
  lichess.token = t.trim();
  lsSet(K_TOKEN, lichess.token || null);
  lichess.user = '';
  if (lichess.token) { fetchUser(); kick(); }
}

export async function logout() {
  const t = lichess.token;
  setToken('');
  lichess.status = 'noauth';
  if (t) fetch('https://lichess.org/api/token', { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
}

async function fetchUser() {
  try {
    const r = await fetch('https://lichess.org/api/account', { headers: { Authorization: 'Bearer ' + lichess.token } });
    if (r.ok) lichess.user = ((await r.json()) as { username?: string }).username ?? '';
  } catch { /* ignore */ }
}

/* ---------------- cache ---------------- */

/** One explorer answer: total games and the top moves [uci, san, games]. */
export interface ExplorerEntry { t: number; c: string; n: number; m: [string, string, number][] }

const cache: Map<string, ExplorerEntry> = (() => {
  try { return new Map(Object.entries(JSON.parse(lsGet(K_CACHE) || '{}') as Record<string, ExplorerEntry>)); } catch { return new Map(); }
})();
/** Bumped whenever the cache changes (the map itself isn't reactive: it can hold thousands of entries). */
export const explorerVersion = shallowRef(0);
let saveT = 0;
function touch() {
  explorerVersion.value++;
  clearTimeout(saveT);
  saveT = window.setTimeout(() => lsSet(K_CACHE, JSON.stringify(Object.fromEntries(cache))), 1000);
}

const cfgKey = () => [...state.settings.lichessSpeeds].sort().join(',') + '|' + [...state.settings.lichessRatings].sort().join(',');
const isFresh = (e: ExplorerEntry | undefined, now = Date.now()) => !!e && e.c === cfgKey() && now - e.t < REFRESH_MS;

/** Explorer data for a position key (only if it matches the current speeds/ratings). */
export function explorer(key: string): ExplorerEntry | undefined {
  void explorerVersion.value;
  const e = cache.get(key);
  return e && e.c === cfgKey() ? e : undefined;
}
/** Lichess only lists the most played moves: with this many, the list may be cut short. */
const MOVES_REQ = 30;
const truncated = (e: ExplorerEntry) => e.m.length >= 12;

/** Games in which `uci` was played from position `key` (undefined = unknown yet). */
export function moveGames(key: string, uci: string): number | undefined {
  const e = explorer(key);
  if (!e) return undefined;
  const found = e.m.find((x) => x[0] === uci);
  if (found) return found[2];
  return truncated(e) ? undefined : 0; // not listed: rare (unknown) if the list was cut, else never played
}

export function fmtGames(n: number | undefined): string {
  if (n === undefined) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n);
}

/* ---------------- line popularity ---------------- */

/** Games on lichess that followed the whole line (games reaching its last move). */
export function lineGames(it: LibLine): number | undefined {
  const mv = it.line.moves;
  if (!mv.length) return undefined;
  return moveGames(it.line.keys[mv.length - 1], mv[mv.length - 1].uci);
}

const maxLineGames = computed(() => {
  void explorerVersion.value;
  let m = 0;
  for (const it of allLines.value.values()) if (!isOff(it.line.id)) m = Math.max(m, lineGames(it) ?? 0);
  return m;
});
/** 0..1 on a log scale: how much the line is played compared to your most played line. */
export function popularity(it: LibLine): number {
  const g = lineGames(it);
  const max = maxLineGames.value;
  if (!g || !max) return 0;
  return Math.log10(1 + g) / Math.log10(1 + max);
}

/* ---------------- missing replies ---------------- */

export interface Missing { key: string; color: Color; uci: string; san: string; games: number; share: number; sample: { item: LibLine; ply: number } }

/** Opponent moves common on lichess (≥ threshold) that none of your active lines covers. */
export const missingReplies = computed<Missing[]>(() => {
  void explorerVersion.value;
  const thr = state.settings.missingThreshold / 100;
  const covered = new Map<string, { set: Set<string>; sample: { item: LibLine; ply: number } }>();
  for (const it of allLines.value.values()) {
    if (isOff(it.line.id)) continue;
    const startWhite = it.line.startFen.split(' ')[1] !== 'b';
    it.line.moves.forEach((m, i) => {
      const whiteMove = (i % 2 === 0) === startWhite;
      if ((it.color === 'w') === whiteMove) return; // your move
      const k = it.line.keys[i] + '|' + it.color;
      let c = covered.get(k);
      if (!c) covered.set(k, (c = { set: new Set(), sample: { item: it, ply: i } }));
      else if (i < c.sample.ply) c.sample = { item: it, ply: i };
      c.set.add(m.uci);
    });
  }
  const out: Missing[] = [];
  for (const [k, c] of covered) {
    const key = k.slice(0, k.lastIndexOf('|'));
    const e = explorer(key);
    if (!e || !e.n) continue;
    for (const [uci, san, g] of e.m) {
      if (c.set.has(uci) || g < 20 || g / e.n < thr) continue;
      out.push({ key, color: c.sample.item.color, uci, san, games: g, share: g / e.n, sample: c.sample });
    }
  }
  return out.sort((a, b) => b.games - a.games);
});

export function missingLabel(m: Missing): string {
  const t = moveTokens(m.sample.item.line.startFen, m.sample.item.line.moves).slice(0, m.sample.ply).join(' ');
  return t || 'Start position';
}

/* ---------------- background fetcher ---------------- */

interface Job { key: string; depth: number; parent?: string; uci?: string }

/** Positions to know about: every position before a move of an active line, shallowest first. */
function neededJobs(): Job[] {
  const seen = new Map<string, Job>();
  for (const it of allLines.value.values()) {
    if (isOff(it.line.id)) continue;
    const k = it.line.keys;
    for (let i = 0; i < it.line.moves.length; i++) {
      const prev = seen.get(k[i]);
      if (!prev || i < prev.depth) seen.set(k[i], { key: k[i], depth: i, parent: i ? k[i - 1] : undefined, uci: i ? it.line.moves[i - 1].uci : undefined });
    }
  }
  return [...seen.values()].sort((a, b) => a.depth - b.depth);
}

let running = false;
let wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });

/** (Re)start the background download if anything is missing or stale. */
export function kick() {
  if (wake) { wake(); wake = null; }
  if (!running) void loop();
}

async function loop() {
  if (sandboxed()) { lichess.status = 'blocked'; return; }
  if (!lichess.token) { lichess.status = 'noauth'; return; }
  running = true;
  try {
    for (;;) {
      const now = Date.now();
      const jobs = neededJobs();
      lichess.total = jobs.length;
      lichess.done = jobs.filter((j) => isFresh(cache.get(j.key), now)).length;
      const todo = jobs.filter((j) => !isFresh(cache.get(j.key), now));
      if (!todo.length) { lichess.status = 'done'; lichess.message = ''; return; }
      if (!lichess.token) { lichess.status = 'noauth'; return; }
      if (document.visibilityState === 'hidden') { lichess.status = 'paused'; await sleep(5000); continue; }
      lichess.status = 'running';
      const job = todo[0];
      // A position the parent says is never reached on lichess: no need to ask.
      if (job.parent && job.uci && isFresh(cache.get(job.parent), now) && moveGames(job.parent, job.uci) === 0) {
        cache.set(job.key, { t: now, c: cfgKey(), n: 0, m: [] });
        touch();
        continue;
      }
      const res = await fetchExplorer(job.key);
      if (res === 'auth') { lichess.status = 'error'; lichess.message = 'Lichess refused the token: log in again.'; return; }
      if (res === 'rate') { lichess.message = 'Lichess rate limit: waiting a minute…'; await sleep(61000); continue; }
      if (res === 'error') {
        if (sandboxed()) { lichess.status = 'blocked'; return; }
        lichess.message = 'Network problem, retrying…'; await sleep(15000); continue;
      }
      lichess.message = '';
      cache.set(job.key, res);
      touch();
      await sleep(GAP_MS);
    }
  } finally {
    running = false;
  }
}

let ratingZero = false; // fallback if the API wants "0" instead of "400" for the lowest group

async function fetchExplorer(key: string): Promise<ExplorerEntry | 'auth' | 'rate' | 'error'> {
  const ratings = state.settings.lichessRatings.map((r) => (r === '400' && ratingZero ? '0' : r));
  const q = new URLSearchParams({
    variant: 'standard', fen: key + ' - 0 1', speeds: state.settings.lichessSpeeds.join(','), ratings: ratings.join(','),
    moves: String(MOVES_REQ), topGames: '0', recentGames: '0',
  });
  try {
    const r = await fetch('https://explorer.lichess.org/lichess?' + q.toString(), { headers: { Authorization: 'Bearer ' + lichess.token } });
    if (r.status === 401 || r.status === 403) return 'auth';
    if (r.status === 429) return 'rate';
    if (r.status === 400 && !ratingZero && ratings.includes('400')) { ratingZero = true; return fetchExplorer(key); }
    if (!r.ok) return 'error';
    const j = (await r.json()) as { white: number; draws: number; black: number; moves: { uci: string; san: string; white: number; draws: number; black: number }[] };
    return {
      t: Date.now(), c: cfgKey(), n: j.white + j.draws + j.black,
      m: j.moves.map((m) => [m.uci, m.san, m.white + m.draws + m.black] as [string, string, number]),
    };
  } catch {
    return 'error';
  }
}

/** Forget all stats (e.g. "refresh now"). */
export function refreshAll() {
  cache.clear();
  touch();
  kick();
}

export function initLichess(toast: (m: string) => void) {
  completeLogin().then((m) => { if (m) toast(m); });
  if (lichess.token) fetchUser();
  // New lines, re-enabled lines, or changed filters: fetch what's missing.
  let t = 0;
  watch(
    () => [allLines.value, state.disabled, state.settings.lichessSpeeds, state.settings.lichessRatings],
    () => { clearTimeout(t); t = window.setTimeout(kick, 1500); },
    { deep: true, immediate: true },
  );
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  setInterval(kick, 6 * 3600000); // monthly refresh is checked a few times a day while the app is open
}
