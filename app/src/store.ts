import { reactive, watch, computed, shallowRef } from 'vue';
import { parsePgn, type Color, type Game, type Line } from './pgn';

export const DAY = 86400000;

export type Mode = 'smart' | 'today' | 'all' | 'random' | 'position';

export interface PgnFile {
  id: string;
  name: string;
  text: string;
  added: number;
  /** Side this repertoire is for (chosen at import). */
  color?: Color;
  /** Per-game side override (game index → colour). */
  colors: Record<number, Color>;
  /** Last modification (used to merge with the cloud copy). */
  updated?: number;
}

export interface LineStat {
  a: number; // attempts
  e: number; // attempts with at least one mistake
  m: number[]; // timestamps of attempts with mistakes (most recent last, capped)
  lr: number; // last reviewed
  lm: number; // last mistake (0 = never)
  s: number; // clean streak (drives the review interval)
  lc: boolean; // last attempt was clean
  ep: number; // ply of the first mistake in the last failed attempt
  eps?: number[]; // all mistake plies of the last failed attempt
  mc?: number; // total mistakes ever (an attempt can have several)
}

export interface Settings {
  sessionSize: number;
  autoNext: boolean;
  repeatFailed: boolean;
  opponentDelay: number;
  theme: string;
  pieceSet: string;
  sound: boolean;
  volume: number;
  /** Colour filter of the Find & explore screen. */
  searchColor: 'all' | Color;
  /** Lichess explorer filters (rating groups, time controls). */
  lichessRatings: string[];
  lichessSpeeds: string[];
  /** Flag opponent replies played at least this % of the time that your lines don't cover. */
  missingThreshold: number;
}



const K_FILES = 'clt.files.v1';
const K_STATS = 'clt.stats.v1';
const K_SETTINGS = 'clt.settings.v1';
const K_SEL = 'clt.selection.v1';
const K_DIS = 'clt.disabled.v1';
const K_DEL = 'clt.deleted.v1';
const K_META = 'clt.metaupdated.v1';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const storageError = shallowRef('');
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageError.value = '';
  } catch (e) {
    storageError.value = 'Could not save to browser storage (' + (e as Error).message + '). Export a backup from Settings.';
  }
}

export const state = reactive({
  files: load<PgnFile[]>(K_FILES, []),
  stats: load<Record<string, LineStat>>(K_STATS, {}),
  settings: { sessionSize: 10, autoNext: true, repeatFailed: true, opponentDelay: 450, theme: 'blue3', pieceSet: 'cburnett', sound: true, volume: 0.7, searchColor: 'all', lichessRatings: ['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'], lichessSpeeds: ['blitz', 'rapid', 'classical'], missingThreshold: 10, ...load<Partial<Settings>>(K_SETTINGS, {}) } as Settings,
  selection: load<string[]>(K_SEL, []),
  /** Lines excluded from training (line id → true). */
  disabled: load<Record<string, true>>(K_DIS, {}),
  /** Tombstones so a file deleted on one device isn't re-uploaded by another. */
  deletedFiles: load<Record<string, number>>(K_DEL, {}),
  /** When settings/selection/disabled last changed. */
  metaUpdated: load<number>(K_META, 0),
});

let tFiles = 0, tStats = 0, tMisc = 0;
watch(() => state.files, () => { clearTimeout(tFiles); tFiles = window.setTimeout(() => save(K_FILES, state.files), 200); }, { deep: true });
watch(() => state.stats, () => { clearTimeout(tStats); tStats = window.setTimeout(() => save(K_STATS, state.stats), 200); }, { deep: true });
/** Set while applying data that came from the cloud, so it isn't stamped as a local edit. */
export const applying = { remote: false };
watch(() => [state.settings, state.selection, state.disabled], () => {
  if (!applying.remote) state.metaUpdated = Date.now();
  clearTimeout(tMisc);
  tMisc = window.setTimeout(() => {
    save(K_SETTINGS, state.settings); save(K_SEL, state.selection); save(K_DIS, state.disabled); save(K_META, state.metaUpdated);
  }, 200);
}, { deep: true });
watch(() => state.deletedFiles, () => save(K_DEL, state.deletedFiles), { deep: true });

/* ---------- parsed library ---------- */

export interface LibGame { file: PgnFile; index: number; game: Game; color: Color; }
export interface LibLine { line: Line; color: Color; file: PgnFile; gameIndex: number; gameName: string; lineIndex: number; }
export interface LibFile { file: PgnFile; games: LibGame[]; lineCount: number; errors: string[]; }

