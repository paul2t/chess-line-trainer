<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Color } from './pgn';
import { state } from './store';
import { lichess } from './lichess';
import { fetchStudy, myStudies, parseStudyId, planSync, applySync, planSummary, studySide, includeSide, type Study } from './study';

const props = defineProps<{ bookId?: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'done', bookId: string, msg: string): void }>();

const input = ref('');
const busy = ref(false);
const error = ref('');
const study = ref<Study | null>(null);
const mine = ref<{ id: string; name: string; updatedAt: number }[] | null>(null);
/** 'new' or a book id */
const target = ref(props.bookId ?? 'new');
const bookName = ref('');
/** Side of the book (fixed by the target book when importing into one). */
const side = ref<Color>(state.books.find((b) => b.id === props.bookId)?.color ?? state.settings.libraryTab);
const targetBook = computed(() => (target.value === 'new' ? null : state.books.find((b) => b.id === target.value) ?? null));
watch(targetBook, (b) => { if (b) side.value = b.color; });
watch(side, (c) => { if (study.value) includeSide(study.value, c); });
const hasOther = computed(() => !!study.value?.chapters.some((c) => c.orientation !== side.value));
const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');

async function load(id?: string) {
  error.value = '';
  const sid = id ?? parseStudyId(input.value);
  if (!sid) { error.value = 'Paste a study link (lichess.org/study/…) or its 8-character id.'; return; }
  busy.value = true;
  try {
    study.value = await fetchStudy(sid);
    bookName.value = study.value.name;
    if (!targetBook.value) side.value = studySide(study.value);
    includeSide(study.value, side.value);
    mine.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function loadMine() {
  error.value = '';
  busy.value = true;
  try { mine.value = await myStudies(); } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}

const included = computed(() => study.value?.chapters.filter((c) => c.include) ?? []);
const alreadyLinked = computed(() => !!study.value && state.chapters.some((c) => c.src?.study === study.value!.id));

function doImport() {
  if (!study.value || !included.value.length) return;
  const book = targetBook.value;
  const plan = planSync(study.value, book, side.value);
  const b = applySync(plan);
  if (!book && bookName.value.trim() && bookName.value.trim() !== b.name) b.name = bookName.value.trim();
  emit('done', b.id, `“${b.name}”: ${planSummary(plan)}`);
}
const day = (t: number) => (t ? new Date(t).toLocaleDateString() : '');
</script>

<template>
  <div class="modal-bg" @click.self="emit('close')">
    <div class="modal card study-import">
      <h3>Import a lichess study</h3>
      <template v-if="!study">
        <p class="small muted">Each chapter of the study becomes a chapter (you play the side of its board orientation), each variation a line. The book keeps the link to the study so you can sync it again after editing it on lichess.</p>
        <input class="inp" v-model="input" placeholder="https://lichess.org/study/…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" @keydown.enter="load()" />
        <div class="row2">
          <button class="btn primary wide" :disabled="busy" @click="load()">{{ busy ? 'Loading…' : 'Load study' }}</button>
          <button v-if="lichess.token" class="btn wide" :disabled="busy" @click="loadMine">My studies</button>
        </div>
        <p v-if="!lichess.token" class="small muted">Public studies work without logging in. For your private or unlisted studies, log in to lichess in Settings.</p>
        <div v-if="mine" class="study-list">
          <p v-if="!mine.length" class="small muted">No study found on your account.</p>
          <button v-for="s in mine" :key="s.id" class="btn wide" @click="load(s.id)">{{ s.name }} <span class="muted small">· {{ day(s.updatedAt) }}</span></button>
        </div>
      </template>
      <template v-else>
        <div class="small muted">Study</div>
        <div class="study-name"><b>{{ study.name }}</b> <a :href="`https://lichess.org/study/${study.id}`" target="_blank" rel="noopener" class="small">open ↗</a></div>
        <p v-if="alreadyLinked" class="small warn">Part of this study is already in your library: those chapters stay where they are, only the others are imported here.</p>
        <label class="pick-label">Into</label>
        <select class="inp" v-model="target">
          <option value="new">➕ New book</option>
          <option v-for="b in state.books" :key="b.id" :value="b.id">{{ b.color === 'w' ? '♔' : '♚' }} {{ b.name }}</option>
        </select>
        <template v-if="target === 'new'">
          <input class="inp" v-model="bookName" placeholder="Book name" />
          <div class="seg">
            <button :class="{ on: side === 'w' }" @click="side = 'w'">♔ I play White</button>
            <button :class="{ on: side === 'b' }" @click="side = 'b'">♚ I play Black</button>
          </div>
        </template>
        <p v-else class="small muted">You play {{ sideName(side) }} in this book.</p>
        <label class="pick-label">Chapters <span class="muted">({{ included.length }} of {{ study.chapters.length }})</span></label>
        <div v-for="c in study.chapters" :key="c.id" :class="['schap', { off: !c.include }]">
          <span :class="['cb', c.include ? 'all' : 'none']" @click="c.include = !c.include"></span>
          <div class="schap-main" @click="c.include = !c.include">
            <div>{{ c.name }}</div>
            <div class="small muted">{{ c.lines.length }} line{{ c.lines.length === 1 ? '' : 's' }}<span v-if="c.orientation !== side"> · board oriented for {{ sideName(c.orientation) }}</span></div>
          </div>
        </div>
        <p v-if="hasOther" class="small muted">Chapters for the other side are left out: import the study again as a {{ sideName(side === 'w' ? 'b' : 'w') }} book to train them too — each book syncs its own chapters.</p>
        <p v-if="error" class="small warn">{{ error }}</p>
        <div class="row2">
          <button class="btn wide" @click="study = null">‹ Back</button>
          <button class="btn primary wide" :disabled="!included.length" @click="doImport">Import {{ included.length }} chapter{{ included.length === 1 ? '' : 's' }}</button>
        </div>
      </template>
      <p v-if="error && !study" class="small warn">{{ error }}</p>
      <button class="btn wide" @click="emit('close')">Cancel</button>
    </div>
  </div>
</template>
