<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  state, library, allLines, addPgn, removeFile, priority, isToday, lineBadge, relDay, recentErrors, setDisabled, guessColor, setFileColor, setGameColor, conflicts, conflictPosition, type Conflict,
  type LibFile, type LibGame, type Mode,
} from './store';
import { moveTokens, lichessUrl, linesToPgn, type Color, type Line } from './pgn';
import { Chess } from 'chess.js';
import { askConfirm } from './confirm';
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
const enabledIds = (ids: string[]) => ids.filter((id) => !state.disabled[id] && allLines.value.has(id));

/** Trainable ids for a game / file (lines where the user has at least one move). */
function gameIds(g: LibGame): string[] {
  return [...new Set(g.game.lines.map((l) => l.id).filter((id) => allLines.value.has(id)))];
}
function fileIds(f: LibFile): string[] {
  return [...new Set(f.games.flatMap(gameIds))];
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
/* ---------- copy selection as PGN ---------- */
const pgnBox = ref('');
async function copySelPgn() {
  const groups = new Map<string, { color: Color; lines: Line[] }>();
  const sel = new Set(state.selection);
  for (const it of allLines.value.values()) {
    if (!sel.has(it.line.id)) continue;
    const k = it.color + '|' + it.line.startFen;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { color: it.color, lines: [] }));
    g.lines.push(it.line);
  }
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const pgn = [...groups.values()]
    .map((g) => linesToPgn(g.lines, {
      Event: `Selected lines – ${g.color === 'w' ? 'White' : 'Black'}`, Site: 'Chess Line Trainer', Date: date,
      White: '?', Black: '?', Result: '*', Orientation: g.color === 'w' ? 'white' : 'black',
    }))
    .join('\n');
  if (!pgn) return emit('toast', 'Nothing to copy.');
  const n = [...groups.values()].reduce((a, g) => a + g.lines.length, 0);
  try {
    await navigator.clipboard.writeText(pgn);
    emit('toast', `Copied ${n} line(s) as PGN (${groups.size} game${groups.size === 1 ? '' : 's'})`);
  } catch {
    pgnBox.value = pgn; // clipboard blocked: show it for manual copy
  }
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
    if (state.disabled[id]) { off++; continue; }
    const st = state.stats[id];
    if (priority(st, t) > 0) due++;
    if (st && isToday(st.lm, t) && !st.lc) bad++;
  }
  return { due, off, bad };
}

