<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Chess, type Square } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import Board from './Board.vue';
import { moveNumberPrefix, lichessUrl, DEFAULT_FEN } from './pgn';
import type { LibLine } from './store';
import { playSound } from './sound';

const props = withDefaults(
  defineProps<{
    item: LibLine; delay: number; autoNext: boolean; progress: string; modeLabel: string; startPly?: number;
    /** Showing an already finished attempt again: its mistake plies. */
    review?: number[] | null;
    canPrev?: boolean;
    /** A redo: a clean run doesn't count as fixing the line. */
    practice?: boolean;
  }>(),
  { startPly: 0, review: null, canPrev: false, practice: false },
);
const emit = defineEmits<{
  (e: 'done', errorPlies: number[]): void;
  (e: 'next'): void;
  (e: 'skip'): void;
  (e: 'quit'): void;
  (e: 'prev'): void;
  (e: 'redo'): void;
  (e: 'explore', init: { fen: string; moves: string[]; cursor: number; color: 'w' | 'b' }): void;
}>();

type Status = { kind: 'turn' | 'opp' | 'ok' | 'wrong' | 'alt' | 'done' | 'donebad'; text: string };

const board = ref<InstanceType<typeof Board> | null>(null);
const chess = new Chess();
const ply = ref(0);
/** Every ply where the user went wrong in this run (each position counted once). */
const errPlies = ref<number[]>([]);
const mistake = computed(() => errPlies.value.length > 0);
const finished = ref(false);
const status = ref<Status>({ kind: 'opp', text: '' });
const comment = ref('');
const shake = ref(false);
let lastMove: Key[] | undefined;
let timer = 0;
const fenNow = ref(DEFAULT_FEN);
// Moves played so far (whole line once finished), so lichess opens at the current position.
const lichess = computed(() => lichessUrl(line.value.startFen, moves.value.slice(0, finished.value ? moves.value.length : ply.value).map((m) => m.san), colorName.value, fenNow.value));

const line = computed(() => props.item.line);
const moves = computed(() => line.value.moves);
const colorName = computed(() => (props.item.color === 'w' ? 'white' : 'black'));
const playedText = computed(() => movesUpTo(ply.value));

function movesUpTo(n: number) {
  return moves.value.slice(0, n).map((m, i) => {
    const { num, white } = moveNumberPrefix(line.value.startFen, i);
    return { label: white ? `${num}.${m.san}` : i === 0 ? `${num}...${m.san}` : m.san, err: errPlies.value.includes(i), i };
  });
}

function turnName(): 'white' | 'black' {
  return chess.turn() === 'w' ? 'white' : 'black';
}

function dests(): Map<Key, Key[]> {
  const d = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const arr = d.get(m.from as Key);
    if (arr) arr.push(m.to as Key);
    else d.set(m.from as Key, [m.to as Key]);
  }
  return d;
}

function shapes(s: DrawShape[]) {
  board.value?.api()?.setAutoShapes(s);
}

/**
 * Push the position to the board.
 * - 'play': user's turn, legal moves enabled
 * - 'wait': opponent's turn — the user can already select a piece and premove
 * - 'lock': line finished, no interaction
 */
function sync(mode: 'play' | 'wait' | 'lock') {
  const userMoves = mode === 'play' ? dests() : new Map<Key, Key[]>();
  fenNow.value = chess.fen();
  board.value?.set({
    fen: chess.fen(),
    turnColor: turnName(),
    lastMove,
    check: chess.inCheck() ? turnName() : false,
    movable: mode === 'lock'
      ? { color: undefined, dests: new Map() }
      : { color: colorName.value, dests: userMoves, events: { after: onUserMove } },
  });
  if (mode === 'lock') board.value?.api()?.cancelPremove();
}

