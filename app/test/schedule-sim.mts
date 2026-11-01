(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(globalThis as any).document = { addEventListener() {}, visibilityState: 'visible', createElement: () => ({}) , createElementNS: () => ({}) };
(globalThis as any).window = globalThis; (globalThis as any).addEventListener = () => {};
const S = await import('/home/claude/chesstrainer/src/store.ts');
const { state, priority, resting, dueAt, recordAttempt } = S as any;
// Simulate: 40 lines, 3 smart sessions of 10 per day, 15 days. Lines 0..7 are "hard" (40% miss), others 5%.
let t = new Date(2026, 10, 1, 9).getTime();
const realNow = Date.now; Date.now = () => t;
const ids = Array.from({ length: 40 }, (_, i) => 'L' + i);
let rnd = 7; const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const seenCount: Record<string, number> = {};
let violations = 0;
for (let day = 0; day < 15; day++) {
  for (let sess = 0; sess < 3; sess++) {
    t = new Date(2026, 10, 1 + day, 9 + sess * 4).getTime();
    const due = ids.map((id) => ({ id, p: priority(state.stats[id], t) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p).map((x) => x.id);
    let pick = due.slice(0, 10), kind = 'due';
    if (!pick.length) {
      const lr = (id: string) => state.stats[id]?.lr ?? 0;
      const fresh = ids.filter((id) => !resting(state.stats[id], t)).sort((a, b) => dueAt(state.stats[a]) - dueAt(state.stats[b]) || lr(a) - lr(b));
      const rested = ids.filter((id) => resting(state.stats[id], t)).sort((a, b) => lr(a) - lr(b));
      pick = [...fresh, ...rested].slice(0, 10); kind = 'ahead';
    }
    // a line got right earlier today, offered while some line wasn't done today yet = violation
    const notDoneToday = ids.filter((id) => !resting(state.stats[id], t));
    for (const id of pick) if (resting(state.stats[id], t) && notDoneToday.length >= 10) violations++;
    const queue = [...pick];
    const res: string[] = [];
    while (queue.length) {
      const id = queue.shift()!; t += 60000;
      const hard = +id.slice(1) < 8;
      const miss = r() < (hard ? 0.4 : 0.05);
      recordAttempt(id, miss ? [5] : []);
      seenCount[id] = (seenCount[id] ?? 0) + 1;
      if (miss) queue.push(id); // repeat failed
      res.push(id + (miss ? '✗' : ''));
    }
    console.log(`d${day} s${sess} ${kind.padEnd(5)} ${res.join(' ')}`);
  }
}
console.log('violations', violations);
console.log('reviews per line', ids.map((id) => seenCount[id] ?? 0).join(' '));
Date.now = realNow;