const parseCache = new Map<string, Game[]>();
function parsed(f: PgnFile): Game[] {
  const key = f.id + ':' + f.text.length + ':' + hashQuick(f.text);
  let g = parseCache.get(key);
  if (!g) { g = parsePgn(f.text); parseCache.set(key, g); }
  return g;
}
function hashQuick(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 2000))) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export const library = computed<LibFile[]>(() =>
  state.files.map((file) => {
    const games = parsed(file).map((game, index) => ({ file, index, game, color: file.colors[index] ?? file.color ?? game.guessedColor }));
    return {
      file,
      games,
      lineCount: games.reduce((a, g) => a + g.game.lines.length, 0),
      errors: games.flatMap((g) => g.game.errors.map((e) => `${g.game.name}: ${e}`)),
    };
  }),
);

/** All trainable lines, deduplicated by id (same moves = same line, wherever it appears). */
export const allLines = computed<Map<string, LibLine>>(() => {
  const m = new Map<string, LibLine>();
  for (const lf of library.value)
    for (const g of lf.games)
      g.game.lines.forEach((line, lineIndex) => {
        if (m.has(line.id)) return;
        if (!userPlies(line, g.color)) return;
        m.set(line.id, { line, color: g.color, file: lf.file, gameIndex: g.index, gameName: g.game.name, lineIndex });
      });
  return m;
});

export function userPlies(line: Line, color: Color): number {
  const startWhite = line.startFen.split(' ')[1] !== 'b';
  let n = 0;
  for (let i = 0; i < line.moves.length; i++) {
    const whiteMove = (i % 2 === 0) === startWhite;
    if ((color === 'w') === whiteMove) n++;
  }
  return n;
}

/* ---------- files ---------- */

/** Guess the side of a whole PGN from its chapters (Orientation tag / branching pattern). */
export function guessColor(text: string): { color: Color; mixed: boolean } {
  const games = parsePgn(text);
  const b = games.filter((g) => g.guessedColor === 'b').length;
  return { color: b > games.length / 2 ? 'b' : 'w', mixed: b > 0 && b < games.length };
}

/** color 'auto' = keep the per-chapter guess (Orientation tag / branching). */
export function addPgn(name: string, text: string, color: Color | 'auto'): { games: number; lines: number; replaced: boolean } {
  const games = parsePgn(text);
  const lines = games.reduce((a, g) => a + g.lines.length, 0);
  const existing = state.files.find((f) => f.name === name);
  if (existing) {
    existing.text = text;
    existing.color = color === 'auto' ? undefined : color;
    existing.colors = {};
    existing.updated = Date.now();
    return { games: games.length, lines, replaced: true };
  }
  state.files.push({ id: Math.random().toString(36).slice(2, 10), name, text, added: Date.now(), updated: Date.now(), color: color === 'auto' ? undefined : color, colors: {} });
  return { games: games.length, lines, replaced: false };
}

export function removeFile(id: string) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i >= 0) state.files.splice(i, 1);
  state.deletedFiles[id] = Date.now();
}

/* ---------- scheduling ---------- */

/** Mistakes weighted by recency: a mistake today counts 1, a week ago 0.5, two weeks ago 0.25… */
export function recentErrors(st: LineStat | undefined, now = Date.now()): number {
  if (!st) return 0;
  return st.m.reduce((acc, t) => acc + Math.pow(0.5, (now - t) / (7 * DAY)), 0);
}

/** Review interval in days after `s` clean reviews in a row: 0, 1, 2, 4, 8 … 60. */
export function intervalDays(st: LineStat | undefined): number {
  if (!st || st.s <= 0) return 0;
  return Math.min(60, Math.pow(2, st.s - 1));
}

export function dueAt(st: LineStat | undefined): number {
  if (!st) return 0;
  return st.lr + intervalDays(st) * DAY;
}

/**
 * Priority for the smart review. Higher = review sooner.
 * - recent mistakes dominate (×3, decaying with a one-week half-life)
 * - then how overdue the line is relative to its interval
 * - never-seen lines get a flat 1
 */
export function priority(st: LineStat | undefined, now = Date.now()): number {
  if (!st || st.a === 0) return 1;
  const iv = intervalDays(st) * DAY;
  const overdue = (now - st.lr - iv) / Math.max(iv, DAY);
  return 3 * recentErrors(st, now) + Math.max(-1, Math.min(overdue, 5));
}

export function isToday(t: number, now = Date.now()): boolean {
  return t > 0 && new Date(t).toDateString() === new Date(now).toDateString();
}

/** Record one run of a line. `errorPlies` = every position (ply) where the user went wrong. */
export function recordAttempt(id: string, errorPlies: number[]) {
  const mistake = errorPlies.length > 0;
  const now = Date.now();
  let st = state.stats[id];
  if (!st) { st = { a: 0, e: 0, m: [], lr: 0, lm: 0, s: 0, lc: false, ep: -1 }; state.stats[id] = st; }
  const wasDue = now >= dueAt(st);
  st.a++;
  if (mistake) {
    st.e++;
    // One timestamp per mistake: lines with more recent mistakes get reviewed sooner.
    for (let i = 0; i < errorPlies.length; i++) st.m.push(now);
    if (st.m.length > 20) st.m.splice(0, st.m.length - 20);
    st.mc = (st.mc ?? st.e - 1) + errorPlies.length;
    st.lm = now;
    st.s = 0;
    st.lc = false;
    st.ep = errorPlies[0];
    st.eps = errorPlies.slice();
  } else {
    // Reviewing early doesn't grow the interval (avoids inflating it by drilling the same day).
    if (wasDue || st.s === 0) st.s++;
    st.lc = true;
  }
  st.lr = now;
}

