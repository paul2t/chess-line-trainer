import { readFileSync } from 'fs';
import { parsePgn, posKey } from '../src/pgn';
import { Chess } from 'chess.js';
const g = parsePgn(readFileSync('test/sample.pgn','utf8'));
const l = g[0].lines[0];
const c = new Chess(); for (const m of l.moves.slice(0,6)) c.move(m.san);
console.log('chess.js key', posKey(c.fen())); console.log('chessops key', l.keys[6], posKey(c.fen())===l.keys[6]);
console.log('lines through it:', g.flatMap(x=>x.lines).filter(x=>x.keys.includes(posKey(c.fen()))).length);
// en-passant field difference check: after 1.e4 chess.js fen
const c2=new Chess(); c2.move('e4'); console.log(c2.fen(), '|', l.keys[1]);
