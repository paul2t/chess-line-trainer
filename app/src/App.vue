<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import Library from './Library.vue';
import Trainer from './Trainer.vue';
import PositionSearch from './PositionSearch.vue';
import { state, allLines, isOff, recordAttempt, exportBackup, importBackup, storageError, type Mode } from './store';
import { cloud, saveFile, flush } from './cloud';
import { confirmState, answerConfirm, askConfirm } from './confirm';
import { playSound } from './sound';
import { lichess, login, logout, setToken, refreshAll, initLichess, sandboxed, popularity, RATINGS, SPEEDS, SPEED_LABEL } from './lichess';
import { formatMoves } from './pgn';
import { BOARDS } from './assets/boards';
import { PIECE_SETS } from './assets/pieces';

type View = 'library' | 'train' | 'summary' | 'settings' | 'search';
const view = ref<View>('library');
const lib = ref<InstanceType<typeof Library> | null>(null);

const MODE_LABEL: Record<Mode, string> = { smart: 'Smart review', today: "Today's mistakes", all: 'In order', random: 'Shuffle', position: 'Position' };

const session = reactive({
  active: false,
  mode: 'smart' as Mode,
  queue: [] as string[],
  current: '',
  key: 0,
  results: [] as { id: string; mistake: boolean; count: number }[],
  /** Finished attempts of this session, in order (for "previous line"). */
  completed: [] as { id: string; errorPlies: number[] }[],
  recorded: false,
  /** Per line: ply to start from (position search). */
  startPlies: {} as Record<string, number>,
  /** When showing a previous line again: its mistakes and index in `completed`. */
  review: null as number[] | null,
  reviewIdx: -1,
  /** Current attempt is a redo: practice only, a clean run doesn't clear the failure. */
  redo: false,
  /** Where the session was started from: we go back there at the end. */
  origin: 'library' as 'library' | 'search',
});

const trainer = ref<InstanceType<typeof Trainer> | null>(null);
const currentItem = computed(() => allLines.value.get(session.current));
const repeatCount = computed(() => session.queue.filter((id) => session.results.some((r) => r.id === id && r.mistake)).length);
const progress = computed(() => {
  if (session.review) return `Previous line (${session.reviewIdx + 1}/${session.completed.length})`;
  const left = session.queue.length;
  const n = session.completed.length + (session.recorded ? 0 : 1);
  const retry = session.results.slice(0, session.recorded ? -1 : undefined).some((r) => r.id === session.current && r.mistake);
  const tag = session.redo ? ' (redo)' : retry ? ' (retry)' : '';
  return `Line ${n}${tag} · ${left} left` + (repeatCount.value ? ` · ${repeatCount.value} to repeat` : '');
});
const canPrev = computed(() =>
  session.review ? session.reviewIdx > 0 : session.completed.length >= (session.recorded ? 2 : 1),
);

/** Show a line: a fresh attempt, or (review) a finished one again. */
function show(id: string, review: number[] | null = null, reviewIdx = -1, redo = false) {
  session.current = id;
  session.redo = redo;
  session.review = review;
  session.reviewIdx = reviewIdx;
  session.recorded = review !== null;
  session.key++;
  view.value = 'train';
}

function start(mode: Mode, ids: string[], startPlies: Record<string, number> = {}, origin: 'library' | 'search' = 'library') {
  session.active = true;
  session.origin = origin;
  session.mode = mode;
  session.startPlies = startPlies;
  session.queue = [...new Set(ids)];
  session.results = [];
  session.completed = [];
  next();
}

function next() {
  let id: string | undefined;
  while ((id = session.queue.shift()) && !allLines.value.has(id));
  if (!id) {
    session.active = false;
    view.value = 'summary';
    return;
  }
  show(id);
}

