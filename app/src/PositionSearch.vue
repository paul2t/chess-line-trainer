<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Chess, type Square } from 'chess.js';
import type { Key } from 'chessground/types';
import Board from './Board.vue';
import MiniBoard from './MiniBoard.vue';
import { DEFAULT_FEN, parsePgn, posKey, moveTokens, lichessUrl, plyLabel, type Color } from './pgn';
import { state, allLines, lineBadge, addLine, createChapter, isOff, type LibLine } from './store';
import { playSound } from './sound';
import { searchMemory, rememberSearch } from './searchMemory';
import { explorer as lichessData, moveGames, fmtGames, lichess as lichessState } from './lichess';

const props = defineProps<{ init?: { fen: string; moves: string[]; cursor?: number; color?: Color }; fromTraining?: boolean; restore?: boolean }>();
const emit = defineEmits<{
  (e: 'train', ids: string[], startPlies: Record<string, number>): void;
  (e: 'close'): void;
  (e: 'toast', msg: string): void;
}>();

const tab = ref<'board' | 'moves'>('board');
const color = computed<'all' | Color>({
  get: () => state.settings.searchColor,
  set: (v) => (state.settings.searchColor = v),
});
const colorOk = (it: LibLine) => color.value === 'all' || it.color === color.value;

/* ================= board / position ================= */

const board = ref<InstanceType<typeof Board> | null>(null);
const chess = new Chess();
const startFen = ref(DEFAULT_FEN);
/** Moves of the current line; the first `cursor` are played (the rest can be stepped forward through). */
const history = ref<{ uci: string; san: string }[]>([]);
const cursor = ref(0);
const fen = ref(DEFAULT_FEN);
const orientation = ref<'white' | 'black'>(state.settings.searchColor === 'b' ? 'black' : 'white');
const query = ref('');
const fromHere = ref(true);
let lastMove: Key[] | undefined;

function dests(): Map<Key, Key[]> {
  const d = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const arr = d.get(m.from as Key);
    if (arr) arr.push(m.to as Key); else d.set(m.from as Key, [m.to as Key]);
  }
  return d;
}

function sync() {
  fen.value = chess.fen();
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  board.value?.set({
    fen: fen.value,
    orientation: orientation.value,
    turnColor: turn,
    lastMove,
    check: chess.inCheck() ? turn : false,
    movable: { color: 'both', dests: dests(), events: { after: onMove } },
  });
  board.value?.api()?.setAutoShapes([]);
}

/** Play a move on the internal game only. */
function apply(uci: string) {
  const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  lastMove = [m.from as Key, m.to as Key];
  return m;
}

function play(uci: string, sound = true): boolean {
  try {
    const m = apply(uci);
    const u = m.from + m.to + (m.promotion ?? '');
    // Same as the next move of the current line: just step forward, keep the rest of the line.
    if (history.value[cursor.value]?.uci === u) cursor.value++;
    else {
      history.value.splice(cursor.value);
      history.value.push({ uci: u, san: m.san });
      cursor.value++;
    }
    if (sound) playSound(m.captured ? 'capture' : 'move');
    return true;
  } catch {
    return false;
  }
}

function playMany(ucis: string[]) {
  ucis.forEach((u, i) => play(u, i === ucis.length - 1));
  sync();
}

function onMove(orig: Key, dest: Key) {
  const p = chess.get(orig as Square);
  const promo = p?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
  play(orig + dest + promo);
  sync();
}

/** Reset the game state without touching the board (the caller syncs once, so pieces animate from where they are). */
function load(toFen: string) {
  chess.load(toFen);
  startFen.value = chess.fen();
  history.value = [];
  cursor.value = 0;
  lastMove = undefined;
}

function reset(toFen = DEFAULT_FEN) {
  load(toFen);
  sync();
}

/** Show the position after `n` moves of the current line (the line itself is kept). */
function goTo(n: number, sound = false) {
  n = Math.max(0, Math.min(n, history.value.length));
  chess.load(startFen.value);
  lastMove = undefined;
  let m;
  for (let i = 0; i < n; i++) m = apply(history.value[i].uci);
  if (sound && m) playSound(m.captured ? 'capture' : 'move');
  cursor.value = n;
  sync();
}
const back = () => cursor.value > 0 && goTo(cursor.value - 1);
const forward = () => cursor.value < history.value.length && goTo(cursor.value + 1, true);

function flip() {
  orientation.value = orientation.value === 'white' ? 'black' : 'white';
  sync();
}

// The board only exists on the Position tab: redraw it (position + orientation) when it comes back.
watch(tab, (t) => {
  if (t === 'board') nextTick(sync);
});

watch(color, (c) => {
  if (c !== 'all') { orientation.value = c === 'w' ? 'white' : 'black'; sync(); }
});

