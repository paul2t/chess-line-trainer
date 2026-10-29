/**
 * Cloud sync for the hosted (claude.ai) version of the page.
 *
 * When the page runs as a published artifact, progress is stored server-side in the viewer's
 * private `data/users/<id>/` space, so it survives page updates, cleared browser data and works
 * across devices. When the page is opened as a local file, `window.claude` doesn't exist and the
 * app falls back to localStorage only.
 *
 * Documents (all in collection data/users/<id>):
 *   meta            settings, selection, disabled lines, file tombstones
 *   s_<c>           line stats, sharded by the first character of the line id
 *   h_<chapterId>       chapter metadata
 *   l_<chapterId>_<n>   the chapter's lines as JSON, in chunks (documents are capped at 256 KiB)
 *   f_/c_<fileId>       old format (PGN files, v1): never written or deleted any more, only read to
 *                       migrate a chapter that has no h_ document yet — they stay as a backup.
 */
import { reactive, watch } from 'vue';
import { state, applying, migrateFile, type LineStat, type PgnFile, type Settings, type Chapter, type StoredLine } from './store';

export type CloudStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'error' | 'signedout';
export const cloud = reactive({ status: 'local' as CloudStatus, message: '', canDownload: false });

/* Minimal typings for the platform runtime (see the artifact runtime contract). */
interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }
interface ColRef { doc(id: string): DocRef; get(): Promise<{ docs: DocSnap[] }> }
interface DbNs { collection(path: string): ColRef }
interface UserNs { id(): Promise<string | null> }
interface DownloadsNs { save(r: { filename: string; data: string | Blob }): Promise<unknown> }
interface Runtime { use(name: string): Promise<unknown> }

const CHUNK = 60000; // characters; ≤ 180 KB of UTF-8 even in the worst case

let col: ColRef | null = null;
let downloads: DownloadsNs | null = null;
/** JSON of each document as last read from / written to the server. */
const written = new Map<string, string>();

