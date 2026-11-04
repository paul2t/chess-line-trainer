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
  /** Legacy (before one side per chapter): only read by normalizeChapters, which removes it. */
  color?: Color;
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
  /** The side you play in every line of this chapter. */
  color: Color;
  /** Chapter switched off: its lines aren't trained, whatever their own on/off state. */
  disabled?: boolean;
  /** Book the chapter belongs to (none = loose chapter). */
  book?: string;
  /** Imported from a lichess study chapter: the lines that came from it (local additions are kept on sync). */
  src?: StudySource;
  lines: StoredLine[];
  added: number;
  updated: number;
}

/** Where a chapter came from in a lichess study. */
export interface StudySource {
  study: string; // study id (8 chars)
  chapter: string; // study chapter id (or its name when the export had no id)
  name: string; // chapter name at the last sync (renamed here = kept on sync)
  lines: string[]; // ids of the lines that came from the study at the last sync
}

/** A lichess study linked to a book (synchronised on demand). */
export interface StudyLink {
  id: string;
  name: string;
  syncedAt: number;
  /** Last-Modified of the study at the last sync / check. */
  modified?: string;
  checkedAt?: number;
  /** The study changed on lichess since the last sync. */
  changed?: boolean;
  /** Study chapters left out at import (not re-added by a sync). */
  skip?: string[];
}

/** A book: a named group of chapters (e.g. "Caro-Kann"). It can hold White and Black chapters. */
export interface Book {
  id: string;
  name: string;
  /** Book switched off: none of its chapters is trained. */
  disabled?: boolean;
  /** Side tab where an empty book is shown. */
  color?: Color;
  studies?: StudyLink[];
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
  h?: number[]; // results of the last reviews, oldest first: mistakes in each (0 = clean)
  f?: number; // ease: how fast the interval grows after a clean review (lower = harder line)
  iv?: number; // current review interval in days (0 = due again right away)
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
  /** Side tab shown in the library. */
  libraryTab: Color;
  /** Find & explore: leave switched-off lines out of the results. */
  searchHideOff: boolean;
  /** Find & explore: only look at the lines selected in the library (when there is a selection). */
  searchSelectedOnly: boolean;
}



const K_FILES = 'clt.files.v1'; // old model, kept untouched as a fallback after migration
const K_CHAPTERS = 'clt.chapters.v2';
const K_STATS = 'clt.stats.v1';
const K_SETTINGS = 'clt.settings.v1';
const K_SEL = 'clt.selection.v1';
const K_DIS = 'clt.disabled.v1';
const K_DEL = 'clt.deleted.v1';
const K_META = 'clt.metaupdated.v1';
const K_BOOKS = 'clt.books.v1';

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
export function storeLine(l: Line, title: string, color?: Color): StoredLine {
  const comments: Record<number, string> = {};
  l.moves.forEach((m, i) => { if (m.comment) comments[i] = m.comment; });
  const sl: StoredLine = { id: l.id, title, moves: l.moves.map((m) => m.uci).join(' ') };
  if (color) sl.color = color;
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
  normalizeChapters(out);
  return out;
}

const SIDE_NAME: Record<Color, string> = { w: 'White', b: 'Black' };

/**
 * One side per chapter: lines whose (legacy) side differs from their chapter's move to a sibling
 * chapter "<name> (White|Black)" with a stable id (<id>-w / <id>-b), so every device splits the same
 * way. Nothing is dropped. Returns true if anything changed.
 */
export function normalizeChapters(chs: Chapter[]): boolean {
  let changed = false;
  for (const c of [...chs]) {
    for (const color of ['w', 'b'] as Color[]) {
      if (color === c.color) continue;
      const moving = c.lines.filter((l) => l.color && l.color !== c.color && l.color === color);
      if (!moving.length) continue;
      const sid = `${c.id}-${color}`;
      let sib = chs.find((x) => x.id === sid);
      if (!sib) {
        sib = { id: sid, name: `${c.name} (${SIDE_NAME[color]})`, color, lines: [], added: c.added, updated: Date.now(), disabled: c.disabled };
        chs.splice(chs.indexOf(c) + 1, 0, sib);
      }
      const have = new Set(sib.lines.map((l) => l.id));
      for (const l of moving) if (!have.has(l.id)) sib.lines.push(l);
      c.lines = c.lines.filter((l) => !moving.includes(l));
      c.updated = sib.updated = Date.now();
      changed = true;
    }
  }
  for (const c of chs) for (const l of c.lines) if ('color' in l) { delete l.color; changed = true; }
  return changed;
}