function onDone(errorPlies: number[]) {
  if (session.recorded) return;
  session.recorded = true;
  const id = session.current;
  const mistake = errorPlies.length > 0;
  if (session.redo) {
    // Practice: a clean redo leaves the earlier failure (and its repeat) in place; new mistakes still count.
    if (mistake) {
      recordAttempt(id, errorPlies);
      session.results.push({ id, mistake, count: errorPlies.length });
    }
    session.completed.push({ id, errorPlies });
    return;
  }
  const it = allLines.value.get(id);
  recordAttempt(id, errorPlies, it ? popularity(it) : 0);
  session.results.push({ id, mistake, count: errorPlies.length });
  session.completed.push({ id, errorPlies });
  const repeats = session.mode === 'today' || session.mode === 'position' || state.settings.repeatFailed;
  if (repeats) {
    const i = session.queue.indexOf(id);
    if (mistake && i < 0) session.queue.push(id);
  }
}

/** Go back to the previous finished line (the current unfinished one is kept for later). */
function prev() {
  let idx: number;
  if (session.review) idx = session.reviewIdx - 1;
  else {
    if (!session.recorded) session.queue.unshift(session.current);
    idx = session.completed.length - (session.recorded ? 2 : 1);
  }
  if (idx < 0) return;
  const c = session.completed[idx];
  show(c.id, c.errorPlies, idx);
}

function redo() {
  show(session.current, null, -1, true);
}

function skip() {
  next();
}

function quit() {
  session.active = false;
  if (session.results.length) view.value = 'summary';
  else endSession();
}

/** Leave the summary: back to the screen the session was started from. */
function endSession() {
  if (session.origin === 'search') openSearch();
  else backToLibrary();
}

type SearchInit = { fen: string; moves: string[]; cursor?: number; color?: 'w' | 'b' };
const searchInit = ref<SearchInit | undefined>();
const searchFromTraining = ref(false);
function openSearch(init?: SearchInit, fromTraining = false) {
  searchInit.value = init;
  searchFromTraining.value = fromTraining;
  view.value = 'search';
  window.scrollTo(0, 0);
}
function closeSearch() {
  if (searchFromTraining.value && session.active) {
    view.value = 'train';
    nextTick(() => trainer.value?.redraw());
  } else backToLibrary();
}

function backToLibrary() {
  session.active = false;
  view.value = 'library';
  window.setTimeout(() => lib.value?.refresh());
}

const summary = computed(() => {
  const byId = new Map<string, { tries: number; firstClean: boolean; fixed: boolean }>();
  for (const r of session.results) {
    const e = byId.get(r.id);
    if (!e) byId.set(r.id, { tries: 1, firstClean: !r.mistake, fixed: !r.mistake });
    else { e.tries++; e.fixed = !r.mistake; }
  }
  const arr = [...byId.entries()];
  return {
    lines: arr.length,
    attempts: session.results.length,
    mistakes: session.results.reduce((a, r) => a + r.count, 0),
    firstClean: arr.filter(([, v]) => v.firstClean).length,
    missed: arr.filter(([, v]) => !v.firstClean).map(([id, v]) => {
      const it = allLines.value.get(id);
      return { id, v, name: it ? `${it.chapter.name} · ${it.title}` : '', text: it ? formatMoves(it.line.startFen, it.line.moves) : id };
    }),
  };
});

function drillToday() {
  const ids = [...allLines.value.keys()].filter((id) => !isOff(id) && state.stats[id]?.lm && new Date(state.stats[id].lm).toDateString() === new Date().toDateString());
  if (ids.length) start('today', ids, {}, session.origin);
}

/* ---------- toast ---------- */
const toastMsg = ref('');
let toastT = 0;
function toast(msg: string) {
  toastMsg.value = msg;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => (toastMsg.value = ''), 3500);
}

