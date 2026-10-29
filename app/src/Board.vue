<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';

const el = ref<HTMLElement | null>(null);
let cg: Api | null = null;
const pending: Config[] = [];

const onResize = () => cg?.redrawAll();

onMounted(() => {
  cg = Chessground(el.value!, {
    animation: { enabled: true, duration: 220 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: true, showDests: true, castle: true },
    draggable: { showGhost: true },
    drawable: { enabled: false, visible: true },
    movable: { free: false, showDests: true },
    coordinates: true,
  });
  for (const c of pending.splice(0)) cg.set(c);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  cg?.destroy();
});

defineExpose({
  set(c: Config) {
    if (cg) cg.set(c); else pending.push(c);
  },
  api: () => cg,
});
</script>

<template>
  <div class="board-outer"><div ref="el" class="cg-wrap"></div></div>
</template>
