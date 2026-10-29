<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  state, library, allLines, importPgn, removeChapter, renameChapter, removeLine, renameLine, setChapterColor, setChapterDisabled, moveLine, createChapter, isOff,
  priority, isToday, lineBadge, relDay, recentErrors, setDisabled, guessColor, conflicts, conflictPosition,
  type Conflict, type LibChapter, type LibEntry, type Mode, type Chapter,
} from './store';
import { moveTokens, lichessUrl, lineToPgn, type Color } from './pgn';
import { Chess } from 'chess.js';
import { askConfirm, askText } from './confirm';
import { lineGames, popularity, fmtGames, missingReplies, missingLabel, lichess } from './lichess';

const emit = defineEmits<{
  (e: 'start', mode: Mode, ids: string[]): void;
  (e: 'toast', msg: string): void;
  (e: 'search', init?: { fen: string; moves: string[] }): void;
}>();

const now = ref(Date.now());
const open = reactive(new Set<string>());
const toggleOpen = (k: string) => (open.has(k) ? open.delete(k) : open.add(k));

const sel = computed(() => new Set(state.selection));
const enabledIds = (ids: string[]) => ids.filter((id) => !isOff(id) && allLines.value.has(id));

/** Trainable line ids of a chapter (lines where you have at least one move). */
function chapterIds(c: LibChapter): string[] {
  return [...new Set(c.lines.filter((e) => e.trainable).map((e) => e.line.id))];
}

const scopeIds = computed(() => {
  const base = state.selection.length ? state.selection : [...allLines.value.keys()];
  return enabledIds(base);
});
const scopeLabel = computed(() =>
  state.selection.length ? `${scopeIds.value.length} selected line${scopeIds.value.length === 1 ? '' : 's'}` : `all lines (${scopeIds.value.length})`,
);

/** Smart priority + a bonus for lines that are played a lot on lichess (most for lines never trained). */
function smartPriority(id: string, t: number): number {
  const st = state.stats[id];
  const p = priority(st, t);
  if (p <= 0) return p;
  const it = allLines.value.get(id);
  return p + (it ? popularity(it) * (st?.a ? 0.5 : 1) : 0);
}

