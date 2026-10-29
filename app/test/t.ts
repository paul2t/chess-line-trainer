import { readFileSync } from 'fs';
import { parsePgn, formatMoves } from '../src/pgn';
const games = parsePgn(readFileSync(process.argv[2], 'utf8'));
for (const g of games) {
  console.log('==', g.name, 'color', g.guessedColor, 'errors', g.errors);
  for (const l of g.lines) console.log(' ', l.id, formatMoves(l.startFen, l.moves), '| alts@', l.moves.map((m,i)=>m.alts.length?i+':'+m.alts.join(','):'').filter(Boolean).join(' '), '| comments', l.moves.filter(m=>m.comment).map(m=>m.san+'='+m.comment).join(';'));
}