async function runtime(timeoutMs = 4000): Promise<Runtime | null> {
  const t0 = Date.now();
  for (;;) {
    const c = (window as unknown as { claude?: Runtime }).claude;
    if (c && typeof c.use === 'function') return c;
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const shardOf = (lineId: string) => 's_' + (/^[0-9a-z]/.test(lineId) ? lineId[0] : '_');

function buildDocs(): Map<string, Record<string, unknown>> {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set('meta', {
    settings: state.settings, selection: state.selection, disabled: state.disabled,
    deletedFiles: state.deletedChapters, updated: state.metaUpdated,
  });
  const shards: Record<string, Record<string, LineStat>> = {};
  for (const [id, st] of Object.entries(state.stats)) (shards[shardOf(id)] ??= {})[id] = st;
  // Shards that existed before but are now empty (progress reset) must be cleared, not left behind.
  for (const k of written.keys()) if (k.startsWith('s_') && !shards[k]) shards[k] = {};
  for (const [k, v] of Object.entries(shards)) docs.set(k, { stats: v });
  for (const c of state.chapters) {
    const text = JSON.stringify(c.lines);
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    docs.set('h_' + c.id, { id: c.id, name: c.name, color: c.color, added: c.added, updated: c.updated, chunks: n });
    for (let i = 0; i < n; i++) docs.set(`l_${c.id}_${i}`, { t: text.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  return docs;
}

/** Chapter id of a h_/l_ document (old f_/c_ documents are never touched). */
function chapterIdOf(docId: string): string | null {
  const m = docId.match(/^[hl]_([^_]+)/);
  return m ? m[1] : null;
}

/** Chapter from its h_ + l_ documents, or migrated from an old f_ + c_ PGN file. */
function remoteChapter(remote: Map<string, Record<string, unknown>>, id: string): Chapter | null {
  const h = remote.get('h_' + id) as (Omit<Chapter, 'lines'> & { chunks: number }) | undefined;
  if (h) {
    const text = Array.from({ length: h.chunks }, (_, i) => (remote.get(`l_${id}_${i}`)?.t as string) ?? '').join('');
    try {
      return { id, name: h.name, color: h.color, added: h.added, updated: h.updated, lines: JSON.parse(text) as StoredLine[] };
    } catch {
      return null;
    }
  }
  const f = remote.get('f_' + id) as (Omit<PgnFile, 'text'> & { chunks: number; color: PgnFile['color'] | null }) | undefined;
  if (!f) return null;
  const text = Array.from({ length: f.chunks }, (_, i) => (remote.get(`c_${id}_${i}`)?.t as string) ?? '').join('');
  return migrateFile({ id, name: f.name, text, added: f.added, updated: f.updated ?? f.added, color: f.color ?? undefined, colors: f.colors ?? {} });
}

async function pull() {
  const snap = await col!.get();
  const remote = new Map<string, Record<string, unknown>>();
  for (const d of snap.docs) if (d.exists) remote.set(d.id, d.data()!);
  for (const [k, v] of remote) written.set(k, JSON.stringify(v));

  applying.remote = true;
  try {
    // --- meta
    const m = remote.get('meta') as
      | { settings?: Partial<Settings>; selection?: string[]; disabled?: Record<string, true>; deletedFiles?: Record<string, number>; updated?: number }
      | undefined;
    if (m) {
      for (const [id, t] of Object.entries(m.deletedFiles ?? {})) if ((state.deletedChapters[id] ?? 0) < t) state.deletedChapters[id] = t;
      if ((m.updated ?? 0) > state.metaUpdated) {
        if (m.settings) Object.assign(state.settings, m.settings);
        if (m.selection) state.selection = [...m.selection];
        if (m.disabled) {
          for (const k of Object.keys(state.disabled)) delete state.disabled[k];
          Object.assign(state.disabled, m.disabled);
        }
        state.metaUpdated = m.updated ?? 0;
      }
    }

    // --- chapters (new h_ documents, or old f_ PGN files migrated on the fly)
    const ids = new Set<string>();
    for (const k of remote.keys()) { const m2 = k.match(/^[hf]_(.+)$/); if (m2) ids.add(m2[1]); }
    for (const id of ids) {
      const rc = remoteChapter(remote, id);
      if (!rc) continue;
      if ((state.deletedChapters[id] ?? 0) >= rc.updated) continue;
      const byId = state.chapters.find((c) => c.id === id);
      if (byId) {
        if (rc.updated > byId.updated) Object.assign(byId, rc);
        continue;
      }
      // Same chapter created separately on two devices: keep the newer copy.
      const byName = state.chapters.find((c) => c.name === rc.name);
      if (byName) {
        if (rc.updated > byName.updated) {
          state.deletedChapters[byName.id] = Date.now();
          Object.assign(byName, rc);
        } else {
          state.deletedChapters[rc.id] = Date.now();
        }
        continue;
      }
      state.chapters.push(rc);
    }
    // chapters deleted on another device
    const keep = state.chapters.filter((c) => (state.deletedChapters[c.id] ?? 0) < c.updated);
    if (keep.length !== state.chapters.length) state.chapters = keep;

    // --- stats: per line, the most recent review wins
    for (const [k, v] of remote) {
      if (!k.startsWith('s_')) continue;
      for (const [id, st] of Object.entries((v.stats ?? {}) as Record<string, LineStat>)) {
        const cur = state.stats[id];
        if (!cur || st.lr > cur.lr || (st.lr === cur.lr && st.a > cur.a)) state.stats[id] = st;
      }
    }
  } finally {
    applying.remote = false;
  }
}

let timer = 0;
let flushing = false;
let again = false;

function schedule(ms = 1500) {
  if (!col) return;
  clearTimeout(timer);
  timer = window.setTimeout(flush, ms);
}

export async function flush() {
  if (!col) return;
  if (flushing) { again = true; return; }
  flushing = true;
  clearTimeout(timer);
  try {
    const docs = buildDocs();
    let wrote = false;
    for (const [k, body] of docs) {
      const json = JSON.stringify(body);
      if (written.get(k) === json) continue;
      if (!wrote) { cloud.status = 'saving'; wrote = true; }
      await col.doc(k).set(JSON.parse(json));
      written.set(k, json);
    }
    // Remove documents of deleted chapters / chunks no longer needed (never the old f_/c_ backups).
    for (const k of [...written.keys()]) {
      if (docs.has(k)) continue;
      const fid = chapterIdOf(k);
      if (!fid) continue;
      if (state.deletedChapters[fid] || state.chapters.some((c) => c.id === fid)) {
        await col.doc(k).delete();
        written.delete(k);
      }
    }
    cloud.status = 'synced';
    cloud.message = '';
  } catch (e) {
    const err = e as { code?: string; message?: string };
    cloud.status = 'error';
    cloud.message = err.code === 'quota_exceeded' ? 'Cloud storage is full — remove some PGN files.' : (err.message || String(err.code || e));
    if (err.code !== 'invalid_argument' && err.code !== 'quota_exceeded' && err.code !== 'revoked') schedule(8000);
  } finally {
    flushing = false;
    if (again) { again = false; schedule(300); }
  }
}

export async function initCloud() {
  const rt = await runtime();
  if (!rt) return; // opened as a local file: localStorage only
  cloud.status = 'connecting';
  rt.use('downloads').then((d) => { downloads = d as DownloadsNs | null; cloud.canDownload = !!d; }).catch(() => {});
  try {
    const [db, user] = (await Promise.all([rt.use('db'), rt.use('user')])) as [DbNs | null, UserNs | null];
    const uid = db && user ? await user.id() : null;
    if (!db || !uid) {
      cloud.status = 'signedout';
      return;
    }
    col = db.collection('data/users/' + uid);
    await pull();
    watch(
      () => [state.chapters, state.stats, state.settings, state.selection, state.disabled, state.deletedChapters],
      () => schedule(),
      { deep: true },
    );
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    await flush();
  } catch (e) {
    cloud.status = 'error';
    cloud.message = (e as { message?: string }).message || String(e);
  }
}

/** Save a text file: through the platform on claude.ai, as a normal download elsewhere. */
export async function saveFile(filename: string, data: string): Promise<string> {
  if (downloads) {
    try {
      await downloads.save({ filename, data });
      return 'Backup saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'Download cancelled';
      return 'Download failed: ' + ((e as { message?: string }).message || code);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'Backup downloaded';
}
