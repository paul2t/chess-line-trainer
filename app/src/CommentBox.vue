<script setup lang="ts">
import { computed, ref } from 'vue';
/** A move comment; long ones start collapsed to a few lines (tap to expand / collapse). */
const props = defineProps<{ label: string; text: string }>();
const long = computed(() => props.text.length > 220 || props.text.split('\n').length > 3);
const open = ref(false);
</script>

<template>
  <div :class="['comment', { long }]" @click="long && (open = !open)">
    <div :class="['ctext', { clamp: long && !open }]">💬 <b>{{ label }}</b> {{ text }}</div>
    <span v-if="long" class="more">{{ open ? 'Show less ▴' : 'Show more ▾' }}</span>
  </div>
</template>