/* ---------- settings ---------- */
const importInput = ref<HTMLInputElement | null>(null);
async function doExport() {
  await flush();
  toast(await saveFile(`chess-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup()));
}
async function doImport(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { toast(importBackup(await f.text())); } catch (e) { toast('Import failed: ' + (e as Error).message); }
  (ev.target as HTMLInputElement).value = '';
}
async function resetProgress() {
  if (await askConfirm('Erase all training progress?', 'PGN files are kept. This cannot be undone.', 'Erase')) {
    for (const k of Object.keys(state.stats)) delete state.stats[k];
    toast('Progress erased');
  }
}
const cloudLabel = computed(() => ({
  local: '', connecting: 'connecting…', synced: '☁ saved', saving: '☁ saving…', error: '⚠ not saved', signedout: 'local only',
})[cloud.status]);
const previewBoard = computed(() => (BOARDS.find((b) => b.id === state.settings.theme) ?? BOARDS[0]).img);
const previewPieces = computed(() => (PIECE_SETS[state.settings.pieceSet] ?? PIECE_SETS.cburnett).pieces);
const pieceSets = Object.entries(PIECE_SETS).map(([id, v]) => ({ id, name: v.name, preview: [v.pieces.wN, v.pieces.bK] }));
function testSound() {
  playSound('move');
}
/* ---------- lichess settings ---------- */
const tokenInput = ref('');
const inSandbox = ref(sandboxed());
onMounted(() => setTimeout(() => (inSandbox.value = sandboxed()), 4500)); // the claude.ai runtime appears a bit later
function toggleIn(list: string[], v: string) {
  const i = list.indexOf(v);
  if (i >= 0) { if (list.length > 1) list.splice(i, 1); } else list.push(v);
}
const lichessStatus = computed(() => {
  if (inSandbox) return 'Not available on this claude.ai page (it cannot contact lichess). Use the GitHub Pages version.';
  if (!lichess.token) return 'Log in to download how often each move is played on lichess.';
  const pct = lichess.total ? Math.round((lichess.done / lichess.total) * 100) : 0;
  const left = lichess.total - lichess.done;
  if (lichess.status === 'done') return `✓ Up to date — ${lichess.total} positions (refreshed monthly).`;
  if (lichess.status === 'error') return '⚠ ' + lichess.message;
  return `${lichess.status === 'paused' ? 'Paused (app in background)' : 'Downloading'}: ${lichess.done}/${lichess.total} positions (${pct}%) · about ${Math.ceil((left * 3.3) / 60)} min left` + (lichess.message ? ' — ' + lichess.message : '');
});
onMounted(() => initLichess(toast));

const storageKb = computed(() => {
  void state.stats; void state.chapters;
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; n += (localStorage.getItem(k) || '').length + k.length; } } catch { /* ignore */ }
  return Math.round((n * 2) / 1024);
});
</script>

<template>
  <div class="app">
    <header v-if="view !== 'train' && view !== 'search'" class="top">
      <h1 @click="backToLibrary">♞ Line Trainer</h1>
      <span v-if="cloudLabel" :class="['cloud', 'c-' + cloud.status]" :title="cloud.message">{{ cloudLabel }}</span>
      <button class="icon" @click="view = view === 'settings' ? 'library' : 'settings'" aria-label="Settings">{{ view === 'settings' ? '✕' : '⚙' }}</button>
    </header>

    <div v-if="storageError" class="warn banner">{{ storageError }}</div>

    <Library v-show="view === 'library'" ref="lib" @start="start" @toast="toast" @search="openSearch" />

    <PositionSearch
      v-if="view === 'search'"
      :init="searchInit"
      :from-training="searchFromTraining"
      @close="closeSearch"
      @toast="toast"
      @train="(ids, plies) => start('position', ids, plies, 'search')"
    />

    <!-- Kept mounted (hidden) while exploring, so training resumes exactly where it was. -->
    <Trainer
      v-if="session.active && currentItem && (view === 'train' || view === 'search')"
      v-show="view === 'train'"
      ref="trainer"
      :key="session.key"
      :item="currentItem"
      :delay="state.settings.opponentDelay"
      :auto-next="state.settings.autoNext"
      :progress="progress"
      :mode-label="MODE_LABEL[session.mode]"
      :start-ply="session.review ? 0 : session.startPlies[session.current] ?? 0"
      :review="session.review"
      :can-prev="canPrev"
      :practice="session.redo"
      @done="onDone"
      @next="next()"
      @skip="skip"
      @quit="quit"
      @prev="prev"
      @redo="redo"
      @explore="(init) => openSearch(init, true)"
    />

    <div v-if="view === 'summary'" class="summary">
      <section class="card">
        <h2>Session done</h2>
        <div class="kpis">
          <div><b>{{ summary.lines }}</b><span>lines</span></div>
          <div><b>{{ summary.firstClean }}</b><span>clean 1st try</span></div>
          <div><b>{{ summary.missed.length }}</b><span>lines missed</span></div>
          <div><b>{{ summary.mistakes }}</b><span>mistakes</span></div>
        </div>
      </section>
      <section class="card" v-if="summary.missed.length">
        <h3>Lines you missed</h3>
        <div v-for="m in summary.missed" :key="m.id" class="mline">
          <div class="small muted">{{ m.name }} · {{ m.v.tries }} {{ m.v.tries === 1 ? 'try' : 'tries' }} {{ m.v.fixed ? '· fixed ✓' : '· not fixed' }}</div>
          <div class="ltext">{{ m.text }}</div>
        </div>
      </section>
      <button class="btn danger big wide" v-if="summary.missed.length" @click="drillToday">Drill today's mistakes again</button>
      <button class="btn primary big wide" @click="endSession">{{ session.origin === 'search' ? 'Back to search' : 'Back to library' }}</button>
    </div>

    <div v-if="view === 'settings'" class="settings">
      <section class="card">
        <h3>Training</h3>
        <label class="set">Smart review size <input class="inp num" type="number" min="1" max="200" v-model.number="state.settings.sessionSize" /></label>
        <label class="set">Repeat failed lines until correct <input type="checkbox" v-model="state.settings.repeatFailed" /></label>
        <label class="set">Auto-advance after a clean line <input type="checkbox" v-model="state.settings.autoNext" /></label>
        <label class="set col">Opponent move delay: {{ state.settings.opponentDelay }} ms
          <input type="range" min="0" max="1500" step="50" v-model.number="state.settings.opponentDelay" />
        </label>
      </section>
      <section class="card">
        <h3>Board</h3>
        <div class="preview-row">
          <div class="mini-board" :style="{ backgroundImage: `url(${previewBoard})` }">
            <img v-for="p in ['bR', 'bN', 'bB', 'bQ', 'wK', 'wB', 'wN', 'wP']" :key="p" :src="previewPieces[p]" alt="" />
          </div>
        </div>
        <div class="pick-label">Board colour</div>
        <div class="themes">
          <button v-for="b in BOARDS" :key="b.id" :class="['theme-pick', { on: state.settings.theme === b.id }]" @click="state.settings.theme = b.id">
            <span class="swatch" :style="{ backgroundImage: `url(${b.thumb})` }"></span>{{ b.name }}
          </button>
        </div>
        <div class="pick-label">Pieces</div>
        <div class="themes">
          <button v-for="p in pieceSets" :key="p.id" :class="['theme-pick', { on: state.settings.pieceSet === p.id }]" @click="state.settings.pieceSet = p.id">
            <span class="swatch pieces-swatch"><img :src="p.preview[0]" alt="" /><img :src="p.preview[1]" alt="" /></span>{{ p.name }}
          </button>
        </div>
        <label class="set">Move sounds <input type="checkbox" v-model="state.settings.sound" /></label>
        <label class="set col" v-if="state.settings.sound">Volume
          <input type="range" min="0.05" max="1" step="0.05" v-model.number="state.settings.volume" @change="testSound" />
        </label>
      </section>
      <section class="card">
        <h3>Lichess statistics</h3>
        <p class="small muted">How often each move of your lines is played on lichess: shown in the explorer, used to review the most played lines first, and to spot common replies missing from your lines.</p>
        <p class="small">{{ lichessStatus }}</p>
        <template v-if="!inSandbox">
          <div v-if="lichess.token" class="row2">
            <span class="small flex1">Logged in{{ lichess.user ? ' as ' + lichess.user : '' }}</span>
            <button class="btn sm" @click="refreshAll">Refresh now</button>
            <button class="btn sm" @click="logout">Log out</button>
          </div>
          <template v-else>
            <button class="btn primary wide" @click="login">Log in with lichess</button>
            <p class="small muted" v-if="lichess.message">{{ lichess.message }}</p>
            <details class="small">
              <summary class="muted">or paste a token</summary>
              <p class="muted">Create one at lichess.org/account/oauth/token without ticking any permission, then paste it here.</p>
              <div class="pinput"><input class="inp" v-model="tokenInput" placeholder="lip_…" autocomplete="off" /><button class="btn sm primary" @click="setToken(tokenInput); tokenInput = ''">Save</button></div>
            </details>
          </template>
          <div class="pick-label">Opponent levels</div>
          <div class="chips">
            <button v-for="r in RATINGS" :key="r" :class="['chip', { on: state.settings.lichessRatings.includes(r) }]" @click="toggleIn(state.settings.lichessRatings, r)">{{ r }}+</button>
          </div>
          <div class="pick-label">Time controls</div>
          <div class="chips">
            <button v-for="sp in SPEEDS" :key="sp" :class="['chip', { on: state.settings.lichessSpeeds.includes(sp) }]" @click="toggleIn(state.settings.lichessSpeeds, sp)">{{ SPEED_LABEL[sp] }}</button>
          </div>
          <label class="set col">Flag missing replies played at least {{ state.settings.missingThreshold }}% of the time
            <input type="range" min="3" max="40" step="1" v-model.number="state.settings.missingThreshold" />
          </label>
        </template>
      </section>
      <section class="card">
        <h3>Storage &amp; backup</h3>
        <p class="small" v-if="cloud.status === 'synced' || cloud.status === 'saving'">☁ Your PGNs and progress are saved to your Claude account, so they survive updates of this page and are the same on all your devices.</p>
        <p class="small warn" v-else-if="cloud.status === 'error'">⚠ Cloud save failed: {{ cloud.message }}. Your data is still kept in this browser.</p>
        <p class="small muted" v-else>Everything is stored in this browser only ({{ storageKb }} KB). Opening another copy of the file, or clearing browser data, starts empty — export a backup now and then.</p>
        <p class="small muted">To move progress from another copy of the app: open the other copy → Export backup, then Import backup here.</p>
        <div class="row2">
          <button class="btn wide" @click="doExport">Export backup</button>
          <button class="btn wide" @click="importInput?.click()">Import backup</button>
        </div>
        <input ref="importInput" type="file" hidden @change="doImport" />
        <button class="btn danger wide" style="margin-top:8px" @click="resetProgress">Reset all progress</button>
      </section>
      <section class="card small">
        <h3>How it works</h3>
        <p>Each variation in a PGN is a <b>line</b> (start → end of variation). The opponent's moves are played for you; you play your side.</p>
        <p><b>Smart review</b> picks the lines with the most recent mistakes first (a mistake counts less as it gets older, halving every week), then lines that are due — those you often get wrong, and those most played on lichess, first. A mistake makes a line due again and lowers its “ease”; a clean run multiplies its interval by that ease (about ×1.3 for lines you often miss, up to ×2.6 for easy ones), so difficult lines come back much more often. Lines played a lot on lichess grow their interval a little more slowly.</p>
        <p><b>Drill today's mistakes</b> replays every line you missed today, putting a line back in the queue each time you miss it, until you get them all right.</p>
        <p>A hint or “show move” counts as a mistake. Playing a move that belongs to another line of the PGN doesn't — you just get to try again.</p>
        <p>Select files, chapters or individual lines to restrict training to them. Use the switch on a line, or <i>Disable</i> on a selection, to exclude lines entirely.</p>
        <p>Re-loading a PGN with the same file name updates it; progress is kept for lines whose moves didn't change.</p>
      </section>
    </div>

    <div v-if="toastMsg" class="toast" @click="toastMsg = ''">{{ toastMsg }}</div>

    <div v-if="confirmState.open" class="modal-bg" @click.self="answerConfirm(false)">
      <div class="modal card">
        <h3>{{ confirmState.title }}</h3>
        <p class="small muted" v-if="confirmState.body">{{ confirmState.body }}</p>
        <input v-if="confirmState.input !== null" class="inp" v-model="confirmState.input" @keydown.enter="answerConfirm(true)" autofocus />
        <div class="row2">
          <button class="btn wide" @click="answerConfirm(false)">Cancel</button>
          <button :class="['btn wide', confirmState.input !== null ? 'primary' : 'danger']" @click="answerConfirm(true)">{{ confirmState.ok }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
