import { watch } from 'vue';
import { state } from './store';
import { BOARDS } from './assets/boards';
import { PIECE_SETS } from './assets/pieces';

const ROLE: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

function styleEl(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/** Darken a #rrggbb colour (for readable coordinates on light squares). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function applyBoard() {
  const b = BOARDS.find((x) => x.id === state.settings.theme) ?? BOARDS[0];
  styleEl('board-theme').textContent = `
cg-board { background-color: ${b.light}; background-image: url("${b.img}"); background-size: 100% 100%; }
:root { --coord-on-light: ${shade(b.dark, 0.8)}; --coord-on-dark: ${b.light}; }`;
}

function applyPieces() {
  const set = PIECE_SETS[state.settings.pieceSet] ?? PIECE_SETS.cburnett;
  let css = '';
  for (const [k, uri] of Object.entries(set.pieces)) {
    css += `.cg-wrap piece.${ROLE[k[1]]}.${k[0] === 'w' ? 'white' : 'black'} { background-image: url("${uri}"); }\n`;
  }
  styleEl('piece-set').textContent = css;
}

export function initTheme() {
  watch(() => state.settings.theme, applyBoard, { immediate: true });
  watch(() => state.settings.pieceSet, applyPieces, { immediate: true });
}