/** Accept a FEN, or PGN / move text such as "1.e4 c5 2.Nf3 d6". */
function applyQuery() {
  const q = query.value.trim();
  if (!q) return;
  const fenLike = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/.test(q);
  if (fenLike) {
    const parts = q.split(/\s+/);
    const full = [parts[0], parts[1] ?? 'w', parts[2] ?? '-', parts[3] ?? '-', parts[4] ?? '0', parts[5] ?? '1'].join(' ');
    try {
      new Chess(full);
    } catch (e) {
      return emit('toast', 'Invalid FEN: ' + (e as Error).message);
    }
    reset(full);
    return;
  }
  const games = parsePgn(q);
  const line = games[0]?.lines[0];
  if (!line) return emit('toast', 'Could not read a FEN or moves from that text.');
  load(line.startFen);
  for (const m of line.moves) play(m.uci, false);
  if (games[0].errors.length) emit('toast', `Stopped at an illegal move: ${games[0].errors[0]}`);
  sync();
}

/* ---------- lines through the position ---------- */
interface Hit { item: LibLine; ply: number; userLeft: boolean }

function isUserPly(it: LibLine, i: number): boolean {
  const startWhite = it.line.startFen.split(' ')[1] !== 'b';
  const whiteMove = (i % 2 === 0) === startWhite;
  return (it.color === 'w') === whiteMove;
}
function userMovesAfter(it: LibLine, ply: number): boolean {
  for (let i = ply; i < it.line.moves.length; i++) if (isUserPly(it, i)) return true;
  return false;
}

/** When set, the board/explorer only considers these lines (from "Explore these lines"). */
const scope = ref<Set<string> | null>(null);
const inactiveLast = <T extends { item: LibLine }>(arr: T[]) =>
  arr.map((h, i) => ({ h, i })).sort((a, b) => Number(!!isOff(a.h.item.line.id)) - Number(!!isOff(b.h.item.line.id)) || a.i - b.i).map((x) => x.h);

const key = computed(() => posKey(fen.value));
const hits = computed<Hit[]>(() => {
  const out: Hit[] = [];
  for (const it of allLines.value.values()) {
    if (!colorOk(it)) continue;
    if (scope.value && !scope.value.has(it.line.id)) continue;
    const ply = it.line.keys.indexOf(key.value);
    if (ply >= 0) out.push({ item: it, ply, userLeft: userMovesAfter(it, ply) });
  }
  return inactiveLast(out);
});
/** Training uses one side at a time: the colour filter, or else the side the board is shown from. */
const trainSide = computed<Color>(() => {
  if (color.value !== 'all') return color.value;
  // results of a single side: train that side; otherwise the side the board is shown from
  const sides = new Set((tab.value === 'moves' ? moveHits.value : hits.value).map((h) => h.item.color));
  if (sides.size === 1) return [...sides][0];
  return orientation.value === 'white' ? 'w' : 'b';
});
const trainSideName = computed(() => (trainSide.value === 'w' ? 'White' : 'Black'));
const trainable = computed(() => hits.value.filter((h) => h.item.color === trainSide.value && !isOff(h.item.line.id) && (!fromHere.value || h.userLeft)));

/* ---------- explorer: opponent moves and your answers ---------- */
interface Reply { uci: string; san: string; n: number }
interface Row { uci: string; san: string; n: number; ends: number; replies: Reply[]; childKey: string }
interface Group { color: Color; myTurn: boolean; rows: Row[] }

const sideToMove = computed<Color>(() => (fen.value.split(' ')[1] === 'b' ? 'b' : 'w'));
const moveNum = computed(() => parseInt(fen.value.split(' ')[5] || '1', 10) || 1);
const firstLabel = (san: string) => (sideToMove.value === 'w' ? `${moveNum.value}.${san}` : `${moveNum.value}...${san}`);
const replyLabel = (san: string) => (sideToMove.value === 'w' ? san : `${moveNum.value + 1}.${san}`);

const explorer = computed<Group[]>(() => {
  const groups: Group[] = [];
  for (const c of ['w', 'b'] as Color[]) {
    const hs = hits.value.filter((h) => h.item.color === c && !isOff(h.item.line.id));
    if (!hs.length) continue;
    const rows = new Map<string, Row>();
    for (const h of hs) {
      const a = h.item.line.moves[h.ply];
      if (!a) continue;
      let r = rows.get(a.uci);
      if (!r) { r = { uci: a.uci, san: a.san, n: 0, ends: 0, replies: [], childKey: h.item.line.keys[h.ply + 1] }; rows.set(a.uci, r); }
      r.n++;
      const b = h.item.line.moves[h.ply + 1];
      if (!b) { r.ends++; continue; }
      const rep = r.replies.find((x) => x.uci === b.uci);
      if (rep) rep.n++; else r.replies.push({ uci: b.uci, san: b.san, n: 1 });
    }
    if (!rows.size) continue;
    const sorted = [...rows.values()].sort((x, y) => y.n - x.n);
    sorted.forEach((r) => r.replies.sort((x, y) => y.n - x.n));
    groups.push({ color: c, myTurn: sideToMove.value === c, rows: sorted });
  }
  return groups;
});

