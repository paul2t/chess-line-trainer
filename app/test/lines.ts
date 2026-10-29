import { readFileSync } from 'fs';
import { pgnToLines, buildLine, lineToPgn, parsePgn } from '../src/pgn';
const sample = pgnToLines(readFileSync(process.argv[2], 'utf8'));
for (const o of sample) console.log(o.title.padEnd(48), o.line.moves.length, o.line.id);
// round trip each line through buildLine and lineToPgn
let ok = true;
for (const o of sample) {
  const b = buildLine(o.line.startFen, o.line.moves.map((m) => m.uci), Object.fromEntries(o.line.moves.map((m, i) => [i, m.comment]).filter(([, c]) => c)));
  if (b.id !== o.line.id || b.keys.join() !== o.line.keys.join()) { ok = false; console.log('MISMATCH', o.title); }
  const back = parsePgn(lineToPgn(b, o.title))[0];
  if (back.lines[0].id !== o.line.id || back.headers.Event !== o.title) { ok = false; console.log('PGN MISMATCH', o.title, back.headers.Event); }
}
console.log('round-trip ok:', ok);
console.log(lineToPgn(sample[1].line, sample[1].title));