export type Badge = { text: string; cls: string };
export function lineBadge(st: LineStat | undefined, now = Date.now()): Badge {
  if (!st || st.a === 0) return { text: 'new', cls: 'b-new' };
  if (isToday(st.lm, now)) return st.lc ? { text: 'fixed today', cls: 'b-fixed' } : { text: 'missed today', cls: 'b-bad' };
  if (now >= dueAt(st)) return { text: 'due', cls: 'b-due' };
  const d = Math.ceil((dueAt(st) - now) / DAY);
  return { text: `in ${d}d`, cls: 'b-ok' };
}

export function relDay(t: number, now = Date.now()): string {
  if (!t) return 'never';
  const a = new Date(t); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  const d = Math.round((b.getTime() - a.getTime()) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}

/* ---------- backup ---------- */

export function exportBackup(): string {
  return JSON.stringify({ app: 'chess-line-trainer', v: 1, exported: Date.now(), files: state.files, stats: state.stats, settings: state.settings, disabled: state.disabled });
}

export function importBackup(json: string): string {
  const data = JSON.parse(json);
  if (data.app !== 'chess-line-trainer') throw new Error('Not a Chess Line Trainer backup');
  let nf = 0;
  for (const f of data.files as PgnFile[]) {
    const ex = state.files.find((x) => x.name === f.name);
    if (ex) { ex.text = f.text; ex.colors = f.colors ?? {}; ex.color = f.color; ex.updated = Date.now(); } else { state.files.push({ ...f, updated: Date.now() }); nf++; }
    delete state.deletedFiles[f.id];
  }
  let ns = 0;
  for (const [id, st] of Object.entries(data.stats as Record<string, LineStat>)) {
    const cur = state.stats[id];
    if (!cur || st.lr > cur.lr) { state.stats[id] = st; ns++; }
  }
  if (data.settings) Object.assign(state.settings, data.settings);
  if (data.disabled) Object.assign(state.disabled, data.disabled);
  return `Imported ${data.files.length} PGN file(s) (${nf} new) and progress for ${ns} line(s).`;
}

export function setDisabled(ids: Iterable<string>, off: boolean) {
  for (const id of ids) {
    if (off) state.disabled[id] = true;
    else delete state.disabled[id];
  }
}

export function setFileColor(f: PgnFile, c: Color) {
  f.color = c;
  f.colors = {};
  f.updated = Date.now();
}

export function setGameColor(f: PgnFile, gameIndex: number, c: Color) {
  f.colors[gameIndex] = c;
  f.updated = Date.now();
}

/* ---------- conflicting repertoire moves ---------- */

export interface ConflictOption { uci: string; san: string; ids: string[] }
export interface Conflict {
  key: string;
  color: Color;
  options: ConflictOption[];
  /** Shortest line path reaching the position (for display / search / lichess). */
  sample: { item: LibLine; ply: number };
}

/** Positions where active lines (same side) give different moves for you. */
export const conflicts = computed<Conflict[]>(() => {
  const m = new Map<string, Conflict>();
  for (const it of allLines.value.values()) {
    if (state.disabled[it.line.id]) continue;
    const startWhite = it.line.startFen.split(' ')[1] !== 'b';
    const mv = it.line.moves;
    for (let i = 0; i < mv.length; i++) {
      const whiteMove = (i % 2 === 0) === startWhite;
      if ((it.color === 'w') !== whiteMove) continue;
      const k = it.line.keys[i] + '|' + it.color;
      let c = m.get(k);
      if (!c) { c = { key: k, color: it.color, options: [], sample: { item: it, ply: i } }; m.set(k, c); }
      else if (i < c.sample.ply) c.sample = { item: it, ply: i };
      let o = c.options.find((x) => x.uci === mv[i].uci);
      if (!o) { o = { uci: mv[i].uci, san: mv[i].san, ids: [] }; c.options.push(o); }
      if (!o.ids.includes(it.line.id)) o.ids.push(it.line.id);
    }
  }
  return [...m.values()].filter((c) => c.options.length > 1).sort((a, b) => a.sample.ply - b.sample.ply);
});

/** Position (start FEN + moves) where a conflict happens, for the search screen / lichess. */
export function conflictPosition(c: Conflict): { fen: string; moves: string[] } {
  return { fen: c.sample.item.line.startFen, moves: c.sample.item.line.moves.slice(0, c.sample.ply).map((m) => m.uci) };
}