/* ---------- lichess statistics for the current position ---------- */
const here = computed(() => lichessData(key.value));
function pct(g: number | undefined, total: number | undefined): string {
  return g !== undefined && total ? Math.round((g / total) * 100) + '%' : '';
}
const rowGames = (r: Row) => moveGames(key.value, r.uci);
const repGames = (r: Row, rep: Reply) => (r.childKey ? moveGames(r.childKey, rep.uci) : undefined);
/** Common lichess moves here that none of your lines (for the side NOT to move) covers. */
const missingHere = computed(() => {
  const e = here.value;
  if (!e || !e.n) return [];
  const g = explorer.value.find((x) => !x.myTurn);
  if (!g) return [];
  const covered = new Set(g.rows.map((r) => r.uci));
  const thr = state.settings.missingThreshold / 100;
  return e.m.filter(([uci, , n]) => !covered.has(uci) && n >= 20 && n / e.n >= thr).map(([uci, san, n]) => ({ uci, san, n, share: n / e.n }));
});

/* ---------- add the moves on the board as a new line ---------- */
const adding = ref<null | { title: string; target: string; newName: string; color: Color }>(null);
function openAdd() {
  if (!cursor.value) return emit('toast', 'Play some moves first.');
  const sideColor: Color = orientation.value === 'white' ? 'w' : 'b';
  const last = state.chapters.find((c) => c.id === searchMemory.lastChapter) ?? state.chapters.find((c) => c.color === sideColor);
  adding.value = {
    title: moveTokens(startFen.value, history.value.slice(0, cursor.value)).join(' '),
    target: last?.id ?? 'new', newName: 'My lines', color: last?.color ?? sideColor,
  };
}
function onTarget() {
  const a = adding.value!;
  const ch = state.chapters.find((c) => c.id === a.target);
  if (ch) a.color = ch.color;
}
function saveAdd() {
  const a = adding.value!;
  const ch = a.target === 'new' ? createChapter(a.newName.trim() || 'My lines', a.color) : state.chapters.find((c) => c.id === a.target)!;
  const ok = addLine(ch.id, a.title.trim() || 'New line', startFen.value, history.value.slice(0, cursor.value).map((h) => h.uci));
  searchMemory.lastChapter = ch.id;
  adding.value = null;
  emit('toast', ok ? `Line added to “${ch.name}”` : `“${ch.name}” already has this line`);
}

/** Your active lines disagree on your move here (side to move = your colour). */
const disagreement = computed(() => {
  const g = explorer.value.find((x) => x.myTurn && x.rows.length > 1);
  return g ? g.rows.map((r) => r.san) : [];
});

/**
 * Branch points of the active lines (respecting the colour filter and scope):
 * for each position, the distinct next moves of the opponent ("theirs") and of you ("mine").
 */
const branchMaps = computed(() => {
  const theirs = new Map<string, Set<string>>();
  const mine = new Map<string, Set<string>>();
  for (const it of allLines.value.values()) {
    if (isOff(it.line.id) || !colorOk(it)) continue;
    if (scope.value && !scope.value.has(it.line.id)) continue;
    const mv = it.line.moves;
    for (let i = 0; i < mv.length; i++) {
      const m = isUserPly(it, i) ? mine : theirs;
      const k = it.line.keys[i];
      let set = m.get(k);
      if (!set) m.set(k, (set = new Set()));
      set.add(mv[i].uci);
    }
  }
  return { theirs, mine };
});

/** Position key after each move of the history (index 0 = start position). */
const historyKeys = computed(() => {
  const c = new Chess(startFen.value);
  const keys = [posKey(c.fen())];
  for (const h of history.value) {
    try { c.move({ from: h.uci.slice(0, 2), to: h.uci.slice(2, 4), promotion: h.uci[4] }); } catch { break; }
    keys.push(posKey(c.fen()));
  }
  return keys;
});

function branchInfo(k: string | undefined) {
  if (!k) return { opts: 0, conflict: false };
  return { opts: branchMaps.value.theirs.get(k)?.size ?? 0, conflict: (branchMaps.value.mine.get(k)?.size ?? 0) > 1 };
}

const crumbs = computed(() => moveTokens(startFen.value, history.value));
/** Per crumb (move i): how the position after it branches. */
const crumbBranches = computed(() => history.value.map((_, i) => branchInfo(historyKeys.value[i + 1])));
const startBranch = computed(() => branchInfo(historyKeys.value[0]));
const lichess = computed(() => lichessUrl(startFen.value, history.value.slice(0, cursor.value).map((h) => h.san), orientation.value, fen.value));

/* ================= moves search ================= */

