<script setup lang="ts">
/** Small static board (no interaction): pieces, last move highlight, and one arrow. */
import { computed } from 'vue';
import { state } from './store';
import { BOARDS } from './assets/boards';
import { PIECE_SETS } from './assets/pieces';

const props = defineProps<{
  /** FEN or just its piece placement. */
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: string | null; // uci
  arrow?: string | null; // uci
}>();

const boardImg = computed(() => (BOARDS.find((b) => b.id === state.settings.theme) ?? BOARDS[0]).img);
const pieces = computed(() => (PIECE_SETS[state.settings.pieceSet] ?? PIECE_SETS.cburnett).pieces);

/** Square "e4" → [x, y] in board coordinates (0..7, top-left origin) for the orientation. */
function xy(sq: string): [number, number] {
  const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1;
  return props.orientation === 'white' ? [f, 7 - r] : [7 - f, r];
}

const placed = computed(() => {
  const out: { key: string; img: string; x: number; y: number }[] = [];
  props.fen.split(' ')[0].split('/').forEach((row, ri) => {
    let fi = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { fi += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const sq = String.fromCharCode(97 + fi) + (8 - ri);
      const [x, y] = xy(sq);
      out.push({ key: sq, img: pieces.value[color + ch.toUpperCase()], x, y });
      fi++;
    }
  });
  return out;
});

const hl = computed(() => (props.lastMove ? [props.lastMove.slice(0, 2), props.lastMove.slice(2, 4)].map(xy) : []));
const arr = computed(() => {
  if (!props.arrow) return null;
  const [x1, y1] = xy(props.arrow.slice(0, 2));
  const [x2, y2] = xy(props.arrow.slice(2, 4));
  // stop the line a bit before the target centre so the head sits on the square
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  return { x1: x1 + 0.5, y1: y1 + 0.5, x2: x2 + 0.5 - (dx / len) * 0.25, y2: y2 + 0.5 - (dy / len) * 0.25 };
});
</script>

<template>
  <div class="mini" :style="{ backgroundImage: `url(${boardImg})` }">
    <div v-for="(p, i) in hl" :key="'h' + i" class="mini-hl" :style="{ left: p[0] * 12.5 + '%', top: p[1] * 12.5 + '%' }"></div>
    <div v-for="p in placed" :key="p.key" class="mini-pc" :style="{ left: p.x * 12.5 + '%', top: p.y * 12.5 + '%', backgroundImage: `url(${p.img})` }"></div>
    <svg v-if="arr" class="mini-arrow" viewBox="0 0 8 8">
      <defs>
        <marker id="mah" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 V4 L3,2 Z" fill="#15781b" />
        </marker>
      </defs>
      <line :x1="arr.x1" :y1="arr.y1" :x2="arr.x2" :y2="arr.y2" stroke="#15781b" stroke-width="0.17" stroke-linecap="round" marker-end="url(#mah)" opacity="0.85" />
    </svg>
  </div>
</template>
