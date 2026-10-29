import { MOVE_MP3, CAPTURE_MP3 } from './sound-data';
import { state } from './store';

type SoundName = 'move' | 'capture';
const DATA: Record<SoundName, string> = { move: MOVE_MP3, capture: CAPTURE_MP3 };

let ctx: AudioContext | null = null;
const buffers: Partial<Record<SoundName, AudioBuffer>> = {};

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Browsers only allow audio after a user gesture: create/resume the context on the first tap. */
function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      for (const k of Object.keys(DATA) as SoundName[]) {
        ctx.decodeAudioData(b64ToArrayBuffer(DATA[k])).then((b) => (buffers[k] = b)).catch(() => {});
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

export function initSound() {
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('touchstart', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
}

export function playSound(name: SoundName) {
  if (!state.settings.sound || !ctx) return;
  const buf = buffers[name];
  if (!buf) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, state.settings.volume));
    src.buffer = buf;
    src.connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    /* ignore */
  }
}