const moveQuery = ref('');
const moveBy = ref<'me' | 'opp'>('me');
const fromFirst = ref(false);
const normSan = (s: string) => s.replace(/[+#!?]/g, '').replace(/0/g, 'O');

/* ---------- piece filters ---------- */
const pieceQuery = ref('');
type PieceCond = { color?: Color; piece: string; sq: number }; // sq: 0 = a8 … 63 = h1
type PieceFilter = { kind: 'pieces'; conds: PieceCond[]; bad: string[] } | { kind: 'fen'; cells: string[] } | null;
const sqIndex = (s: string) => (8 - +s[1]) * 8 + (s.charCodeAt(0) - 97);

/** "BBg4 WBe3 Nf3 e4 We4 BPe5" (colour optional, pawn letter optional) or a pattern FEN. */
const pieceFilter = computed<PieceFilter>(() => {
  const q = pieceQuery.value.trim();
  if (!q) return null;
  const placement = q.split(/\s+/)[0];
  if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}$/.test(placement)) {
    const cells: string[] = [];
    for (const row of placement.split('/')) for (const ch of row) /\d/.test(ch) ? cells.push(...Array(+ch).fill('')) : cells.push(ch);
    return cells.length === 64 ? { kind: 'fen', cells } : null;
  }
  const conds: PieceCond[] = [];
  const bad: string[] = [];
  for (const tok of q.split(/[\s,;]+/).filter(Boolean)) {
    // "Bg4" = bishop on g4 (B as a colour needs a piece letter after it: "BBg4", "BPe5")
    const m = tok.match(/^([WB])([KQRBNP])([a-h][1-8])$/) ?? tok.match(/^()([KQRBNP]?)([a-h][1-8])$/) ?? tok.match(/^(W)()([a-h][1-8])$/);
    if (!m) { bad.push(tok); continue; }
    conds.push({ color: m[1] === 'W' ? 'w' : m[1] === 'B' ? 'b' : undefined, piece: m[2] || 'P', sq: sqIndex(m[3]) });
  }
  return { kind: 'pieces', conds, bad };
});

const boardCache = new Map<string, string[]>();
function cellsOf(key: string): string[] {
  let b = boardCache.get(key);
  if (!b) {
    b = [];
    for (const row of key.split(' ')[0].split('/')) for (const ch of row) /\d/.test(ch) ? b.push(...Array(+ch).fill('')) : b.push(ch);
    boardCache.set(key, b);
  }
  return b;
}
function filterOk(key: string): boolean {
  const f = pieceFilter.value;
  if (!f) return true;
  const b = cellsOf(key);
  if (f.kind === 'fen') return f.cells.every((c, i) => !c || b[i] === c);
  return f.conds.every((c) => {
    const x = b[c.sq];
    if (!x || x.toUpperCase() !== c.piece) return false;
    return !c.color || (c.color === 'w') === (x === x.toUpperCase());
  });
}
const filterActive = computed(() => !!pieceFilter.value && (pieceFilter.value.kind === 'fen' || pieceFilter.value.conds.length > 0));

/**
 * A hit = a line, the plies of its matching moves, and the positions where it is your turn to
 * play that match the search (for an opponent move: right after it; for your move: just before it;
 * with only piece filters: every position of yours matching them).
 */
interface MoveHit { item: LibLine; plies: number[]; first: number; occ: number[] }
const moveTerms = computed(() =>
  moveQuery.value.split(/[\s,;]+/).map((x) => normSan(x.replace(/^\d+\.+/, ''))).filter(Boolean),
);
const searching = computed(() => moveTerms.value.length > 0 || filterActive.value);
const moveHits = computed<MoveHit[]>(() => {
  const qs = moveTerms.value;
  if (!qs.length && !filterActive.value) return [];
  const out: MoveHit[] = [];
  for (const it of allLines.value.values()) {
    if (!colorOk(it)) continue;
    const n = it.line.moves.length;
    const plies: number[] = [];
    let all = true;
    for (const q of qs) {
      let found = false;
      it.line.moves.forEach((m, i) => {
        if (normSan(m.san) === q && isUserPly(it, i) === (moveBy.value === 'me')) { found = true; if (!plies.includes(i)) plies.push(i); }
      });
      if (!found) { all = false; break; }
    }
    if (!all) continue;
    plies.sort((a, b) => a - b);
    let occ: number[];
    if (qs.length) occ = plies.map((i) => (moveBy.value === 'me' ? i : i + 1)).filter((p) => p <= n && filterOk(it.line.keys[p]));
    else {
      occ = [];
      for (let p = 0; p < n; p++) if (isUserPly(it, p) && filterOk(it.line.keys[p])) occ.push(p);
    }
    if (!occ.length) continue;
    out.push({ item: it, plies: qs.length ? plies : occ, first: qs.length ? plies[0] : occ[0], occ });
  }
  return inactiveLast(out);
});

