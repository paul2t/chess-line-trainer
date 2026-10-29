import { parsePgn } from '../src/pgn';
import { Chess } from 'chess.js';
// random tree: branch opponent moves 3 ways, depth 14 plies -> many lines
function gen(c: Chess, depth: number): string {
  if (depth === 0) return '';
  const ms = c.moves();
  if (!ms.length) return '';
  const userTurn = c.turn() === 'w';
  const picks = userTurn ? [ms[0]] : ms.slice(0, depth > 8 ? 3 : 1);
  const subs = picks.map((m) => { const c2 = new Chess(c.fen()); c2.move(m); return { m, rest: gen(c2, depth - 1) }; });
  return subs[0].m + ' ' + subs.slice(1).map((x) => `(${x.m} ${x.rest}) `).join('') + subs[0].rest;
}
const pgn = '[Event "Big"]\n\n' + gen(new Chess(), 20) + ' *';
const t = Date.now();
const g = parsePgn(pgn);
console.log('pgn KB', Math.round(pgn.length/1024), 'lines', g[0].lines.length, 'ms', Date.now() - t, 'color guess', g[0].guessedColor);
require('fs').writeFileSync('test/big.pgn', pgn);