function start() {
  chess.load(line.value.startFen);
  lastMove = undefined;
  if (props.review) {
    // Previous line shown again, in its finished state.
    for (const m of moves.value) applyUci(m.uci, false);
    ply.value = moves.value.length;
    errPlies.value = props.review.slice();
    board.value?.set({ orientation: colorName.value, fen: chess.fen(), lastMove });
    finish(false);
    return;
  }
  // Training from a searched position: jump straight there.
  const skip = Math.min(props.startPly, moves.value.length);
  for (let i = 0; i < skip; i++) applyUci(moves.value[i].uci, false);
  ply.value = skip;
  if (skip) comment.value = moves.value[skip - 1].comment;
  board.value?.set({ orientation: colorName.value, fen: chess.fen(), lastMove });
  step(true);
}

function step(first = false) {
  if (ply.value >= moves.value.length) return finish();
  if (chess.turn() !== props.item.color) {
    sync('wait');
    if (status.value.kind !== 'ok') status.value = { kind: 'opp', text: 'Opponent…' };
    timer = window.setTimeout(playOpponent, first ? Math.max(500, props.delay) : props.delay);
  } else {
    sync('play');
    if (status.value.kind !== 'ok') status.value = { kind: 'turn', text: 'Your move' };
    // Play a premove made while the opponent was moving (validated like a normal move).
    board.value?.api()?.playPremove();
  }
}

function applyUci(uci: string, sound = true) {
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promotion = uci[4];
  const m = chess.move({ from, to, promotion });
  lastMove = [from as Key, to as Key];
  if (sound) playSound(m.captured ? 'capture' : 'move');
}

function playOpponent() {
  const mv = moves.value[ply.value];
  applyUci(mv.uci);
  ply.value++;
  comment.value = mv.comment;
  if (status.value.kind !== 'ok') status.value = { kind: 'turn', text: 'Your move' };
  step();
}