const dueIds = computed(() => {
  const t = now.value;
  return scopeIds.value
    .map((id, i) => ({ id, p: smartPriority(id, t), i }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.id);
});
const todayIds = computed(() => scopeIds.value.filter((id) => isToday(state.stats[id]?.lm ?? 0, now.value)));
const todayUnfixed = computed(() => todayIds.value.filter((id) => !state.stats[id]?.lc).length);
const smartCount = computed(() => Math.min(state.settings.sessionSize, Math.max(dueIds.value.length, 0)));

function startSmart() {
  let ids = dueIds.value.slice(0, state.settings.sessionSize);
  if (!ids.length) {
    const t = now.value;
    ids = [...scopeIds.value].sort((a, b) => smartPriority(b, t) - smartPriority(a, t)).slice(0, state.settings.sessionSize);
    if (!ids.length) return emit('toast', 'No lines to train. Add a PGN first.');
    emit('toast', 'Nothing due — reviewing the lines closest to due.');
  }
  emit('start', 'smart', ids);
}
function startToday() {
  if (!todayIds.value.length) return emit('toast', 'No mistakes today in this scope 🎉');
  emit('start', 'today', todayIds.value);
}
function startAll(shuffle: boolean) {
  const ids = [...scopeIds.value];
  if (!ids.length) return emit('toast', 'No lines to train.');
  if (shuffle) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  emit('start', shuffle ? 'random' : 'all', ids);
}

/* ---------- selection ---------- */
function selState(ids: string[]): 'all' | 'some' | 'none' {
  let n = 0;
  for (const id of ids) if (sel.value.has(id)) n++;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}
function toggleSel(ids: string[]) {
  const s = new Set(state.selection);
  if (selState(ids) === 'all') ids.forEach((id) => s.delete(id));
  else ids.forEach((id) => s.add(id));
  state.selection = [...s];
}
function clearSel() { state.selection = []; }
/* ---------- copy as PGN (one game per line, Event = line title) ---------- */
const pgnBox = ref('');
function entriesPgn(entries: { e: LibEntry; chapter: Chapter }[]): string {
  return entries
    .map(({ e }) => lineToPgn(e.line, e.stored.title, { Orientation: e.color === 'w' ? 'white' : 'black' }))
    .join('\n');
}
async function copyPgn(pgn: string, n: number) {
  if (!pgn) return emit('toast', 'Nothing to copy.');
  try {
    await navigator.clipboard.writeText(pgn);
    emit('toast', `Copied ${n} line(s) as PGN`);
  } catch {
    pgnBox.value = pgn; // clipboard blocked: show it for manual copy
  }
}
function copySelPgn() {
  const sel = new Set(state.selection);
  const done = new Set<string>();
  const list: { e: LibEntry; chapter: Chapter }[] = [];
  for (const lc of library.value)
    for (const e of lc.lines)
      if (sel.has(e.line.id) && !done.has(e.line.id)) { done.add(e.line.id); list.push({ e, chapter: lc.chapter }); }
  copyPgn(entriesPgn(list), list.length);
}
function selectPgnText(e: Event) {
  (e.target as HTMLTextAreaElement).select();
}

function disableSel(off: boolean) {
  setDisabled(state.selection, off);
  emit('toast', `${state.selection.length} line(s) ${off ? 'disabled' : 'enabled'}`);
}

/* ---------- stats helpers ---------- */
function counts(ids: string[]) {
  const t = now.value;
  let due = 0, off = 0, bad = 0;
  for (const id of ids) {
    if (isOff(id)) { off++; continue; }
    const st = state.stats[id];
    if (priority(st, t) > 0) due++;
    if (st && isToday(st.lm, t) && !st.lc) bad++;
  }
  return { due, off, bad };
}

/** Line rows of a chapter, with the moves shared with the previous line greyed out. */
function rows(c: LibChapter) {
  const out: { id: string; e: LibEntry; prefix: string; rest: string; trainable: boolean }[] = [];
  let prev: string[] = [];
  for (const e of c.lines) {
    const l = e.line;
    const u = l.moves.map((m) => m.uci);
    let k = 0;
    while (k < u.length && k < prev.length && u[k] === prev[k]) k++;
    if (k === u.length) k = Math.max(0, u.length - 1);
    const tk = moveTokens(l.startFen, l.moves);
    out.push({ id: l.id, e, prefix: tk.slice(0, k).join(' '), rest: tk.slice(k).join(' '), trainable: e.trainable });
    prev = u;
  }
  return out;
}

function gamesOf(id: string): string {
  const it = allLines.value.get(id);
  return it ? fmtGames(lineGames(it)) : '';
}

function statText(id: string): string {
  const st = state.stats[id];
  if (!st || !st.a) return '';
  const re = recentErrors(st, now.value);
  const parts = [`${st.a} tr`];
  if (st.e) parts.push(`${st.mc ?? st.e}✗`);
  if (st.lm) parts.push(`last ✗ ${relDay(st.lm, now.value)}`);
  if (re >= 0.05) parts.push(`recent ${re.toFixed(1)}`);
  return parts.join(' · ');
}

function toggleLine(id: string) {
  setDisabled([id], !state.disabled[id]);
}
/** True when every trainable line in the group is switched off (by itself or by its chapter). */
function allOff(ids: string[]) {
  return ids.length > 0 && ids.every((id) => isOff(id));
}
function anyOn(ids: string[]) {
  return ids.some((id) => !state.disabled[id]);
}
function toggleGameEnabled(ids: string[]) {
  setDisabled(ids, anyOn(ids));
}

/* ---------- import ---------- */
const fileInput = ref<HTMLInputElement | null>(null);
const paste = reactive({ show: false, text: '' });
/** PGNs waiting for the user to choose where they go: a new chapter (default) or an existing one. */
interface Pending { name: string; text: string; color: Color | 'auto'; mixed: boolean; target: string /* 'new' or chapter id */; lines: number }
const pending = ref<Pending[]>([]);

function pend(name: string, text: string): Pending {
  const g = guessColor(text);
  const lines = (text.match(/\[Event /g) ?? []).length;
  return { name, text, color: g.color, mixed: g.mixed, target: 'new', lines };
}
async function onFiles(ev: Event) {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  const list: Pending[] = [];
  for (const f of Array.from(files)) list.push(pend(f.name.replace(/\.pgn$/i, '').replace(/_/g, ' '), await f.text()));
  (ev.target as HTMLInputElement).value = '';
  pending.value = list;
}
function pasteNext() {
  if (!paste.text.trim()) return;
  pending.value = [pend(`Pasted ${new Date().toLocaleDateString()}`, paste.text)];
  paste.show = false; paste.text = '';
}
function confirmImport() {
  const msgs = pending.value.map((p) => {
    const r = importPgn(p.text, p.target === 'new' ? { kind: 'new', name: p.name.trim() || 'Chapter', color: p.color } : { kind: 'existing', chapterId: p.target });
    r.chapters.forEach((c) => open.add(c.id));
    return `${r.chapters.map((c) => c.name).join(' + ')}: ${r.added} line(s) added${r.skipped ? `, ${r.skipped} already there` : ''}`;
  });
  pending.value = [];
  now.value = Date.now();
  emit('toast', msgs.join('\n'));
}
function setAllPending(c: Color | 'auto') {
  pending.value.forEach((p) => (p.color = c));
}

/* ---------- chapter & line actions ---------- */
const menu = ref<null | { kind: 'chapter'; c: LibChapter } | { kind: 'line'; c: LibChapter; e: LibEntry } | { kind: 'move'; c: LibChapter; e: LibEntry }>(null);
async function delChapter(c: LibChapter) {
  menu.value = null;
  if (await askConfirm(`Delete chapter "${c.chapter.name}"?`, `Its ${c.lines.length} line(s) are removed. Progress is kept in case you import them again.`, 'Delete')) {
    removeChapter(c.chapter.id);
    state.selection = state.selection.filter((id) => allLines.value.has(id));
  }
}
function switchSide(c: LibChapter) {
  menu.value = null;
  setChapterColor(c.chapter, c.chapter.color === 'w' ? 'b' : 'w');
  emit('toast', `You now play ${c.chapter.color === 'w' ? 'White' : 'Black'} in “${c.chapter.name}”`);
}
async function renameCh(c: LibChapter) {
  menu.value = null;
  const n = await askText('Rename chapter', c.chapter.name);
  if (n) renameChapter(c.chapter, n);
}
function copyChapter(c: LibChapter) {
  menu.value = null;
  copyPgn(entriesPgn(c.lines.map((e) => ({ e, chapter: c.chapter }))), c.lines.length);
}
async function renameLn(c: LibChapter, e: LibEntry) {
  menu.value = null;
  const n = await askText('Rename line', e.stored.title);
  if (n) renameLine(c.chapter, e.stored.id, n);
}
async function delLine(c: LibChapter, e: LibEntry) {
  menu.value = null;
  if (await askConfirm(`Delete line "${e.stored.title}"?`, 'Its progress is kept in case you add it again.', 'Delete')) {
    removeLine(c.chapter, e.stored.id);
    state.selection = state.selection.filter((id) => allLines.value.has(id));
  }
}
/** Move a line to another chapter (also how a line changes side). */
function moveTo(c: LibChapter, e: LibEntry, targetId: string) {
  menu.value = null;
  const to = state.chapters.find((x) => x.id === targetId);
  if (!to) return;
  moveLine(c.chapter, e.stored.id, to);
  open.add(to.id);
  emit('toast', `Moved to “${to.name}”${to.color !== c.chapter.color ? ` — now trained as ${to.color === 'w' ? 'White' : 'Black'}` : ''}`);
}
async function moveToNew(c: LibChapter, e: LibEntry, color: Color) {
  const name = await askText(`New ${color === 'w' ? 'White' : 'Black'} chapter`, `${c.chapter.name} (${color === 'w' ? 'White' : 'Black'})`, 'Create');
  if (!name) return;
  moveTo(c, e, createChapter(name, color).id);
}
function copyLine(c: LibChapter, e: LibEntry) {
  menu.value = null;
  copyPgn(entriesPgn([{ e, chapter: c.chapter }]), 1);
}

/* ---------- conflicts / missing replies ---------- */
const showConflicts = ref(false);
const showMissing = ref(false);
const missShown = ref(30);
function conflictText(c: Conflict): string {
  const l = c.sample.item.line;
  return moveTokens(l.startFen, l.moves).slice(0, c.sample.ply).join(' ') || 'Start position';
}
function conflictLichess(c: Conflict): string {
  const p = conflictPosition(c);
  const ch = new Chess(p.fen);
  for (const u of p.moves) ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const sans = c.sample.item.line.moves.slice(0, c.sample.ply).map((m) => m.san);
  return lichessUrl(p.fen, sans, c.color === 'w' ? 'white' : 'black', ch.fen());
}
/** Lines of one conflict option, with the part before the conflict position faded. */
function optionLines(c: Conflict, ids: string[]) {
  const k = c.key.slice(0, c.key.lastIndexOf('|'));
  return ids.map((id) => {
    const it = allLines.value.get(id)!;
    const ply = Math.max(0, it.line.keys.indexOf(k));
    const t = moveTokens(it.line.startFen, it.line.moves);
    return { id, game: it.title, file: it.chapter.name, before: t.slice(0, ply).join(' '), move: t[ply] ?? '', after: t.slice(ply + 1).join(' ') };
  });
}
function disableOption(ids: string[], san: string) {
  setDisabled(ids, true);
  emit('toast', `Disabled ${ids.length} line(s) playing ${san}`);
}

defineExpose({ refresh: () => (now.value = Date.now()) });
</script>

<template>
  <div class="library">
    <section class="card train-card">
      <div class="scope">
        Training <b>{{ scopeLabel }}</b>
        <span v-if="state.selection.length" class="muted"> · <a href="#" @click.prevent="clearSel">use all</a></span>
      </div>
      <button class="btn primary big wide" @click="startSmart">
        Smart review <span class="pill">{{ smartCount }}</span>
        <div class="btn-sub">{{ dueIds.length }} due · recent mistakes first{{ lichess.token ? ', then most played' : '' }}</div>
      </button>
      <button :class="['btn big wide', todayUnfixed ? 'danger' : '']" @click="startToday">
        Drill today's mistakes <span class="pill">{{ todayIds.length }}</span>
        <div class="btn-sub" v-if="todayIds.length">
          {{ todayUnfixed ? `${todayUnfixed} not fixed yet` : 'all fixed ✓' }} · repeats until no mistake
        </div>
        <div class="btn-sub" v-else>none so far today</div>
      </button>
      <div class="row2">
        <button class="btn wide" @click="startAll(false)">All in order · {{ scopeIds.length }}</button>
        <button class="btn wide" @click="startAll(true)">Shuffle · {{ scopeIds.length }}</button>
      </div>
      <button class="btn wide" @click="emit('search')">🔍 Find &amp; explore lines</button>
    </section>

    <section v-if="conflicts.length" class="card warncard">
      <div class="warnhead" @click="showConflicts = !showConflicts">
        <span>⚠ {{ conflicts.length }} position{{ conflicts.length === 1 ? '' : 's' }} where your active lines play different moves</span>
        <span class="chev">{{ showConflicts ? '▾' : '▸' }}</span>
      </div>
      <div v-if="showConflicts">
        <p class="small muted">In these positions you'd have to remember which line you're in. Disable the lines you don't want, or keep both on purpose — the trainer still asks for the move of the line being trained.</p>
        <div v-for="c in conflicts" :key="c.key" class="conf">
          <div class="small muted">{{ c.sample.item.chapter.name }} · as {{ c.color === 'w' ? 'White' : 'Black' }}</div>
          <div class="ltext">{{ conflictText(c) }} <b>→ ?</b></div>
          <div class="confopts">
            <div v-for="o in c.options" :key="o.uci" class="confopt">
              <div class="confopt-head">
                <span><b>{{ o.san }}</b> <span class="muted small">· {{ o.ids.length }} line{{ o.ids.length === 1 ? '' : 's' }}</span></span>
                <button class="btn sm" @click="disableOption(o.ids, o.san)">Disable all {{ o.san }}</button>
              </div>
              <div v-for="r in optionLines(c, o.ids)" :key="r.id" class="lrow conf-line">
                <div class="lmain">
                  <div class="small muted">{{ r.file }} · {{ r.game }}</div>
                  <div class="ltext"><span class="lpre">{{ r.before }}</span> <b class="confmove">{{ r.move }}</b> {{ r.after }}</div>
                </div>
                <label class="switch" title="Disable this line">
                  <input type="checkbox" :checked="!state.disabled[r.id]" @change="toggleLine(r.id)" />
                  <span></span>
                </label>
              </div>
            </div>
          </div>
          <div class="confacts">
            <a href="#" @click.prevent="emit('search', conflictPosition(c))">Open in position search</a>
            <a :href="conflictLichess(c)" target="_blank" rel="noopener">Analyse on lichess ↗</a>
          </div>
        </div>
      </div>
    </section>

    <section v-if="missingReplies.length" class="card warncard misscard">
      <div class="warnhead" @click="showMissing = !showMissing">
        <span>📉 {{ missingReplies.length }} common repl{{ missingReplies.length === 1 ? 'y' : 'ies' }} missing from your lines</span>
        <span class="chev">{{ showMissing ? '▾' : '▸' }}</span>
      </div>
      <div v-if="showMissing">
        <p class="small muted">Opponent moves played at least {{ state.settings.missingThreshold }}% of the time on lichess (your level and time-control filters) that none of your active lines answers. Most played first.</p>
        <div v-for="m in missingReplies.slice(0, missShown)" :key="m.key + m.uci" class="conf">
          <div class="small muted">{{ m.sample.item.chapter.name }} · {{ m.sample.item.title }}</div>
          <div class="ltext">{{ missingLabel(m) }} <b class="missing">→ {{ m.san }}</b> <span class="gcount">{{ Math.round(m.share * 100) }}% · {{ fmtGames(m.games) }} games</span></div>
          <div class="confacts">
            <a href="#" @click.prevent="emit('search', { fen: m.sample.item.line.startFen, moves: m.sample.item.line.moves.slice(0, m.sample.ply).map((x) => x.uci) })">Open in explorer</a>
          </div>
        </div>
        <button v-if="missingReplies.length > missShown" class="btn wide" @click="missShown += 30">Show more ({{ missingReplies.length - missShown }})</button>
      </div>
    </section>

    <div v-if="state.selection.length" class="selbar">
      <span>{{ state.selection.length }} selected</span>
      <button class="btn sm" @click="copySelPgn">Copy PGN</button>
      <button class="btn sm" @click="disableSel(true)">Disable</button>
      <button class="btn sm" @click="disableSel(false)">Enable</button>
      <button class="btn sm" @click="clearSel">Clear</button>
    </div>

    <div class="lib-head">
      <h2>Chapters</h2>
      <div>
        <button class="btn sm" @click="paste.show = !paste.show">Paste</button>
        <button class="btn sm primary" @click="fileInput?.click()">+ Import PGN</button>
        <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
      </div>
    </div>

    <section class="card" v-if="paste.show">
      <textarea class="inp" v-model="paste.text" rows="6" placeholder="Paste PGN here…"></textarea>
      <button class="btn primary wide" @click="pasteNext">Next ›</button>
    </section>

    <div v-if="pgnBox" class="modal-bg" @click.self="pgnBox = ''">
      <div class="modal card">
        <h3>PGN</h3>
        <p class="small muted">Copying wasn't allowed here — tap the text, then copy it.</p>
        <textarea class="inp pgnbox" readonly rows="12" :value="pgnBox" @focus="selectPgnText" @click="selectPgnText"></textarea>
        <button class="btn primary wide" @click="pgnBox = ''">Close</button>
      </div>
    </div>

    <div v-if="pending.length" class="modal-bg">
      <div class="modal card">
        <h3>Import {{ pending.length }} PGN{{ pending.length > 1 ? 's' : '' }}</h3>
        <p class="small muted">Each game of the PGN becomes a line, titled with its Event. Games with variations are split into one line per variation.</p>
        <div v-if="pending.length > 1" class="colorpick">
          All new chapters:
          <button class="btn sm" @click="setAllPending('w')">♔ White</button>
          <button class="btn sm" @click="setAllPending('b')">♚ Black</button>
        </div>
        <div v-for="(p, i) in pending" :key="i" class="pend-block">
          <div class="small muted">{{ p.lines }} game{{ p.lines === 1 ? '' : 's' }} in this PGN</div>
          <label class="pick-label">Add to</label>
          <select class="inp" v-model="p.target">
            <option value="new">➕ New chapter</option>
            <option v-for="c in state.chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <template v-if="p.target === 'new'">
            <input class="inp" v-model="p.name" placeholder="Chapter name" />
            <div class="seg">
              <button :class="{ on: p.color === 'w' }" @click="p.color = 'w'">♔ White</button>
              <button :class="{ on: p.color === 'b' }" @click="p.color = 'b'">♚ Black</button>
              <button v-if="p.mixed" :class="{ on: p.color === 'auto' }" @click="p.color = 'auto'" title="Games look like a mix of White and Black repertoires: one chapter per side">Split by side</button>
            </div>
          </template>
          <p v-else class="small muted">You play {{ state.chapters.find((x) => x.id === p.target)?.color === 'w' ? 'White' : 'Black' }} in that chapter; lines already in it are skipped.</p>
        </div>
        <div class="row2">
          <button class="btn wide" @click="pending = []">Cancel</button>
          <button class="btn primary wide" @click="confirmImport">Import</button>
        </div>
      </div>
    </div>

    <div v-if="menu" class="modal-bg" @click.self="menu = null">
      <div class="modal card sheet">
        <template v-if="menu.kind === 'chapter'">
          <h3>{{ menu.c.chapter.name }}</h3>
          <button class="btn wide" @click="renameCh(menu.c)">✎ Rename</button>
          <button class="btn wide" @click="switchSide(menu.c)">{{ menu.c.chapter.color === 'w' ? '♚ Play Black in this chapter' : '♔ Play White in this chapter' }}</button>
          <button class="btn wide" @click="copyChapter(menu.c)">⧉ Copy as PGN</button>
          <button class="btn wide danger" @click="delChapter(menu.c)">🗑 Delete chapter</button>
        </template>
        <template v-else-if="menu.kind === 'line'">
          <h3>{{ menu.e.stored.title }}</h3>
          <button class="btn wide" @click="renameLn(menu.c, menu.e)">✎ Rename</button>
          <button class="btn wide" @click="menu = { kind: 'move', c: menu.c, e: menu.e }">↪ Move to chapter…</button>
          <button class="btn wide" @click="copyLine(menu.c, menu.e)">⧉ Copy as PGN</button>
          <button class="btn wide danger" @click="delLine(menu.c, menu.e)">🗑 Delete line</button>
        </template>
        <template v-if="menu.kind === 'move'">
          <h3>Move “{{ menu.e.stored.title }}” to</h3>
          <button v-for="ch in state.chapters.filter((x) => x.id !== menu!.c.chapter.id)" :key="ch.id" class="btn wide" @click="moveTo(menu!.c, menu!.e, ch.id)">
            {{ ch.color === 'w' ? '♔' : '♚' }} {{ ch.name }}
          </button>
          <button class="btn wide" @click="moveToNew(menu.c, menu.e, 'w')">➕ New White chapter…</button>
          <button class="btn wide" @click="moveToNew(menu.c, menu.e, 'b')">➕ New Black chapter…</button>
        </template>
        <button class="btn wide" @click="menu = null">Close</button>
      </div>
    </div>

    <div v-if="!library.length" class="empty card">
      <p><b>No chapter yet.</b></p>
      <p>Tap <b>+ Import PGN</b> to pick one or more .pgn files: each becomes a chapter, each game in it a line to train. You can also add lines from the explorer.</p>
    </div>

    <section v-for="c in library" :key="c.chapter.id" class="card file">
      <div :class="['frow', { off: c.chapter.disabled || allOff(chapterIds(c)) }]">
        <span :class="['cb', selState(chapterIds(c))]" @click="toggleSel(chapterIds(c))"></span>
        <div class="fmain" @click="toggleOpen(c.chapter.id)">
          <div class="fname"><span class="sidemark" :title="c.chapter.color === 'w' ? 'You play White' : 'You play Black'">{{ c.chapter.color === 'w' ? '♔' : '♚' }}</span> {{ c.chapter.name }}<span v-if="c.chapter.disabled || allOff(chapterIds(c))" class="badge b-off">off</span></div>
          <div class="fmeta">
            {{ c.lines.length }} line{{ c.lines.length === 1 ? '' : 's' }}
            <template v-for="cc in [counts(chapterIds(c))]" :key="0">
              <span v-if="cc.due" class="t-due"> · {{ cc.due }} due</span>
              <span v-if="cc.bad" class="t-bad"> · {{ cc.bad }} missed today</span>
              <span v-if="cc.off" class="muted"> · {{ cc.off }} off</span>
            </template>
          </div>
        </div>
        <label class="switch" :title="c.chapter.disabled ? 'Enable chapter' : 'Disable chapter'">
          <input type="checkbox" :checked="!c.chapter.disabled" @change="setChapterDisabled(c.chapter, !c.chapter.disabled)" />
          <span></span>
        </label>
        <button class="icon dots" @click="menu = { kind: 'chapter', c }" aria-label="Chapter actions">⋯</button>
        <span class="chev" @click="toggleOpen(c.chapter.id)">{{ open.has(c.chapter.id) ? '▾' : '▸' }}</span>
      </div>

      <div v-if="open.has(c.chapter.id)" :class="['lines', { 'chapter-off': c.chapter.disabled }]">
        <div v-if="c.chapter.disabled" class="small muted">Chapter switched off: none of its lines is trained. The lines' own switches are kept for when you turn it back on.</div>
        <div class="lines-tools" v-if="chapterIds(c).length">
          <a href="#" @click.prevent="toggleGameEnabled(chapterIds(c))">{{ anyOn(chapterIds(c)) ? 'Disable all lines' : 'Enable all lines' }}</a>
        </div>
        <div v-for="r in rows(c)" :key="r.id + r.e.stored.title" :class="['lrow', { off: state.disabled[r.id] || c.chapter.disabled, untrainable: !r.trainable }]">
          <span v-if="r.trainable" :class="['cb', sel.has(r.id) ? 'all' : 'none']" @click="toggleSel([r.id])"></span>
          <span v-else class="cb-sp"></span>
          <div class="lmain" @click="r.trainable && toggleSel([r.id])">
            <div class="ltitle">{{ r.e.stored.title }}</div>
            <div class="ltext"><span class="lpre">{{ r.prefix }}</span> {{ r.rest }}</div>
            <div class="lstat" v-if="r.trainable">
              <span v-if="state.disabled[r.id]" class="badge b-off">off</span>
              <span v-else :class="['badge', lineBadge(state.stats[r.id], now).cls]">{{ lineBadge(state.stats[r.id], now).text }}</span>
              <span class="muted">{{ statText(r.id) }}</span>
              <span v-if="gamesOf(r.id)" class="gcount" title="Lichess games that followed this whole line">♟ {{ gamesOf(r.id) }}</span>
            </div>
            <div class="lstat muted" v-else>no move for your side</div>
          </div>
          <label v-if="r.trainable" class="switch" :title="state.disabled[r.id] ? 'Enable line' : 'Disable line'">
            <input type="checkbox" :checked="!state.disabled[r.id]" @change="toggleLine(r.id)" />
            <span></span>
          </label>
          <button class="icon dots" @click="menu = { kind: 'line', c, e: r.e }" aria-label="Line actions">⋯</button>
        </div>
        <div v-if="!c.lines.length" class="small muted">No line yet — import a PGN into this chapter or add lines from the explorer.</div>
      </div>
    </section>
  </div>
</template>
