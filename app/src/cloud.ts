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
 *   f_<fileId>      PGN file metadata
 *   c_<fileId>_<n>  PGN text in chunks (documents are capped at 256 KiB)
 */
import { reactive, watch } from 'vue';
import { state, applying, type LineStat, type PgnFile, type Settings } from './store';

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
    deletedFiles: state.deletedFiles, updated: state.metaUpdated,
  });
  const shards: Record<string, Record<string, LineStat>> = {};
  for (const [id, st] of Object.entries(state.stats)) (shards[shardOf(id)] ??= {})[id] = st;
  // Shards that existed before but are now empty (progress reset) must be cleared, not left behind.
  for (const k of written.keys()) if (k.startsWith('s_') && !shards[k]) shards[k] = {};
  for (const [k, v] of Object.entries(shards)) docs.set(k, { stats: v });
  for (const f of state.files) {
    const n = Math.max(1, Math.ceil(f.text.length / CHUNK));
    docs.set('f_' + f.id, {
      id: f.id, name: f.name, added: f.added, updated: f.updated ?? f.added,
      color: f.color ?? null, colors: f.colors, chunks: n,
    });
    for (let i = 0; i < n; i++) docs.set(`c_${f.id}_${i}`, { t: f.text.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  return docs;
}

function fileIdOf(docId: string): string | null {
  const m = docId.match(/^[fc]_([^_]+)/);
  return m ? m[1] : null;
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
      for (const [id, t] of Object.entries(m.deletedFiles ?? {})) if ((state.deletedFiles[id] ?? 0) < t) state.deletedFiles[id] = t;
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

    // --- files
    for (const [k, v] of remote) {
      if (!k.startsWith('f_')) continue;
      const rf = v as unknown as Omit<PgnFile, 'text'> & { chunks: number; color: PgnFile['color'] | null };
      const rUpdated = rf.updated ?? rf.added ?? 0;
      if ((state.deletedFiles[rf.id] ?? 0) >= rUpdated) continue;
      const text = Array.from({ length: rf.chunks }, (_, i) => (remote.get(`c_${rf.id}_${i}`)?.t as string) ?? '').join('');
      const incoming: PgnFile = { id: rf.id, name: rf.name, text, added: rf.added, updated: rUpdated, color: rf.color ?? undefined, colors: rf.colors ?? {} };
      const byId = state.files.find((f) => f.id === rf.id);
      if (byId) {
        if (rUpdated > (byId.updated ?? 0)) Object.assign(byId, incoming);
        continue;
      }
      // Same PGN imported separately on two devices: keep the newer copy.
      const byName = state.files.find((f) => f.name === rf.name);
      if (byName) {
        if (rUpdated > (byName.updated ?? 0)) {
          state.deletedFiles[byName.id] = Date.now();
          Object.assign(byName, incoming);
        } else {
          state.deletedFiles[rf.id] = Date.now();
        }
        continue;
      }
      state.files.push(incoming);
    }
    // files deleted on another device
    const keep = state.files.filter((f) => (state.deletedFiles[f.id] ?? 0) < (f.updated ?? f.added));
    if (keep.length !== state.files.length) state.files = keep;

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
    // Remove documents of deleted files / chunks that are no longer needed.
    for (const k of [...written.keys()]) {
      if (docs.has(k)) continue;
      const fid = fileIdOf(k);
      if (!fid) continue;
      if (state.deletedFiles[fid] || state.files.some((f) => f.id === fid)) {
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
      () => [state.files, state.stats, state.settings, state.selection, state.disabled, state.deletedFiles],
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
