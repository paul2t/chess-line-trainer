// Simulates reviews with the real store code (browser globals stubbed).
const mem: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => (mem[k] = v), removeItem: (k: string) => delete mem[k] };
(globalThis as any).window = { addEventListener() {}, setTimeout: (f: () => void) => 0 };
(globalThis as any).document = { addEventListener() {}, visibilityState: 'visible', createElement: () => ({}) };
let now = Date.UTC(2026, 9, 1);
Date.now = () => now;
const { state, recordAttempt, intervalDays, dueAt, ease, priority } = await import('../src/store');
const DAY = 86400000;
function run(id: string, missEvery: number, pop = 0, days = 120) {
  now = Date.UTC(2026, 9, 1);
  let n = 0, reviews = 0, misses = 0;
  const ivs: number[] = [];
  for (let d = 0; d < days; d++, now += DAY) {
    const st = state.stats[id];
    if (st && now < dueAt(st)) continue;
    // review (and redo until clean the same day when missed, like "drill today's mistakes")
    n++;
    const miss = missEvery > 0 && n % missEvery === 0;
    recordAttempt(id, miss ? [5] : [], pop); reviews++; if (miss) { misses++; recordAttempt(id, [], pop); reviews++; }
    ivs.push(intervalDays(state.stats[id]));
  }
  console.log(`${id.padEnd(26)} review days: ${String(n).padStart(3)}  intervals: ${ivs.slice(0, 12).join(',')}  ease ${ease(state.stats[id]).toFixed(2)}`);
}
run('never missed', 0);
run('missed 1 in 3', 3);
run('missed 1 in 2', 2);
run('never missed, popular', 0, 1);
// priority of two due lines with same recency: error-prone one first
now = Date.UTC(2026, 9, 1);
state.stats.A = { a: 8, e: 1, m: [], lr: now - 10 * DAY, lm: 0, s: 3, lc: true, ep: -1, h: [0, 0, 0, 0, 0, 0, 1, 0], iv: 5 };
state.stats.B = { a: 8, e: 4, m: [], lr: now - 10 * DAY, lm: 0, s: 1, lc: true, ep: -1, h: [1, 0, 1, 0, 1, 1, 0, 0], iv: 5 };
console.log('priority easy line:', priority(state.stats.A).toFixed(2), '| error-prone line:', priority(state.stats.B).toFixed(2));
// old data (no ease/interval yet) keeps working
state.stats.C = { a: 6, e: 3, m: [], lr: now, lm: 0, s: 2, lc: true, ep: -1 };
console.log('old line without history: interval', intervalDays(state.stats.C), 'days, ease', ease(state.stats.C).toFixed(2));
