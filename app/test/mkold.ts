// Builds a localStorage snapshot in the OLD (v1) format, with progress keyed by the old line ids.
import { readFileSync, writeFileSync } from 'fs';
import { parsePgn } from '../src/pgn';
const text = readFileSync('test/sample.pgn', 'utf8');
const games = parsePgn(text);
const ids = games.map((g) => g.lines.map((l) => l.id));
const now = Date.now();
const files = [
  { id: 'f1abc', name: 'My repertoire', text, added: now - 9e8, updated: now - 9e8, color: 'b', colors: { 1: 'w', 2: 'w' } },
  { id: 'f2xyz', name: 'Caro', text: readFileSync('/mnt/user-data/uploads/baa1e114-caro_kann_1_advance_sidelines.pgn', 'utf8'), added: now - 5e8, updated: now - 5e8, color: 'w', colors: {} },
];
const stat = (lm: number, a: number) => ({ a, e: 1, m: [lm], lr: lm, lm, s: 0, lc: false, ep: 3 });
const stats = { [ids[0][0]]: stat(now - 3600e3, 4), [ids[1][0]]: stat(now - 86400e3 * 3, 2), [ids[0][2]]: { a: 3, e: 0, m: [], lr: now - 86400e3, lm: 0, s: 2, lc: true, ep: -1 } };
const disabled = { [ids[0][4]]: true };
const selection = [ids[0][1], ids[2][0]];
writeFileSync('test/old-state.json', JSON.stringify({
  'clt.files.v1': files, 'clt.stats.v1': stats, 'clt.disabled.v1': disabled, 'clt.selection.v1': selection, 'clt.settings.v1': { theme: 'wood4' },
  expect: { lines: games.reduce((a, g) => a + g.lines.length, 0), ids, statIds: Object.keys(stats), disabled: Object.keys(disabled), selection },
}));
console.log('old games:', games.map((g) => `${g.name}: ${g.lines.length} lines`).join(', '));