export const state = reactive({
  chapters: initialChapters(),
  books: load<Book[]>(K_BOOKS, []),
  stats: load<Record<string, LineStat>>(K_STATS, {}),
  settings: { sessionSize: 10, autoNext: true, repeatFailed: true, opponentDelay: 450, theme: 'blue3', pieceSet: 'cburnett', sound: true, volume: 0.7, searchColor: 'all', lichessRatings: ['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'], lichessSpeeds: ['blitz', 'rapid', 'classical'], missingThreshold: 10, libraryTab: 'w', searchHideOff: false, searchSelectedOnly: true, ...load<Partial<Settings>>(K_SETTINGS, {}) } as Settings,
  selection: load<string[]>(K_SEL, []),
  /** Lines excluded from training (line id → true). */
  disabled: load<Record<string, true>>(K_DIS, {}),
  /** Tombstones so a chapter deleted on one device isn't re-uploaded by another. */
  deletedChapters: load<Record<string, number>>(K_DEL, {}),
  /** When settings/selection/disabled last changed. */
  metaUpdated: load<number>(K_META, 0),
});

/** Saves are debounced; pending ones are written at once when the page is hidden or closed. */
const pendingSaves = new Map<string, () => void>();
function saveSoon(key: string, fn: () => void, ms = 200) {
  pendingSaves.set(key, fn);
  window.setTimeout(() => { const f = pendingSaves.get(key); if (f === fn) { pendingSaves.delete(key); fn(); } }, ms);
}
export function flushSaves() {
  for (const fn of pendingSaves.values()) fn();
  pendingSaves.clear();
}
window.addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });

let tMisc = 0;
watch(() => state.chapters, () => saveSoon(K_CHAPTERS, () => save(K_CHAPTERS, state.chapters)), { deep: true, immediate: true });
watch(() => state.books, () => saveSoon(K_BOOKS, () => save(K_BOOKS, state.books)), { deep: true });
watch(() => state.stats, () => saveSoon(K_STATS, () => save(K_STATS, state.stats)), { deep: true });
/** Set while applying data that came from the cloud, so it isn't stamped as a local edit. */
export const applying = { remote: false };
watch(() => [state.settings, state.selection, state.disabled], () => {
  if (!applying.remote) state.metaUpdated = Date.now();
  void tMisc;
  saveSoon('misc', () => {
    save(K_SETTINGS, state.settings); save(K_SEL, state.selection); save(K_DIS, state.disabled); save(K_META, state.metaUpdated);
  });
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
      return { stored, line, color: chapter.color, trainable: userPlies(line, chapter.color) > 0 };
    }),
  })),
);

/** All trainable lines, deduplicated by id (same moves = same line, wherever it appears). */
export function bookOf(c: Chapter): Book | undefined {
  return c.book ? state.books.find((b) => b.id === c.book) : undefined;
}
/** The chapter is switched off, or its book is. */
export function chapterOff(c: Chapter): boolean {
  return !!c.disabled || !!bookOf(c)?.disabled;
}

export const allLines = computed<Map<string, LibLine>>(() => {
  const m = new Map<string, LibLine>();
  // Enabled chapters first: a line also present in a switched-off chapter stays active.
  for (const pass of [false, true])
    for (const lc of library.value) {
      if (chapterOff(lc.chapter) !== pass) continue;
      lc.lines.forEach((e, lineIndex) => {
        if (m.has(e.line.id) || !e.trainable) return;
        m.set(e.line.id, { line: e.line, color: e.color, chapter: lc.chapter, title: e.stored.title, lineIndex });
      });
    }
  return m;
});

/** A line is off when you switched it off, or when its chapter is off. */
export function isOff(id: string): boolean {
  const it = allLines.value.get(id);
  return !!state.disabled[id] || (!!it && chapterOff(it.chapter));
}

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
    if (it.color !== color || isOff(it.line.id)) continue;
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

