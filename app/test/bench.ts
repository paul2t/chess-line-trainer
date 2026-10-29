import { parsePgn } from '../src/pgn';
import { readFileSync } from 'fs';
const pgn = readFileSync('test/big.pgn','utf8');
for (let i=0;i<4;i++){ const t=Date.now(); parsePgn(pgn+' '.repeat(i)); console.log('run',i,Date.now()-t,'ms'); }
import { Chess } from 'chess.js';
const c = new Chess(); let t=Date.now(); for (let i=0;i<2000;i++){ c.reset(); c.move('e4',{strict:false}); c.move('e5',{strict:false}); } console.log('4000 sloppy moves', Date.now()-t);
t=Date.now(); for (let i=0;i<2000;i++){ c.reset(); c.move('e4'); c.move('e5'); } console.log('4000 strict moves', Date.now()-t);
t=Date.now(); for (let i=0;i<2000;i++){ c.load('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'); } console.log('2000 loads', Date.now()-t);