/* ---------- boards view: one board per distinct position, grouped by your move ---------- */
const resultView = ref<'lines' | 'boards'>('lines');
interface BoardItem { id: string; key: string; my?: string; myLabel: string; last?: string; item: LibLine; p: number; lines: number; off: boolean }
const boardGroups = computed(() => {
  const items = new Map<string, BoardItem>();
  for (const h of moveHits.value)
    for (const p of h.occ) {
      const mv = h.item.line.moves;
      const my = mv[p];
      const id = h.item.line.keys[p] + '|' + (my?.uci ?? '') + '|' + h.item.color;
      const ex = items.get(id);
      if (ex) { ex.lines++; ex.off &&= isOff(h.item.line.id); continue; }
      items.set(id, {
        id, key: h.item.line.keys[p], my: my?.uci, myLabel: my ? plyLabel(h.item.line.startFen, mv, p) : 'line ends',
        last: mv[p - 1]?.uci, item: h.item, p, lines: 1, off: isOff(h.item.line.id),
      });
    }
  const groups = new Map<string, BoardItem[]>();
  for (const b of items.values()) {
    const g = (b.my ? (mvSan(b) ?? '') : '—') + '|' + b.item.color;
    groups.get(g)?.push(b) ?? groups.set(g, [b]);
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, san: k.split('|')[0], color: list[0].item.color, list }))
    .sort((a, b) => b.list.length - a.list.length || a.san.localeCompare(b.san));
});
function mvSan(b: BoardItem): string | undefined {
  return b.item.line.moves[b.p]?.san.replace(/[+#]/g, '');
}
const boardCount = computed(() => boardGroups.value.reduce((a, g) => a + g.list.length, 0));
const boardsShown = ref(40);
const moveTrainable = computed(() =>
  moveHits.value.filter((h) => h.item.color === trainSide.value && !isOff(h.item.line.id) && (!fromFirst.value || userMovesAfter(h.item, h.first))),
);

/** Load a whole line on the board, positioned after `cursorPly` moves (step through it with ‹ ›). */
function openLine(it: LibLine, cursorPly: number) {
  load(it.line.startFen);
  for (const m of it.line.moves) play(m.uci, false);
  if (color.value === 'all') orientation.value = it.color === 'w' ? 'white' : 'black';
  goTo(cursorPly);
  tab.value = 'board';
  window.scrollTo(0, 0);
}
const openAt = (h: MoveHit) => openLine(h.item, h.first);

const foundActive = computed(() => moveHits.value.filter((h) => !isOff(h.item.line.id)).length);

/** Explore only the active lines found by the moves search, as a tree from the start. */
function exploreFound() {
  const act = moveHits.value.filter((h) => !isOff(h.item.line.id));
  if (!act.length) return emit('toast', 'No active line to explore.');
  scope.value = new Set(act.map((h) => h.item.line.id));
  const colors = new Set(act.map((h) => h.item.color));
  if (colors.size === 1) orientation.value = [...colors][0] === 'w' ? 'white' : 'black';
  // Play all the moves the lines have in common, stopping where they first branch.
  const first = act[0].item.line;
  const same = act.filter((h) => h.item.line.startFen === first.startFen);
  let n = 0;
  while (n < first.moves.length && same.every((h) => h.item.line.moves[n]?.uci === first.moves[n].uci)) n++;
  load(first.startFen);
  for (const m of first.moves.slice(0, n)) play(m.uci, false);
  sync();
  tab.value = 'board';
  window.scrollTo(0, 0);
}

/* ================= shared ================= */

function tokens(it: LibLine, fadeBefore: number, marks: number[] = []) {
  return moveTokens(it.line.startFen, it.line.moves).map((t, i) => ({ t, cls: marks.includes(i) ? 'mk' : i < fadeBefore ? 'lpre' : '' }));
}

function train(list: { item: LibLine; ply: number }[], fromPly: boolean) {
  if (!list.length) return emit('toast', 'No enabled line to train.');
  const plies: Record<string, number> = {};
  for (const h of list) plies[h.item.line.id] = fromPly ? h.ply : 0;
  emit('train', list.map((h) => h.item.line.id), plies);
}

/** Remember the search (also used to come back here after a training session started from it). */
function saveState() {
  if (props.fromTraining) return; // exploring a line during training isn't "a search"
  rememberSearch({
    tab: tab.value, startFen: startFen.value, history: history.value.map((h) => ({ ...h })), cursor: cursor.value,
    orientation: orientation.value, query: query.value, moveQuery: moveQuery.value, moveBy: moveBy.value,
    pieceQuery: pieceQuery.value, resultView: resultView.value,
    fromHere: fromHere.value, fromFirst: fromFirst.value, scope: scope.value ? [...scope.value] : null,
  });
}
let saveTimer = 0;
watch([tab, history, cursor, orientation, query, moveQuery, moveBy, fromHere, fromFirst, scope, pieceQuery, resultView], () => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveState, 300);
}, { deep: true });
function restoreState(): boolean {
  const m = searchMemory.saved;
  if (!m) return false;
  tab.value = m.tab; query.value = m.query; moveQuery.value = m.moveQuery; moveBy.value = m.moveBy;
  pieceQuery.value = m.pieceQuery ?? ''; resultView.value = m.resultView ?? 'lines';
  fromHere.value = m.fromHere; fromFirst.value = m.fromFirst; orientation.value = m.orientation;
  scope.value = m.scope ? new Set(m.scope) : null;
  load(m.startFen);
  for (const h of m.history) play(h.uci, false);
  goTo(m.cursor);
  return true;
}
const trainPosition = () => train(trainable.value, fromHere.value);
const trainMoves = () => train(moveTrainable.value.map((h) => ({ item: h.item, ply: h.first })), fromFirst.value);

