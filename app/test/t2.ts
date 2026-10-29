import { Chess } from 'chessops/chess';
import { parseUci } from 'chessops/util';
import { makeSanAndPlay } from 'chessops/san';
const pos = Chess.default();
for (const u of ['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','e1g1']) {
  const m = parseUci(u)!; const n = (pos as any).normalizeMove ? (pos as any).normalizeMove(m) : m;
  console.log(u, JSON.stringify(n), pos.isLegal(n), makeSanAndPlay(pos, n));
}
