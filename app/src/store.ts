import { reactive, watch, computed, shallowRef } from 'vue';
import { parsePgn, pgnToLines, buildLine, DEFAULT_FEN, posKey, type Color, type Line } from './pgn';

export const DAY = 86400000;

export type Mode = 'smart' | 'today' | 'all' | 'random' | 'position';

/** Old data model (v1): a PGN file with chapters (games) containing lines. Only read for migration. */
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

/** A line: one sequence of moves with a title. `id` = lineId(start, moves): progress is keyed by it. */
export interface StoredLine {
  id: string;
  title: string;
  color: Color;
  /** Start position, omitted for the standard start. */
  fen?: string;
  /** Moves in UCI, space separated. */
  moves: string;
  /** Comments after moves (ply → text). */
  comments?: Record<number, string>;
}

/** A chapter: a named list of lines (what a PGN file becomes when imported). */
export interface Chapter {
  id: string;
  name: string;
  /** Default side for new lines of this chapter. */
  color: Color;
  lines: StoredLine[];
  added: number;
  updated: number;
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



const K_FILES = 'clt.files.v1'; // old model, kept untouched as a fallback after migration
const K_CHAPTERS = 'clt.chapters.v2';
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

export const newId = () => Math.random().toString(36).slice(2, 10);

/* ---------- migration v1 (files → chapters → lines) to v2 (chapters → lines) ---------- */

/** A line as stored, from a parsed line. */
function storeLine(l: Line, title: string, color: Color): StoredLine {
  const comments: Record<number, string> = {};
  l.moves.forEach((m, i) => { if (m.comment) comments[i] = m.comment; });
  const sl: StoredLine = { id: l.id, title, color, moves: l.moves.map((m) => m.uci).join(' ') };
  if (posKey(l.startFen) !== posKey(DEFAULT_FEN)) sl.fen = l.startFen;
  if (Object.keys(comments).length) sl.comments = comments;
  return sl;
}

/**
 * Old PGN file → chapter (same id and name). Each old chapter (game) → one line per variation path,
 * titled with the old chapter name (+ the move where it branches off when there are several).
 * Line ids are unchanged, so progress / disabled / selection keep working.
 */
export function migrateFile(f: PgnFile): Chapter {
  const games = parsePgn(f.text);
  const colorOf = (gi: number): Color => f.colors?.[gi] ?? f.color ?? games[gi].guessedColor;
  const lines: StoredLine[] = [];
  const seen = new Set<string>();
  for (const o of pgnToLines(f.text, (g) => g.name)) {
    if (seen.has(o.line.id)) continue;
    seen.add(o.line.id);
    lines.push(storeLine(o.line, o.title, colorOf(games.indexOf(o.game))));
  }
  const black = lines.filter((l) => l.color === 'b').length;
  return {
    id: f.id, name: f.name, color: f.color ?? (black > lines.length / 2 ? 'b' : 'w'), lines,
    added: f.added ?? Date.now(), updated: f.updated ?? f.added ?? Date.now(),
  };
}

/**
 * Chapters at startup: the v2 data, plus any old v1 PGN file that isn't a chapter yet (and wasn't
 * deleted on purpose). The v1 data is never modified, so nothing can be lost by the migration.
 */
function initialChapters(): Chapter[] {
  const out = load<Chapter[]>(K_CHAPTERS, []);
  const deleted = load<Record<string, number>>(K_DEL, {});
  for (const f of load<PgnFile[]>(K_FILES, [])) {
    if (out.some((c) => c.id === f.id) || deleted[f.id]) continue;
    try { out.push(migrateFile(f)); } catch (e) { console.error('migration failed for', f.name, e); }
  }
  return out;
}

export const state = reactive({
  chapters: initialChapters(),
  stats: load<Record<string, LineStat>>(K_STATS, {}),
  settings: { sessionSize: 10, autoNext: true, repeatFailed: true, opponentDelay: 450, theme: 'blue3', pieceSet: 'cburnett', sound: true, volume: 0.7, searchColor: 'all', lichessRatings: ['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'], lichessSpeeds: ['blitz', 'rapid', 'classical'], missingThreshold: 10, ...load<Partial<Settings>>(K_SETTINGS, {}) } as Settings,
  selection: load<string[]>(K_SEL, []),
  /** Lines excluded from training (line id → true). */
  disabled: load<Record<string, true>>(K_DIS, {}),
  /** Tombstones so a chapter deleted on one device isn't re-uploaded by another. */
  deletedChapters: load<Record<string, number>>(K_DEL, {}),
  /** When settings/selection/disabled last changed. */
  metaUpdated: load<number>(K_META, 0),
});

let tFiles = 0, tStats = 0, tMisc = 0;
watch(() => state.chapters, () => { clearTimeout(tFiles); tFiles = window.setTimeout(() => save(K_CHAPTERS, state.chapters), 200); }, { deep: true, immediate: true });
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
watch(() => state.deletedChapters, () => save(K_DEL, state.deletedChapters), { deep: true });

/* ---------- library (lines rebuilt from their moves) ---------- */

export interface LibEntry { stored: StoredLine; line: Line; color: Color; trainable: boolean }
export interface LibChapter { chapter: Chapter; lines: LibEntry[] }
export interface LibLine { line: Line; color: Color; chapter: Chapter; title: string; lineIndex: number }

const lineCache = new Map<string, Line>();
function built(sl: StoredLine): Line {
  const k = (sl.fen ?? '') + '|' + sl.moves + '|' + (sl.comments ? JSON.stringify(sl.comments) : '');
  let l = lineCache.get(k);
  if (!l) { l = buildLine(sl.fen ?? DEFAULT_FEN, sl.moves ? sl.moves.split(' ') : [], sl.comments); lineCache.set(k, l); }
  return l;
}

export const library = computed<LibChapter[]>(() =>
  state.chapters.map((chapter) => ({
    chapter,
    lines: chapter.lines.map((stored) => {
      const line = built(stored);
      return { stored, line, color: stored.color, trainable: userPlies(line, stored.color) > 0 };
    }),
  })),
);

/** All trainable lines, deduplicated by id (same moves = same line, wherever it appears). */
export const allLines = computed<Map<string, LibLine>>(() => {
  const m = new Map<string, LibLine>();
  for (const lc of library.value)
    lc.lines.forEach((e, lineIndex) => {
      if (m.has(e.line.id) || !e.trainable) return;
      m.set(e.line.id, { line: e.line, color: e.color, chapter: lc.chapter, title: e.stored.title, lineIndex });
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

/** Your moves played from a position in active lines (other than the one being trained count as "also fine"). */
export function userMovesAt(key: string, color: Color): Set<string> {
  const out = new Set<string>();
  for (const it of allLines.value.values()) {
    if (it.color !== color || state.disabled[it.line.id]) continue;
    const i = it.line.keys.indexOf(key);
    if (i >= 0 && i < it.line.moves.length) out.add(it.line.moves[i].uci);
  }
  return out;
}

/* ---------- chapters & lines ---------- */

/** Guess the side of a PGN from its games (Orientation tag / branching pattern). */
export function guessColor(text: string): { color: Color; mixed: boolean } {
  const games = parsePgn(text);
  const b = games.filter((g) => g.guessedColor === 'b').length;
  const oriented = games.filter((g) => g.headers.Orientation).length;
  // Games without variations: look at where the games differ from each other. The side whose
  // moves vary between games is the opponent (a repertoire answers each of their tries one way).
  if (!oriented && games.length > 1) {
    const children = new Map<string, Set<string>>();
    for (const g of games)
      for (const l of g.lines)
        l.moves.forEach((m, i) => {
          const k = l.keys[i];
          let set = children.get(k);
          if (!set) children.set(k, (set = new Set()));
          set.add(m.uci);
        });
    let w = 0, bl = 0;
    for (const [k, set] of children) if (set.size > 1) { if (k.split(' ')[1] === 'w') w++; else bl++; }
    if (w !== bl) return { color: w > bl ? 'b' : 'w', mixed: false };
  }
  return { color: b > games.length / 2 ? 'b' : 'w', mixed: b > 0 && b < games.length };
}

const touch = (c: Chapter) => (c.updated = Date.now());

export function createChapter(name: string, color: Color): Chapter {
  const c: Chapter = { id: newId(), name, color, lines: [], added: Date.now(), updated: Date.now() };
  state.chapters.push(c);
  delete state.deletedChapters[c.id];
  return state.chapters[state.chapters.length - 1];
}

export type ImportTarget = { kind: 'new'; name: string; color: Color | 'auto' } | { kind: 'existing'; chapterId: string };

/**
 * Import a PGN: each game becomes a line titled with its Event (games with variations are split
 * into one line per variation). Lines already in the chapter are skipped.
 */
export function importPgn(text: string, target: ImportTarget): { chapter: Chapter; added: number; skipped: number; games: number } {
  const parts = pgnToLines(text);
  const games = parsePgn(text);
  let ch: Chapter;
  if (target.kind === 'existing') ch = state.chapters.find((c) => c.id === target.chapterId)!;
  else {
    const black = games.filter((g) => g.guessedColor === 'b').length;
    ch = createChapter(target.name, target.color === 'auto' ? (black > games.length / 2 ? 'b' : 'w') : target.color);
  }
  const auto = target.kind === 'new' && target.color === 'auto';
  const have = new Set(ch.lines.map((l) => l.id));
  let added = 0, skipped = 0;
  for (const p of parts) {
    if (have.has(p.line.id)) { skipped++; continue; }
    have.add(p.line.id);
    ch.lines.push(storeLine(p.line, p.title, auto ? p.game.guessedColor : ch.color));
    added++;
  }
  touch(ch);
  return { chapter: ch, added, skipped, games: games.length };
}

/** Add one line (e.g. from the explorer). Returns false if the chapter already has it. */
export function addLine(chapterId: string, title: string, startFen: string, ucis: string[], color: Color): boolean {
  const ch = state.chapters.find((c) => c.id === chapterId);
  if (!ch) return false;
  const line = buildLine(startFen, ucis);
  if (ch.lines.some((l) => l.id === line.id)) return false;
  ch.lines.push(storeLine(line, title, color));
  touch(ch);
  return true;
}

export function removeChapter(id: string) {
  const i = state.chapters.findIndex((c) => c.id === id);
  if (i >= 0) state.chapters.splice(i, 1);
  state.deletedChapters[id] = Date.now();
}
export function renameChapter(c: Chapter, name: string) {
  c.name = name;
  touch(c);
}
export function removeLine(c: Chapter, lineId: string) {
  const i = c.lines.findIndex((l) => l.id === lineId);
  if (i >= 0) { c.lines.splice(i, 1); touch(c); }
}
export function renameLine(c: Chapter, lineId: string, title: string) {
  const l = c.lines.find((x) => x.id === lineId);
  if (l) { l.title = title; touch(c); }
}
/** Side for the whole chapter (all its lines, and new ones). */
export function setChapterColor(c: Chapter, color: Color) {
  c.color = color;
  c.lines.forEach((l) => (l.color = color));
  touch(c);
}
export function setLineColor(c: Chapter, lineId: string, color: Color) {
  const l = c.lines.find((x) => x.id === lineId);
  if (l) { l.color = color; touch(c); }
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
  return JSON.stringify({ app: 'chess-line-trainer', v: 2, exported: Date.now(), chapters: state.chapters, stats: state.stats, settings: state.settings, disabled: state.disabled });
}

/** Import a backup (v2 chapters, or v1 PGN files which are migrated). Chapters are matched by id, then name. */
export function importBackup(json: string): string {
  const data = JSON.parse(json);
  if (data.app !== 'chess-line-trainer') throw new Error('Not a Chess Line Trainer backup');
  const incoming: Chapter[] = data.chapters ?? ((data.files ?? []) as PgnFile[]).map(migrateFile);
  let nc = 0;
  for (const c of incoming) {
    const ex = state.chapters.find((x) => x.id === c.id) ?? state.chapters.find((x) => x.name === c.name);
    if (ex) {
      const have = new Set(ex.lines.map((l) => l.id));
      for (const l of c.lines) if (!have.has(l.id)) ex.lines.push(l);
      touch(ex);
    } else { state.chapters.push({ ...c, updated: Date.now() }); nc++; }
    delete state.deletedChapters[c.id];
  }
  let ns = 0;
  for (const [id, st] of Object.entries((data.stats ?? {}) as Record<string, LineStat>)) {
    const cur = state.stats[id];
    if (!cur || st.lr > cur.lr) { state.stats[id] = st; ns++; }
  }
  if (data.settings) Object.assign(state.settings, data.settings);
  if (data.disabled) Object.assign(state.disabled, data.disabled);
  return `Imported ${incoming.length} chapter(s) (${nc} new) and progress for ${ns} line(s).`;
}

export function setDisabled(ids: Iterable<string>, off: boolean) {
  for (const id of ids) {
    if (off) state.disabled[id] = true;
    else delete state.disabled[id];
  }
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
