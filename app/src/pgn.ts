import { Chess, type Position } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { makeSquare, parseUci, squareFile, squareRank } from 'chessops/util';
import type { NormalMove } from 'chessops/types';

export const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type Color = 'w' | 'b';

interface PgnNode {
  san: string;
  uci: string;
  fen: string;
  key: string;
  pos: Position;
  comment: string;
  children: PgnNode[];
  parent: PgnNode | null;
}

export interface LineMove {
  san: string;
  uci: string;
  comment: string;
  /** Other moves (uci) the PGN gives from the same position. */
  alts: string[];
}

export interface Line {
  id: string;
  startFen: string;
  moves: LineMove[];
  /** Position keys: keys[i] = position before moves[i]; keys[moves.length] = final position. */
  keys: string[];
}

/** Position identity used for search: placement, side to move, castling rights. */
export function posKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 3).join(' ');
}

export interface Game {
  headers: Record<string, string>;
  name: string;
  startFen: string;
  lines: Line[];
  guessedColor: Color;
  errors: string[];
}

type Tok =
  | { t: 'tag'; k: string; v: string }
  | { t: 'move'; v: string }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'comment'; v: string }
  | { t: 'result' };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  const n = s.length;
  let i = 0;
  const isWs = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '﻿' || c === ' ';
  while (i < n) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === '%' && (i === 0 || s[i - 1] === '\n')) {
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    if (c === '[') {
      let end = s.indexOf(']', i);
      if (end < 0) end = n;
      const body = s.slice(i + 1, end);
      const m = body.match(/^\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"/);
      if (m) toks.push({ t: 'tag', k: m[1], v: m[2].replace(/\\(.)/g, '$1') });
      i = end + 1;
      continue;
    }
    if (c === '{') {
      let end = s.indexOf('}', i);
      if (end < 0) end = n;
      toks.push({ t: 'comment', v: s.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === ';') {
      let end = s.indexOf('\n', i);
      if (end < 0) end = n;
      toks.push({ t: 'comment', v: s.slice(i + 1, end) });
      i = end;
      continue;
    }
    if (c === '(') { toks.push({ t: 'open' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'close' }); i++; continue; }
    if (c === '$') {
      i++;
      while (i < n && s[i] >= '0' && s[i] <= '9') i++;
      continue;
    }
    let j = i;
    while (j < n && !isWs(s[j]) && !'{}();[]$'.includes(s[j])) j++;
    if (j === i) { i++; continue; }
    let w = s.slice(i, j);
    i = j;
    if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(w)) { toks.push({ t: 'result' }); continue; }
    w = w.replace(/^\d+\s*\.+/, '');
    w = w.replace(/[!?‼⁇⁈⁉□∞+#]+$/u, '');
    if (!w || /^\.+$/.test(w) || /^\d+$/.test(w)) continue;
    if (/^[0O]-[0O](-[0O])?/.test(w)) w = w.replace(/0/g, 'O');
    toks.push({ t: 'move', v: w });
  }
  return toks;
}

/** Fast stable 53-bit string hash (cyrb53). */
function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function gameName(h: Record<string, string>, idx: number): string {
  const ok = (v?: string) => v && v !== '?' && v !== '-' && v.trim() !== '';
  const parts: string[] = [];
  if (ok(h.Event)) {
    // Lichess studies export "Study name: Chapter name" — keep the chapter part.
    const ev = h.Event!;
    const k = ev.indexOf(': ');
    parts.push(k > 0 && k < ev.length - 2 ? ev.slice(k + 2) : ev);
  }
  if (ok(h.White) && ok(h.Black)) parts.push(`${h.White} – ${h.Black}`);
  if (ok(h.ChapterName)) parts.unshift(h.ChapterName!);
  return parts.length ? parts.join(' · ') : `Game ${idx + 1}`;
}

function buildGame(headers: Record<string, string>, root: PgnNode, idx: number, errors: string[]): Game {
  const lines: Line[] = [];
  const path: LineMove[] = [];
  const keyPath: string[] = [root.key];
  let branchW = 0, branchB = 0;
  const dfs = (node: PgnNode) => {
    if (node.children.length === 0) {
      if (path.length) {
        const moves = path.slice();
        lines.push({ id: hash(root.fen.split(' ').slice(0, 4).join(' ') + '|' + moves.map((m) => m.uci).join(' ')), startFen: root.fen, moves, keys: keyPath.slice() });
      }
      return;
    }
    if (node.children.length > 1) {
      if (node.pos.turn === 'white') branchW++; else branchB++;
    }
    for (const ch of node.children) {
      path.push({ san: ch.san, uci: ch.uci, comment: ch.comment.trim(), alts: node.children.filter((x) => x !== ch).map((x) => x.uci) });
      keyPath.push(ch.key);
      dfs(ch);
      path.pop();
      keyPath.pop();
    }
  };
  dfs(root);
  let guessed: Color = branchW > branchB ? 'b' : 'w';
  const o = (headers.Orientation || '').toLowerCase();
  if (o === 'black') guessed = 'b';
  else if (o === 'white') guessed = 'w';
  return { headers, name: gameName(headers, idx), startFen: root.fen, lines, guessedColor: guessed, errors };
}

/** Parse a PGN (possibly many games, with nested variations) into games with all root-to-leaf lines. */
const cache = new Map<string, Game[]>();
export function parsePgn(text: string): Game[] {
  let g = cache.get(text);
  if (!g) {
    g = parsePgnRaw(text);
    if (cache.size > 20) cache.clear();
    cache.set(text, g);
  }
  return g;
}

function startPos(fen: string): Position | undefined {
  const setup = parseFen(fen);
  if (setup.isErr) return undefined;
  const pos = Chess.fromSetup(setup.value);
  return pos.isErr ? undefined : pos.value;
}

/** Standard UCI (castling as e1g1, not chessops' king-takes-rook e1h1). */
function stdUci(pos: Position, m: NormalMove): string {
  let to = m.to;
  const piece = pos.board.get(m.from);
  const target = pos.board.get(m.to);
  if (piece?.role === 'king' && target?.role === 'rook' && target.color === piece.color) {
    to = (squareRank(m.from) * 8 + (squareFile(m.to) > squareFile(m.from) ? 6 : 2));
  }
  return makeSquare(m.from) + makeSquare(to) + (m.promotion ? m.promotion[0] === 'k' ? 'n' : m.promotion[0] : '');
}

function parsePgnRaw(text: string): Game[] {
  const toks = tokenize(text);
  const games: Game[] = [];

  let headers: Record<string, string> = {};
  let root: PgnNode | null = null;
  let cur: PgnNode | null = null;
  let stack: PgnNode[] = [];
  let depth = 0;
  let deadDepth = -1;
  let hasMoves = false;
  let ended = false;
  let errors: string[] = [];
  let started = false;

  const newRoot = (): PgnNode => ({ san: '', uci: '', fen: DEFAULT_FEN, key: posKey(DEFAULT_FEN), pos: Chess.default(), comment: '', children: [], parent: null });
  const finish = () => {
    if (started && root && root.children.length) games.push(buildGame(headers, root, games.length, errors));
    headers = {}; root = newRoot(); cur = root; stack = []; depth = 0; deadDepth = -1;
    hasMoves = false; ended = false; errors = []; started = false;
  };
  finish();

  for (const tok of toks) {
    if (tok.t === 'tag') {
      if (hasMoves || ended) finish();
      started = true;
      headers[tok.k] = tok.v;
      if (tok.k === 'FEN') {
        const pos = startPos(tok.v);
        if (pos) { root!.pos = pos; root!.fen = makeFen(pos.toSetup()); root!.key = posKey(root!.fen); } else errors.push('Invalid FEN: ' + tok.v);
      }
      continue;
    }
    if (tok.t === 'result') { ended = true; continue; }
    if (ended) {
      if (tok.t === 'move') finish(); else continue;
    }
    started = true;
    if (tok.t === 'comment') {
      if (deadDepth >= 0) continue;
      const clean = tok.v.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (clean) cur!.comment = cur!.comment ? cur!.comment + ' ' + clean : clean;
      continue;
    }
    if (tok.t === 'open') {
      depth++;
      if (deadDepth >= 0) continue;
      stack.push(cur!);
      cur = cur!.parent ?? cur;
      continue;
    }
    if (tok.t === 'close') {
      if (depth === 0) continue;
      if (deadDepth >= 0) {
        if (depth === deadDepth) { deadDepth = -1; cur = stack.pop()!; }
        depth--;
        continue;
      }
      depth--;
      cur = stack.pop()!;
      continue;
    }
    // move
    if (deadDepth >= 0) continue;
    hasMoves = true;
    const pos = cur!.pos;
    let mv = parseSan(pos, tok.v);
    if (!mv) {
      const u = parseUci(tok.v);
      if (u && pos.isLegal(u)) mv = u;
    }
    if (!mv || !('from' in mv)) {
      errors.push(`Illegal move "${tok.v}"`);
      deadDepth = depth;
      continue;
    }
    const uci = stdUci(pos, mv);
    let child = cur!.children.find((c) => c.uci === uci);
    if (!child) {
      const next = pos.clone();
      const san = makeSanAndPlay(next, mv);
      child = { san, uci, fen: '', key: posKey(makeFen(next.toSetup())), pos: next, comment: '', children: [], parent: cur };
      cur!.children.push(child);
    }
    cur = child;
  }
  finish();
  return games;
}

/** Render moves as "1.e4 e5 2.Nf3" starting from a FEN. */
export function moveNumberPrefix(startFen: string, ply: number): { num: number; white: boolean } {
  const parts = startFen.split(' ');
  const startWhite = parts[1] !== 'b';
  const startNum = parseInt(parts[5] || '1', 10) || 1;
  const abs = ply + (startWhite ? 0 : 1);
  return { num: startNum + Math.floor(abs / 2), white: abs % 2 === 0 };
}

/** One label per move ("1.e4", "e5", "2.Nf3"…), numbered as in a full game score. */
export function moveTokens(startFen: string, moves: { san: string }[]): string[] {
  return moves.map((m, i) => {
    const { num, white } = moveNumberPrefix(startFen, i);
    return white ? `${num}.${m.san}` : i === 0 ? `${num}...${m.san}` : m.san;
  });
}

export function formatMoves(startFen: string, moves: { san: string }[], from = 0, to = moves.length): string {
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    const { num, white } = moveNumberPrefix(startFen, i);
    if (white) out.push(`${num}.${moves[i].san}`);
    else if (i === from) out.push(`${num}...${moves[i].san}`);
    else out.push(moves[i].san);
  }
  return out.join(' ');
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/**
 * Link to the lichess analysis board with the moves, e.g. https://lichess.org/analysis/pgn/e4_e5_Nf3_Nc6.
 * Games that start from a custom FEN can't be expressed that way: link the final position instead.
 */
export function lichessUrl(startFen: string, sans: string[], orientation: 'white' | 'black' = 'white', finalFen?: string): string {
  const color = `?color=${orientation}`;
  if (posKey(startFen) === posKey(DEFAULT_FEN)) {
    if (!sans.length) return `https://lichess.org/analysis${color}`;
    return `https://lichess.org/analysis/pgn/${sans.map(encodeURIComponent).join('_')}${color}`;
  }
  return `https://lichess.org/analysis/standard/${(finalFen ?? startFen).trim().replace(/\s+/g, '_')}${color}`;
}

/* ---------- PGN export ---------- */

interface ExportNode { san: string; uci: string; comment: string; children: ExportNode[] }

/**
 * Merge lines (same start position) into one PGN game with variations.
 * The first line's moves form the main line; later lines branch off where they differ.
 */
export function linesToPgn(lines: Line[], headers: Record<string, string>): string {
  if (!lines.length) return '';
  const startFen = lines[0].startFen;
  const root: ExportNode = { san: '', uci: '', comment: '', children: [] };
  for (const l of lines) {
    let node = root;
    for (const m of l.moves) {
      let ch = node.children.find((c) => c.uci === m.uci);
      if (!ch) { ch = { san: m.san, uci: m.uci, comment: m.comment, children: [] }; node.children.push(ch); }
      node = ch;
    }
  }
  const num = (ply: number, force: boolean) => {
    const { num, white } = moveNumberPrefix(startFen, ply);
    return white ? `${num}. ` : force ? `${num}... ` : '';
  };
  const esc = (c: string) => c.replace(/[{}]/g, '');
  const out: string[] = [];
  const write = (node: ExportNode, ply: number, force: boolean) => {
    if (!node.children.length) return;
    const [main, ...alts] = node.children;
    out.push(num(ply, force) + main.san + (main.comment ? ` {${esc(main.comment)}}` : ''));
    for (const alt of alts) {
      out.push('(' + num(ply, true) + alt.san + (alt.comment ? ` {${esc(alt.comment)}}` : ''));
      write(alt, ply + 1, !!alt.comment);
      out[out.length - 1] += ')';
    }
    write(main, ply + 1, alts.length > 0 || !!main.comment);
  };
  write(root, 0, true);
  const h = { ...headers };
  if (posKey(startFen) !== posKey(DEFAULT_FEN)) { h.SetUp = '1'; h.FEN = startFen; }
  const head = Object.entries(h).map(([k, v]) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
  // wrap at ~80 chars
  const text: string[] = [];
  let cur = '';
  for (const tok of (out.join(' ') + ' *').split(' ')) {
    if (cur && cur.length + tok.length + 1 > 80) { text.push(cur); cur = tok; } else cur = cur ? cur + ' ' + tok : tok;
  }
  if (cur) text.push(cur);
  return head + '\n\n' + text.join('\n') + '\n';
}