export function createChapter(name: string, color: Color, book?: string): Chapter {
  const c: Chapter = { id: newId(), name, color, lines: [], added: Date.now(), updated: Date.now() };
  if (book) c.book = book;
  state.chapters.push(c);
  delete state.deletedChapters[c.id];
  return state.chapters[state.chapters.length - 1];
}

export type ImportTarget = { kind: 'new'; name: string; color: Color | 'auto'; book?: string } | { kind: 'existing'; chapterId: string };

/**
 * Import a PGN: each game becomes a line titled with its Event (games with variations are split
 * into one line per variation). Lines already in the chapter are skipped.
 */
export function importPgn(text: string, target: ImportTarget): { chapter: Chapter; chapters: Chapter[]; added: number; skipped: number; games: number } {
  const parts = pgnToLines(text);
  const games = parsePgn(text);
  // 'auto' = split by side: one chapter per side found in the games.
  const groups: { color: Color | null; parts: typeof parts }[] =
    target.kind === 'new' && target.color === 'auto'
      ? (['w', 'b'] as Color[]).map((c) => ({ color: c, parts: parts.filter((p) => p.game.guessedColor === c) })).filter((g) => g.parts.length)
      : [{ color: null, parts }];
  let first: Chapter | null = null;
  const used: Chapter[] = [];
  let added = 0, skipped = 0;
  for (const g of groups) {
    let ch: Chapter;
    if (target.kind === 'existing') ch = state.chapters.find((c) => c.id === target.chapterId)!;
    else {
      const name = groups.length > 1 ? `${target.name} (${SIDE_NAME[g.color!]})` : target.name;
      ch = createChapter(name, g.color ?? (target.color === 'auto' ? 'w' : target.color), target.book);
    }
    first ??= ch;
    if (!used.includes(ch)) used.push(ch);
    const have = new Set(ch.lines.map((l) => l.id));
    for (const p of g.parts) {
      if (have.has(p.line.id)) { skipped++; continue; }
      have.add(p.line.id);
      ch.lines.push(storeLine(p.line, p.title));
      added++;
    }
    touch(ch);
  }
  return { chapter: first!, chapters: used, added, skipped, games: games.length };
}

/** Add one line (e.g. from the explorer). Returns false if the chapter already has it. */
export function addLine(chapterId: string, title: string, startFen: string, ucis: string[]): boolean {
  const ch = state.chapters.find((c) => c.id === chapterId);
  if (!ch) return false;
  const line = buildLine(startFen, ucis);
  if (ch.lines.some((l) => l.id === line.id)) return false;
  ch.lines.push(storeLine(line, title));
  touch(ch);
  return true;
}