function sanOf(uci: string): string {
  try {
    const c = new Chess(chess.fen());
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

function markMistake() {
  if (!errPlies.value.includes(ply.value)) errPlies.value.push(ply.value);
}

function plyLabel(p: number): string {
  const { num, white } = moveNumberPrefix(line.value.startFen, p);
  return `${num}${white ? '.' : '...'}${moves.value[p].san}`;
}

function onUserMove(orig: Key, dest: Key) {
  const exp = moves.value[ply.value];
  const piece = chess.get(orig as Square);
  let promo = '';
  if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) promo = exp.uci.startsWith(orig + dest) ? exp.uci[4] || 'q' : 'q';
  const uci = orig + dest + promo;
  if (uci === exp.uci) {
    applyUci(uci);
    shapes([]);
    ply.value++;
    comment.value = exp.comment;
    status.value = { kind: 'ok', text: '✓ ' + exp.san };
    step();
    return;
  }
  const san = sanOf(uci);
  if (exp.alts.includes(uci)) {
    status.value = { kind: 'alt', text: `${san} is in another line of this PGN. This line wants a different move — try again.` };
  } else {
    markMistake();
    status.value = { kind: 'wrong', text: `✗ ${san} — the move is ${exp.san}` };
    shapes([{ orig: exp.uci.slice(0, 2) as Key, dest: exp.uci.slice(2, 4) as Key, brush: 'green' }]);
    shake.value = true;
    window.setTimeout(() => (shake.value = false), 400);
  }
  window.setTimeout(() => sync('play'), 160);
}

function hint() {
  if (finished.value || chess.turn() !== props.item.color) return;
  const exp = moves.value[ply.value];
  markMistake();
  shapes([{ orig: exp.uci.slice(0, 2) as Key, brush: 'yellow' }]);
  status.value = { kind: 'wrong', text: 'Hint: move the highlighted piece' };
}

function reveal() {
  if (finished.value || chess.turn() !== props.item.color) return;
  const exp = moves.value[ply.value];
  markMistake();
  shapes([{ orig: exp.uci.slice(0, 2) as Key, dest: exp.uci.slice(2, 4) as Key, brush: 'green' }]);
  status.value = { kind: 'wrong', text: `The move is ${exp.san} — play it` };
}

function finish(fresh = true) {
  finished.value = true;
  sync('lock');
  shapes([]);
  if (mistake.value) {
    const n = errPlies.value.length;
    const list = errPlies.value.map(plyLabel).join(', ');
    status.value = { kind: 'donebad', text: n === 1 ? `Line done — mistake at ${list}` : `Line done — ${n} mistakes: ${list}` };
  } else {
    status.value = {
      kind: 'done',
      text: !fresh ? '✓ No mistakes on this line' : props.practice ? '✓ Clean redo — still counted as missed, it will come back' : '✓ Line complete, no mistakes',
    };
  }
  if (!fresh) return;
  emit('done', errPlies.value.slice());
  if (props.autoNext && !mistake.value) timer = window.setTimeout(() => emit('next'), 1000);
}

/**
 * Open the explorer. After the line: the whole line, just before the first mistake (or at its end).
 * During the line: only the moves played so far (no spoilers in the move list); since the explorer
 * shows your repertoire's answer, opening it on your turn counts as a hint.
 */
function explore() {
  if (!finished.value) {
    if (chess.turn() === props.item.color) {
      markMistake();
      status.value = { kind: 'wrong', text: 'Explored on your move — counted as a hint' };
    }
    emit('explore', { fen: line.value.startFen, moves: moves.value.slice(0, ply.value).map((m) => m.uci), cursor: ply.value, color: props.item.color });
    return;
  }
  clearTimeout(timer); // stay on this line when coming back
  emit('explore', {
    fen: line.value.startFen,
    moves: moves.value.map((m) => m.uci),
    cursor: errPlies.value.length ? Math.min(...errPlies.value) : moves.value.length,
    color: props.item.color,
  });
}
function redo() {
  clearTimeout(timer);
  emit('redo');
}
function prev() {
  clearTimeout(timer);
  emit('prev');
}

defineExpose({ redraw: () => board.value?.api()?.redrawAll() });

onMounted(start);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="trainer">
    <div class="tbar">
      <button class="icon" @click="emit('quit')" aria-label="End session">✕</button>
      <div class="tinfo">
        <div class="tprog">{{ progress }}</div>
        <div class="tsub">{{ modeLabel }} · {{ item.gameName }} · as {{ item.color === 'w' ? 'White' : 'Black' }}</div>
      </div>
      <button class="icon" v-if="!finished" @click="emit('skip')" aria-label="Skip line" title="Skip (not recorded)">⏭</button>
    </div>
    <button v-if="canPrev" class="prevline" @click="prev">‹ previous line</button>

    <div :class="['board-box', { shake }]"><Board ref="board" /></div>

    <div :class="['status', 's-' + status.kind]">{{ status.text }}</div>
    <div class="comment" v-if="comment">💬 {{ comment }}</div>

    <div class="tbtns" v-if="!finished">
      <button class="btn" @click="hint">Hint</button>
      <button class="btn" @click="reveal">Show move</button>
      <button class="btn icon-btn" @click="explore" aria-label="Explore" title="Explore (counts as a hint on your move)">🔍</button>
      <a class="btn lichess" :href="lichess" target="_blank" rel="noopener">lichess ↗</a>
    </div>
    <template v-else>
      <div class="tbtns">
        <button class="btn" @click="explore">🔍 Explore</button>
        <button class="btn" @click="redo">↻ Redo</button>
        <a class="btn lichess" :href="lichess" target="_blank" rel="noopener">lichess ↗</a>
      </div>
      <div class="tbtns">
        <button class="btn primary big" @click="emit('next')">{{ review ? 'Continue ›' : 'Next ›' }}</button>
      </div>
    </template>

    <div class="movelist">
      <template v-if="!finished">
        <span v-for="m in playedText" :key="m.i" :class="['mv', { err: m.err }]">{{ m.label }}</span>
        <span class="muted" v-if="!playedText.length">Line starts…</span>
      </template>
      <template v-else>
        <span v-for="m in movesUpTo(moves.length)" :key="m.i" :class="['mv', { err: m.err }]">{{ m.label }}</span>
      </template>
    </div>
  </div>
</template>