function selectIds(ids: string[]) {
  state.selection = [...new Set(ids)];
  emit('toast', `${state.selection.length} line(s) selected in the library`);
}

const shown = ref(60);
onMounted(() => {
  if (props.init) {
    if (props.init.color) color.value = props.init.color;
    load(props.init.fen);
    for (const u of props.init.moves) play(u, false);
    orientation.value = props.init.color ? (props.init.color === 'w' ? 'white' : 'black') : chess.turn() === 'w' ? 'white' : 'black';
    goTo(props.init.cursor ?? history.value.length);
  } else if (props.fromTraining || !restoreState()) reset();
});
</script>

<template>
  <div class="psearch">
    <div class="tbar">
      <button class="icon" @click="emit('close')" aria-label="Back">‹</button>
      <div class="tinfo">
        <div class="tprog">{{ fromTraining ? 'Explore line' : 'Find & explore lines' }}</div>
        <div class="tsub" v-if="fromTraining">‹ goes back to your training</div>
      </div>
      <button class="icon" @click="flip" aria-label="Flip board" v-show="tab === 'board'">⇅</button>
    </div>

    <div class="ctl-row">
      <div class="seg" v-if="!fromTraining">
        <button :class="{ on: tab === 'board' }" @click="tab = 'board'">Position</button>
        <button :class="{ on: tab === 'moves' }" @click="tab = 'moves'">Moves</button>
      </div>
      <div class="seg">
        <button :class="{ on: color === 'all' }" @click="color = 'all'">All</button>
        <button :class="{ on: color === 'w' }" @click="color = 'w'">♔ White</button>
        <button :class="{ on: color === 'b' }" @click="color = 'b'">♚ Black</button>
      </div>
    </div>

    <!-- ================= POSITION / EXPLORER ================= -->
    <template v-if="tab === 'board'">
      <div class="pinput">
        <input class="inp" v-model="query" placeholder="Paste a FEN or moves (1.e4 c5 2.Nf3…)" @keydown.enter="applyQuery" />
        <button class="btn sm primary" @click="applyQuery">Go</button>
      </div>

      <div v-if="scope" class="scopebar">
        <span>Exploring <b>{{ scope.size }}</b> found line{{ scope.size === 1 ? '' : 's' }}</span>
        <button class="btn sm" @click="scope = null">Show all lines</button>
      </div>

      <div class="board-box small-board"><Board ref="board" /></div>

      <div class="crumbs">
        <button :class="['crumb', { cur: cursor === 0, branch: startBranch.opts > 1, conflict: startBranch.conflict }]" @click="goTo(0)">
          {{ startFen === DEFAULT_FEN ? 'Start' : 'FEN' }}<sup v-if="startBranch.conflict">⚠</sup><sup v-else-if="startBranch.opts > 1">{{ startBranch.opts }}</sup>
        </button>
        <button
          v-for="(t, i) in crumbs"
          :key="i"
          :class="['crumb', { cur: i === cursor - 1, future: i >= cursor, branch: crumbBranches[i].opts > 1, conflict: crumbBranches[i].conflict }]"
          @click="goTo(i + 1)"
        >{{ t }}<sup v-if="crumbBranches[i].conflict">⚠</sup><sup v-else-if="crumbBranches[i].opts > 1">{{ crumbBranches[i].opts }}</sup></button>
      </div>
      <div class="crumb-legend muted" v-if="crumbBranches.some((b) => b.opts > 1 || b.conflict) || startBranch.opts > 1">
        <span class="lg branch">n</span> opponent has n replies in your lines · <span class="lg conflict">⚠</span> your lines disagree
      </div>
      <div class="phist">
        <button class="btn sm navb" @click="back" :disabled="cursor === 0" aria-label="Previous move">‹</button>
        <button class="btn sm navb" @click="forward" :disabled="cursor >= history.length" aria-label="Next move">›</button>
        <button class="btn sm" @click="reset()" v-if="!fromTraining">Reset</button>
        <span class="flex1"></span>
        <button class="btn sm" @click="openAdd" :disabled="!cursor" title="Save the moves up to this position as a new line">+ Add line</button>
        <a class="btn sm" :href="lichess" target="_blank" rel="noopener">lichess ↗</a>
      </div>

      <div v-if="disagreement.length" class="warn small dis">⚠ Your active lines play different moves here: {{ disagreement.join(' / ') }}</div>

      <div v-if="here" class="lichess-here small muted">♟ {{ fmtGames(here.n) }} lichess games reached this position</div>
      <div v-else-if="lichessState.token && explorer.length" class="lichess-here small muted">♟ lichess stats for this position not loaded yet…</div>

      <section class="card explorer" v-if="explorer.length">
        <div v-for="g in explorer" :key="g.color" class="xgroup">
          <div class="xhead">
            <b>As {{ g.color === 'w' ? 'White' : 'Black' }}</b>
            <span class="muted small">{{ g.myTurn ? ' — your move, then their replies' : ' — their moves and your answers' }}</span>
          </div>
          <div v-for="r in g.rows" :key="r.uci" class="xrow">
            <button :class="['chip', g.myTurn ? 'mine' : 'theirs']" @click="playMany([r.uci])">{{ firstLabel(r.san) }}</button>
            <span class="arrow">→</span>
            <span class="xreplies">
              <button v-for="rep in r.replies" :key="rep.uci" :class="['chip', g.myTurn ? 'theirs' : 'mine']" @click="playMany([r.uci, rep.uci])">
                {{ replyLabel(rep.san) }}
                <span v-if="repGames(r, rep) !== undefined" class="gcount">♟{{ fmtGames(repGames(r, rep)) }}</span>
                <span v-else-if="r.replies.length > 1 || g.myTurn" class="muted">{{ rep.n }}</span>
              </button>
              <span v-if="r.ends" class="muted small">{{ r.replies.length ? `· ${r.ends} end here` : 'line ends' }}</span>
              <span v-if="!g.myTurn && r.replies.length > 1" class="warn small">⚠ different answers</span>
            </span>
            <span class="xcount muted small">
              {{ r.n }} line{{ r.n === 1 ? '' : 's' }}
              <span v-if="rowGames(r) !== undefined" class="gcount"><br />{{ fmtGames(rowGames(r)) }} · {{ pct(rowGames(r), here?.n) }}</span>
            </span>
          </div>
          <div v-if="!g.myTurn && missingHere.length" class="xmissing">
            <span class="small missing">Not in your lines:</span>
            <button v-for="m in missingHere" :key="m.uci" class="chip missing-chip" @click="playMany([m.uci])">{{ firstLabel(m.san) }} <span class="muted">{{ Math.round(m.share * 100) }}%</span></button>
          </div>
        </div>
      </section>
      <p v-else class="muted small center">No {{ color === 'all' ? '' : color === 'w' ? 'White ' : 'Black ' }}line continues from this position.</p>

      <section class="card">
        <div class="presult">
          <b>{{ hits.length }}</b> line{{ hits.length === 1 ? '' : 's' }} reach this position
          <span class="muted small" v-if="hits.length !== trainable.length"> · {{ trainable.length }} trainable</span>
        </div>
        <label class="set" v-if="!fromTraining">Start training from this position <input type="checkbox" v-model="fromHere" /></label>
        <div class="row2" v-if="!fromTraining">
          <button class="btn primary wide" @click="trainPosition" :disabled="!trainable.length">Train {{ trainable.length }} {{ trainSideName }}</button>
          <button class="btn wide" @click="selectIds(hits.map((h) => h.item.line.id))" :disabled="!hits.length">Select in library</button>
        </div>
        <div v-for="h in hits.slice(0, shown)" :key="h.item.line.id" :class="['lrow', { off: isOff(h.item.line.id) }]">
          <div class="lmain" @click="openLine(h.item, h.ply)">
            <div class="small muted">{{ h.item.chapter.name }} · {{ h.item.title }} · <span class="tap">step through ›</span></div>
            <div class="ltext"><span v-for="(t, i) in tokens(h.item, h.ply)" :key="i" :class="t.cls">{{ t.t + ' ' }}</span></div>
            <div class="lstat">
              <span v-if="isOff(h.item.line.id)" class="badge b-off">off</span>
              <span v-else :class="['badge', lineBadge(state.stats[h.item.line.id]).cls]">{{ lineBadge(state.stats[h.item.line.id]).text }}</span>
            </div>
          </div>
        </div>
        <button v-if="hits.length > shown" class="btn wide" @click="shown += 60">Show more ({{ hits.length - shown }})</button>
      </section>
      <button v-if="fromTraining" class="btn primary big wide" @click="emit('close')">‹ Back to training</button>
    </template>

    <div v-if="adding" class="modal-bg" @click.self="adding = null">
      <div class="modal card">
        <h3>Add a line</h3>
        <p class="small muted">The moves up to the position on the board ({{ cursor }} half-moves).</p>
        <label class="pick-label">Title</label>
        <input class="inp" v-model="adding.title" />
        <label class="pick-label">Chapter</label>
        <select class="inp" v-model="adding.target" @change="onTarget">
          <option value="new">➕ New chapter</option>
          <option v-for="c in state.chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <template v-if="adding.target === 'new'">
          <input class="inp" v-model="adding.newName" placeholder="Chapter name" />
          <div class="colorpick">
            You play
            <div class="seg">
              <button :class="{ on: adding.color === 'w' }" @click="adding.color = 'w'">♔ White</button>
              <button :class="{ on: adding.color === 'b' }" @click="adding.color = 'b'">♚ Black</button>
            </div>
          </div>
        </template>
        <p v-else class="small muted">You play {{ adding.color === 'w' ? 'White' : 'Black' }} in this chapter.</p>
        <div class="row2">
          <button class="btn wide" @click="adding = null">Cancel</button>
          <button class="btn primary wide" @click="saveAdd">Add</button>
        </div>
      </div>
    </div>

    <!-- ================= MOVES SEARCH ================= -->
    <template v-if="tab === 'moves'">
      <section class="card">
        <input class="inp" v-model="moveQuery" placeholder="Moves, e.g. g5   or   Nf3 g6   or   O-O-O" autocapitalize="off" autocomplete="off" />
        <div class="colorpick">
          Played by
          <div class="seg">
            <button :class="{ on: moveBy === 'me' }" @click="moveBy = 'me'">Me</button>
            <button :class="{ on: moveBy === 'opp' }" @click="moveBy = 'opp'">Opponent</button>
          </div>
        </div>
        <p class="small muted" v-if="moveTerms.length > 1">Lines containing all of: {{ moveTerms.join(', ') }}</p>
        <label class="pick-label">Pieces on the board <span class="muted">(optional)</span></label>
        <input class="inp" v-model="pieceQuery" placeholder="e.g. BBg4 WBe3 Nf3   or a FEN pattern" autocapitalize="off" autocomplete="off" />
        <p class="small muted">
          <b>BBg4</b> black bishop on g4 · <b>WBe3</b> white bishop · <b>Nf3</b> knight of either colour · <b>e4</b>/<b>We4</b>/<b>BPe5</b> pawns.
          Or paste a FEN: its pieces must be there, its empty squares can hold anything.
          <span v-if="pieceFilter && pieceFilter.kind === 'pieces' && pieceFilter.bad.length" class="warn"> Not understood: {{ pieceFilter.bad.join(', ') }}</span>
          <span v-else-if="pieceFilter && pieceFilter.kind === 'fen'" class="gcount"> FEN pattern ✓</span>
        </p>
      </section>

      <section class="card" v-if="searching">
        <div class="seg view-tabs">
          <button :class="{ on: resultView === 'lines' }" @click="resultView = 'lines'">Lines</button>
          <button :class="{ on: resultView === 'boards' }" @click="resultView = 'boards'">Boards</button>
        </div>
        <div class="presult">
          <b>{{ moveHits.length }}</b> line{{ moveHits.length === 1 ? '' : 's' }} found<template v-if="resultView === 'boards'"> · <b>{{ boardCount }}</b> position{{ boardCount === 1 ? '' : 's' }}</template>
          <span class="muted small" v-if="moveHits.length !== moveTrainable.length"> · {{ moveTrainable.length }} trainable</span>
        </div>
        <label class="set">Start training at the first matching move <input type="checkbox" v-model="fromFirst" /></label>
        <div class="row2">
          <button class="btn primary wide" @click="trainMoves" :disabled="!moveTrainable.length">Train {{ moveTrainable.length }} {{ trainSideName }}</button>
          <button class="btn wide" @click="selectIds(moveHits.map((h) => h.item.line.id))" :disabled="!moveHits.length">Select in library</button>
        </div>
        <button class="btn wide" @click="exploreFound" :disabled="!foundActive">🔍 Explore these lines</button>

        <template v-if="resultView === 'boards'">
          <p class="small muted">Each board is a position where it's your move: the last move is highlighted, the arrow is your move in your lines. Grouped by your move.</p>
          <template v-for="g in boardGroups" :key="g.key">
            <h3 class="bgroup">{{ g.san }} <span class="muted small">· {{ g.list.length }} position{{ g.list.length === 1 ? '' : 's' }}{{ color === 'all' ? (g.color === 'w' ? ' · as White' : ' · as Black') : '' }}</span></h3>
            <div class="bgrid">
              <div v-for="b in g.list.slice(0, boardsShown)" :key="b.id" :class="['bcell', { off: b.off }]" @click="openLine(b.item, b.p)">
                <MiniBoard :fen="b.key" :orientation="b.item.color === 'w' ? 'white' : 'black'" :last-move="b.last" :arrow="b.my" />
                <div class="bcap small"><b>{{ b.myLabel }}</b> · {{ b.item.title }}<span v-if="b.lines > 1" class="muted"> +{{ b.lines - 1 }}</span></div>
              </div>
            </div>
          </template>
          <button v-if="boardGroups.some((g) => g.list.length > boardsShown)" class="btn wide" @click="boardsShown += 40">Show more boards</button>
        </template>

        <template v-else>
        <div v-for="h in moveHits.slice(0, shown)" :key="h.item.line.id" :class="['lrow', { off: isOff(h.item.line.id) }]">
          <div class="lmain" @click="openAt(h)">
            <div class="small muted">{{ h.item.chapter.name }} · {{ h.item.title }}</div>
            <div class="ltext"><span v-for="(t, i) in tokens(h.item, 0, h.plies)" :key="i" :class="t.cls">{{ t.t + ' ' }}</span></div>
            <div class="lstat">
              <span v-if="isOff(h.item.line.id)" class="badge b-off">off</span>
              <span v-else :class="['badge', lineBadge(state.stats[h.item.line.id]).cls]">{{ lineBadge(state.stats[h.item.line.id]).text }}</span>
              <span class="muted">tap to open on the board</span>
            </div>
          </div>
        </div>
        <button v-if="moveHits.length > shown" class="btn wide" @click="shown += 60">Show more ({{ moveHits.length - shown }})</button>
        </template>
      </section>
    </template>
  </div>
</template>