/** Move a chapter to a new position in the list (display order). */
export function moveChapter(id: string, to: number) {
  const from = state.chapters.findIndex((c) => c.id === id);
  if (from < 0) return;
  to = Math.max(0, Math.min(state.chapters.length - 1, to));
  if (to === from) return;
  const [c] = state.chapters.splice(from, 1);
  state.chapters.splice(to, 0, c);
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
/** The side you play in all the chapter's lines. */
export function setChapterColor(c: Chapter, color: Color) {
  c.color = color;
  touch(c);
}
/** Switch a whole chapter off/on (the lines' own on/off states are kept). */
export function setChapterDisabled(c: Chapter, off: boolean) {
  if (off) c.disabled = true; else delete c.disabled;
  touch(c);
}
/** Move a line to another chapter (that's how a line changes side). Returns false if it's already there. */
export function moveLine(from: Chapter, lineId: string, to: Chapter): boolean {
  const l = from.lines.find((x) => x.id === lineId);
  if (!l || from === to) return false;
  from.lines = from.lines.filter((x) => x !== l);
  if (!to.lines.some((x) => x.id === lineId)) to.lines.push(l);
  touch(from);
  touch(to);
  return true;
}

/* ---------- books ---------- */

export function createBook(name: string, color?: Color): Book {
  const b: Book = { id: newId(), name, added: Date.now(), updated: Date.now() };
  if (color) b.color = color;
  state.books.push(b);
  return state.books[state.books.length - 1];
}
export function renameBook(b: Book, name: string) {
  b.name = name;
  b.updated = Date.now();
}
export function setBookDisabled(b: Book, off: boolean) {
  if (off) b.disabled = true; else delete b.disabled;
  b.updated = Date.now();
}
export function bookChapters(bookId: string | undefined): Chapter[] {
  return state.chapters.filter((c) => (c.book ?? '') === (bookId ?? ''));
}
/** Put a chapter in a book (or take it out with undefined); it goes to the end of that book. */
export function setChapterBook(c: Chapter, bookId: string | undefined) {
  if ((c.book ?? '') === (bookId ?? '')) return;
  if (bookId) c.book = bookId; else delete c.book;
  const i = state.chapters.indexOf(c);
  const rest = state.chapters.filter((x) => x !== c);
  let at = -1;
  rest.forEach((x, k) => { if ((x.book ?? '') === (bookId ?? '')) at = k; });
  state.chapters.splice(i, 1);
  state.chapters.splice(at < 0 ? state.chapters.length : at + 1, 0, c);
  touch(c);
}
/** Delete a book; its chapters are deleted too, or kept as loose chapters. */
export function removeBook(b: Book, withChapters: boolean) {
  for (const c of bookChapters(b.id)) {
    if (withChapters) removeChapter(c.id);
    else { delete c.book; touch(c); }
  }
  state.books = state.books.filter((x) => x !== b);
}
export function moveBook(id: string, to: number) {
  const from = state.books.findIndex((b) => b.id === id);
  if (from < 0) return;
  to = Math.max(0, Math.min(state.books.length - 1, to));
  if (to === from) return;
  const [b] = state.books.splice(from, 1);
  state.books.splice(to, 0, b);
}

/* ---------- scheduling ---------- */

/** Mistakes weighted by recency: a mistake today counts 1, a week ago 0.5, two weeks ago 0.25… */
export function recentErrors(st: LineStat | undefined, now = Date.now()): number {
  if (!st) return 0;
  return st.m.reduce((acc, t) => acc + Math.pow(0.5, (now - t) / (7 * DAY)), 0);
}

const MAX_IV = 60;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Ease of a line (1.3 = hard … 2.6 = easy). Lines without one get it from their mistake ratio so far. */
export function ease(st: LineStat | undefined): number {
  if (!st) return 2.3;
  if (st.f !== undefined) return st.f;
  return clamp(2.3 - 1.5 * (st.e / Math.max(1, st.a)), 1.3, 2.5);
}

/** Share of the recent reviews (up to 8) that had a mistake. */
export function recentErrorRate(st: LineStat | undefined): number {
  if (!st || !st.a) return 0;
  const h = st.h?.slice(-8) ?? [];
  if (h.length >= 3) return h.filter((n) => n > 0).length / h.length;
  return st.e / st.a; // not enough history yet
}

/** Review interval in days. Older data without one: from the clean streak (0, 1, 2, 4, 8 …). */
export function intervalDays(st: LineStat | undefined): number {
  if (!st) return 0;
  if (st.iv !== undefined) return st.iv;
  return st.s <= 0 ? 0 : Math.min(MAX_IV, Math.pow(2, st.s - 1));
}

/** Local midnight of the day of `t`. */
export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Due from the start of the day `interval` days after the last review (so the time of day you train doesn't matter). */
export function dueAt(st: LineStat | undefined): number {
  if (!st || !st.a) return 0;
  return addDays(dayStart(st.lr), intervalDays(st));
}

/** The last run of the line had a mistake (it stays due until you get it right). */
export function lastMissed(st: LineStat | undefined): boolean {
  if (!st || !st.a) return false;
  const h = st.h;
  return h && h.length ? h[h.length - 1] > 0 : !st.lc;
}

/** Got right today: rests until tomorrow (or until every other line has had its turn). */
export function resting(st: LineStat | undefined, now = Date.now()): boolean {
  return !!st && st.a > 0 && !lastMissed(st) && st.lr >= dayStart(now);
}

/**
 * Priority for the smart review. Higher = review sooner; ≤ 0 = not due.
 * - a line whose last run had a mistake is due right away, recent mistakes first
 *   (×3, decaying with a one-week half-life)
 * - a line you got right waits for its interval (at least until the next day),
 *   then comes back sooner the more overdue it is and the more often you miss it
 * - never-seen lines get a flat 1
 */
export function priority(st: LineStat | undefined, now = Date.now()): number {
  if (!st || st.a === 0) return 1;
  const rate = recentErrorRate(st);
  if (lastMissed(st)) return 1 + 3 * recentErrors(st, now) + 1.5 * rate;
  const due = Math.max(dueAt(st), addDays(dayStart(st.lr), 1)); // never again the same day
  const overdue = (now - due) / (Math.max(1, intervalDays(st)) * DAY);
  if (now < due) return Math.max(-1, overdue);
  return 0.1 + Math.min(overdue, 5) + recentErrors(st, now) + 1.5 * rate;
}

export function isToday(t: number, now = Date.now()): boolean {
  return t > 0 && new Date(t).toDateString() === new Date(now).toDateString();
}

/**
 * Record one run of a line. `errorPlies` = every position (ply) where the user went wrong.
 * `popularity` (0..1, how much the line is played on lichess) slows the interval growth a little,
 * so popular lines come back more often.
 */
export function recordAttempt(id: string, errorPlies: number[], popularity = 0) {
  const mistake = errorPlies.length > 0;
  const now = Date.now();
  let st = state.stats[id];
  if (!st) { st = { a: 0, e: 0, m: [], lr: 0, lm: 0, s: 0, lc: false, ep: -1 }; state.stats[id] = st; }
  const wasDue = now >= dueAt(st);
  const f = ease(st);
  const iv = intervalDays(st);
  st.h = [...(st.h ?? []), errorPlies.length].slice(-10);
  if (mistake) {
    // Harder line: its interval will grow more slowly from now on.
    st.f = clamp(f - 0.2 - 0.05 * (errorPlies.length - 1), 1.3, 2.6);
    st.iv = 0;
  } else {
    st.f = clamp(f + 0.05, 1.3, 2.6);
    // Reviewing early doesn't grow the interval (avoids inflating it by drilling the same day).
    if (wasDue || iv === 0) st.iv = iv === 0 ? 1 : Math.min(MAX_IV, Math.max(iv + 1, Math.round(iv * st.f * (1 - 0.25 * popularity))));
    else st.iv = iv;
  }
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
  return JSON.stringify({ app: 'chess-line-trainer', v: 2, exported: Date.now(), books: state.books, chapters: state.chapters, stats: state.stats, settings: state.settings, disabled: state.disabled });
}

/** Import a backup (v2 chapters, or v1 PGN files which are migrated). Chapters are matched by id, then name. */
export function importBackup(json: string): string {
  const data = JSON.parse(json);
  if (data.app !== 'chess-line-trainer') throw new Error('Not a Chess Line Trainer backup');
  const incoming: Chapter[] = data.chapters ?? ((data.files ?? []) as PgnFile[]).map(migrateFile);
  for (const b of (data.books ?? []) as Book[]) if (!state.books.some((x) => x.id === b.id)) state.books.push(b);
  let nc = 0;
  for (const c of incoming) {
    const ex = state.chapters.find((x) => x.id === c.id) ?? state.chapters.find((x) => x.name === c.name);
    if (ex) {
      const have = new Set(ex.lines.map((l) => l.id));
      for (const l of c.lines) if (!have.has(l.id)) ex.lines.push(l);
      if (c.book && !ex.book) ex.book = c.book;
      if (c.src && !ex.src) ex.src = c.src;
      touch(ex);
    } else { state.chapters.push({ ...c, updated: Date.now() }); nc++; }
    delete state.deletedChapters[c.id];
  }
  normalizeChapters(state.chapters);
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
    if (isOff(it.line.id)) continue;
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
export function conflictPosition(c: Conflict): { fen: string; moves: string[]; color: Color } {
  return { fen: c.sample.item.line.startFen, moves: c.sample.item.line.moves.slice(0, c.sample.ply).map((m) => m.uci), color: c.color };
}