/** Line rows for a game, with the part shared with the previous line greyed out. */
function rows(g: LibGame) {
  const out: { id: string; prefix: string; rest: string; trainable: boolean }[] = [];
  let prev: string[] = [];
  for (const l of g.game.lines) {
    const u = l.moves.map((m) => m.uci);
    let k = 0;
    while (k < u.length && k < prev.length && u[k] === prev[k]) k++;
    if (k === u.length) k = Math.max(0, u.length - 1);
    const tk = moveTokens(l.startFen, l.moves);
    out.push({ id: l.id, prefix: tk.slice(0, k).join(' '), rest: tk.slice(k).join(' '), trainable: allLines.value.has(l.id) });
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

function setColor(g: LibGame, c: Color) {
  setGameColor(g.file, g.index, c);
}

function toggleLine(id: string) {
  setDisabled([id], !state.disabled[id]);
}
/** True when every trainable line in the group is disabled. */
function allOff(ids: string[]) {
  return ids.length > 0 && ids.every((id) => state.disabled[id]);
}
function anyOn(ids: string[]) {
  return ids.some((id) => !state.disabled[id]);
}
function toggleGameEnabled(ids: string[]) {
  setDisabled(ids, anyOn(ids));
}

/* ---------- import ---------- */
const fileInput = ref<HTMLInputElement | null>(null);
const paste = reactive({ show: false, name: '', text: '', color: 'w' as Color | 'auto', mixed: false });
/** Files waiting for the user to choose their side. */
const pending = ref<{ name: string; text: string; color: Color | 'auto'; mixed: boolean; exists: boolean }[]>([]);

async function onFiles(ev: Event) {
  const files = (ev.target as HTMLInputElement).files;
  if (!files) return;
  const list = [];
  for (const f of Array.from(files)) {
    const text = await f.text();
    const name = f.name.replace(/\.pgn$/i, '');
    const g = guessColor(text);
    list.push({ name, text, color: g.color, mixed: g.mixed, exists: state.files.some((x) => x.name === name) });
  }
  (ev.target as HTMLInputElement).value = '';
  pending.value = list;
}
function confirmImport() {
  const msgs = pending.value.map((p) => {
    const r = addPgn(p.name, p.text, p.color);
    return `${p.name}: ${r.games} chapter(s), ${r.lines} line(s) ${p.color === 'w' ? 'as White' : p.color === 'b' ? 'as Black' : 'sides set per chapter'}${r.replaced ? ' (updated, progress kept)' : ''}`;
  });
  pending.value = [];
  now.value = Date.now();
  emit('toast', msgs.join('\n'));
}
function setAllPending(c: Color | 'auto') {
  pending.value.forEach((p) => (p.color = c));
}
function onPasteInput() {
  if (paste.text.length > 20) { const g = guessColor(paste.text); paste.color = g.color; paste.mixed = g.mixed; }
}
function doPaste() {
  if (!paste.text.trim()) return;
  const r = addPgn(paste.name.trim() || `Pasted ${new Date().toLocaleString()}`, paste.text, paste.color);
  emit('toast', `${r.games} chapter(s), ${r.lines} line(s)${r.replaced ? ' (updated, progress kept)' : ''}`);
  paste.show = false; paste.text = ''; paste.name = '';
}
function fileColor(f: LibFile): Color | 'mixed' {
  const cs = new Set(f.games.map((g) => g.color));
  return cs.size === 1 ? [...cs][0] : 'mixed';
}
async function del(f: LibFile) {
  if (await askConfirm(`Remove "${f.file.name}"?`, 'Progress for its lines is kept in case you re-import it.', 'Remove')) {
    const ids = new Set(fileIds(f));
    removeFile(f.file.id);
    state.selection = state.selection.filter((id) => !ids.has(id) || allLines.value.has(id));
  }
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
    return { id, game: it.gameName, file: it.file.name, before: t.slice(0, ply).join(' '), move: t[ply] ?? '', after: t.slice(ply + 1).join(' ') };
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
          <div class="small muted">{{ c.sample.item.gameName }} · as {{ c.color === 'w' ? 'White' : 'Black' }}</div>
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
          <div class="small muted">{{ m.sample.item.gameName }} · as {{ m.color === 'w' ? 'White' : 'Black' }}</div>
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
      <h2>PGN files</h2>
      <div>
        <button class="btn sm" @click="paste.show = !paste.show">Paste</button>
        <button class="btn sm primary" @click="fileInput?.click()">+ Load PGN</button>
        <input ref="fileInput" type="file" multiple hidden @change="onFiles" />
      </div>
    </div>

    <section class="card" v-if="paste.show">
      <input class="inp" v-model="paste.name" placeholder="Name (same name = update existing)" />
      <textarea class="inp" v-model="paste.text" rows="6" placeholder="Paste PGN here…" @change="onPasteInput"></textarea>
      <div class="colorpick">
        Repertoire for
        <button :class="['btn sm', { primary: paste.color === 'w' }]" @click="paste.color = 'w'">♔ White</button>
        <button :class="['btn sm', { primary: paste.color === 'b' }]" @click="paste.color = 'b'">♚ Black</button>
        <button v-if="paste.mixed" :class="['btn sm', { primary: paste.color === 'auto' }]" @click="paste.color = 'auto'">Per chapter</button>
      </div>
      <button class="btn primary wide" @click="doPaste">Add</button>
    </section>

    <div v-if="pgnBox" class="modal-bg" @click.self="pgnBox = ''">
      <div class="modal card">
        <h3>PGN of the selected lines</h3>
        <p class="small muted">Copying wasn't allowed here — tap the text, then copy it.</p>
        <textarea class="inp pgnbox" readonly rows="12" :value="pgnBox" @focus="selectPgnText" @click="selectPgnText"></textarea>
        <button class="btn primary wide" @click="pgnBox = ''">Close</button>
      </div>
    </div>

    <div v-if="pending.length" class="modal-bg">
      <div class="modal card">
        <h3>Import {{ pending.length }} PGN{{ pending.length > 1 ? 's' : '' }}</h3>
        <p class="small muted">Which side is this repertoire for? Pre-set from the file's content. You can still change it per file or chapter later with ♔/♚.</p>
        <div v-if="pending.length > 1" class="colorpick">
          All:
          <button class="btn sm" @click="setAllPending('w')">♔ White</button>
          <button class="btn sm" @click="setAllPending('b')">♚ Black</button>
        </div>
        <div v-for="p in pending" :key="p.name" class="pend">
          <div class="pname">{{ p.name }}<span v-if="p.exists" class="muted small"> · will update existing</span></div>
          <div class="seg">
            <button :class="{ on: p.color === 'w' }" @click="p.color = 'w'">♔ White</button>
            <button :class="{ on: p.color === 'b' }" @click="p.color = 'b'">♚ Black</button>
            <button v-if="p.mixed" :class="{ on: p.color === 'auto' }" @click="p.color = 'auto'" title="Chapters look like a mix of White and Black repertoires">Per chapter</button>
          </div>
        </div>
        <div class="row2">
          <button class="btn wide" @click="pending = []">Cancel</button>
          <button class="btn primary wide" @click="confirmImport">Import</button>
        </div>
      </div>
    </div>

    <div v-if="!library.length" class="empty card">
      <p><b>No PGN loaded yet.</b></p>
      <p>Tap <b>+ Load PGN</b> to pick one or more .pgn files. Every variation becomes a line to train. You'll choose which side the repertoire is for.</p>
    </div>

    <section v-for="f in library" :key="f.file.id" class="card file">
      <div :class="['frow', { off: allOff(fileIds(f)) }]">
        <span :class="['cb', selState(fileIds(f))]" @click="toggleSel(fileIds(f))"></span>
        <div class="fmain" @click="toggleOpen(f.file.id)">
          <div class="fname">{{ f.file.name }}<span v-if="allOff(fileIds(f))" class="badge b-off">off</span></div>
          <div class="fmeta">
            {{ f.games.length }} chapter{{ f.games.length === 1 ? '' : 's' }} · {{ fileIds(f).length }} lines
            <template v-for="c in [counts(fileIds(f))]" :key="0">
              <span v-if="c.due" class="t-due"> · {{ c.due }} due</span>
              <span v-if="c.bad" class="t-bad"> · {{ c.bad }} missed today</span>
              <span v-if="c.off" class="muted"> · {{ c.off }} off</span>
            </template>
          </div>
        </div>
        <div class="side">
          <button :class="['sideb', { on: fileColor(f) === 'w', mixed: fileColor(f) === 'mixed' }]" @click="setFileColor(f.file, 'w')" title="Whole file as White">♔</button>
          <button :class="['sideb', { on: fileColor(f) === 'b', mixed: fileColor(f) === 'mixed' }]" @click="setFileColor(f.file, 'b')" title="Whole file as Black">♚</button>
        </div>
        <span class="chev" @click="toggleOpen(f.file.id)">{{ open.has(f.file.id) ? '▾' : '▸' }}</span>
      </div>

      <div v-if="open.has(f.file.id)" class="games">
        <div v-if="f.errors.length" class="warn small">⚠ {{ f.errors.length }} move(s) skipped: {{ f.errors.slice(0, 3).join('; ') }}{{ f.errors.length > 3 ? '…' : '' }}</div>
        <div v-for="g in f.games" :key="g.index" class="game">
          <div :class="['grow', { off: allOff(gameIds(g)) }]">
            <span :class="['cb', selState(gameIds(g))]" @click="toggleSel(gameIds(g))"></span>
            <div class="gmain" @click="toggleOpen(f.file.id + ':' + g.index)">
              <div class="gname">{{ g.game.name }}<span v-if="allOff(gameIds(g))" class="badge b-off">off</span></div>
              <div class="fmeta">
                {{ gameIds(g).length }} lines
                <template v-for="c in [counts(gameIds(g))]" :key="0">
                  <span v-if="c.due" class="t-due"> · {{ c.due }} due</span>
                  <span v-if="c.bad" class="t-bad"> · {{ c.bad }} missed today</span>
                  <span v-if="c.off" class="muted"> · {{ c.off }} off</span>
                </template>
              </div>
            </div>
            <div class="side">
              <button :class="['sideb', { on: g.color === 'w' }]" @click="setColor(g, 'w')" title="Train as White">♔</button>
              <button :class="['sideb', { on: g.color === 'b' }]" @click="setColor(g, 'b')" title="Train as Black">♚</button>
            </div>
            <span class="chev" @click="toggleOpen(f.file.id + ':' + g.index)">{{ open.has(f.file.id + ':' + g.index) ? '▾' : '▸' }}</span>
          </div>

          <div v-if="open.has(f.file.id + ':' + g.index)" class="lines">
            <div class="lines-tools">
              <a href="#" @click.prevent="toggleGameEnabled(gameIds(g))">
                {{ anyOn(gameIds(g)) ? 'Disable all lines' : 'Enable all lines' }}
              </a>
            </div>
            <div v-for="r in rows(g)" :key="r.id + r.rest" :class="['lrow', { off: state.disabled[r.id], untrainable: !r.trainable }]">
              <span v-if="r.trainable" :class="['cb', sel.has(r.id) ? 'all' : 'none']" @click="toggleSel([r.id])"></span>
              <span v-else class="cb-sp"></span>
              <div class="lmain" @click="r.trainable && toggleSel([r.id])">
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
            </div>
          </div>
        </div>
        <div class="file-actions">
          <button class="btn sm" @click="toggleSel(fileIds(f))">{{ selState(fileIds(f)) === 'all' ? 'Unselect file' : 'Select file' }}</button>
          <button class="btn sm danger" @click="del(f)">Remove file</button>
        </div>
      </div>
    </section>
  </div>
</template>
