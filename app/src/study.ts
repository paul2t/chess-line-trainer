/**
 * Lichess studies: import a study as a book (or into a book) and synchronise it again later.
 *
 * - GET https://lichess.org/api/study/{id}.pgn (all chapters; private/unlisted ones need a token with study:read)
 * - Each study chapter becomes a chapter (side from its Orientation), each variation path a line.
 * - Chapters remember which study chapter they came from and which lines came from it, so a sync
 *   adds/removes only those lines: lines you added here, your progress and on/off switches are kept.
 * - HEAD on the same URL gives Last-Modified: used to flag studies that changed on lichess.
 */
import { parsePgn, pgnToLines, type Color, type Line } from './pgn';
import {
  state, createBook, createChapter, removeChapter, storeLine, setChapterBook,
  type Book, type Chapter, type StoredLine,
} from './store';
import { lichess } from './lichess';

const API = 'https://lichess.org';

/** `orientation` = side of the study chapter's board; on import every chapter is played from the book's side. */
export interface StudyChapter { id: string; name: string; orientation: Color; lines: { title: string; line: Line }[]; include: boolean }
export interface Study { id: string; name: string; chapters: StudyChapter[]; modified?: string }

/** Side most of the study's chapters are for. */
export function studySide(st: Study): Color {
  const black = st.chapters.filter((c) => c.orientation === 'b').length;
  return black > st.chapters.length / 2 ? 'b' : 'w';
}
/** Tick the chapters whose board is oriented for `side`. */
export function includeSide(st: Study, side: Color) {
  for (const c of st.chapters) c.include = c.orientation === side;
}

/** Study id from a URL (lichess.org/study/XXXXXXXX[/chapter]) or a bare 8-character id. */
export function parseStudyId(s: string): string | null {
  const t = s.trim();
  const m = t.match(/study\/([A-Za-z0-9]{8})/) ?? t.match(/^([A-Za-z0-9]{8})$/);
  return m ? m[1] : null;
}

const authHeaders = (): Record<string, string> => (lichess.token ? { Authorization: 'Bearer ' + lichess.token } : {});

function errorText(status: number): string {
  if (status === 404 || status === 401 || status === 403)
    return lichess.token
      ? 'Study not found, or you have no access to it. For a private or unlisted study, tap “Allow access to my studies” (here or in Settings).'
      : 'Study not found. If it is private or unlisted, log in to lichess first (Settings).';
  if (status === 429) return 'Lichess is rate-limiting requests — try again in a minute.';
  return `Lichess answered ${status}.`;
}

export async function fetchStudy(id: string): Promise<Study> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/study/${id}.pgn?clocks=false&comments=true&variations=true&orientation=true`, { headers: authHeaders() });
  } catch (e) {
    throw new Error('Could not reach lichess: ' + (e as Error).message);
  }
  if (!r.ok) throw new Error(errorText(r.status));
  const st = parseStudy(await r.text(), id);
  st.modified = r.headers.get('Last-Modified') ?? undefined;
  if (!st.chapters.length) throw new Error('This study has no chapter with moves.');
  return st;
}

const ok = (v?: string) => !!v && v !== '?' && v.trim() !== '';

/** Study PGN → chapters with their lines. */
export function parseStudy(text: string, id: string): Study {
  const games = parsePgn(text);
  const nameOf = (h: Record<string, string>, i: number) => {
    if (ok(h.ChapterName)) return h.ChapterName;
    const ev = h.Event ?? '';
    const k = ev.indexOf(': ');
    return k > 0 ? ev.slice(k + 2) : ok(ev) ? ev : `Chapter ${i + 1}`;
  };
  const h0 = games[0]?.headers ?? {};
  const ev0 = h0.Event ?? '';
  const name = ok(h0.StudyName) ? h0.StudyName : ev0.includes(': ') ? ev0.slice(0, ev0.indexOf(': ')) : `Study ${id}`;
  const parts = pgnToLines(text, (g, i) => nameOf(g.headers, i));
  const chapters: StudyChapter[] = [];
  games.forEach((g, i) => {
    const h = g.headers;
    const url = h.ChapterURL ?? h.Site ?? '';
    const cid = url.match(/study\/[A-Za-z0-9]{8}\/([A-Za-z0-9]{8})/)?.[1] ?? nameOf(h, i);
    const o = (h.Orientation ?? '').toLowerCase();
    const orientation: Color = o === 'black' ? 'b' : o === 'white' ? 'w' : g.guessedColor;
    const seen = new Set<string>();
    const lines = parts
      .filter((p) => p.game === g && p.line.moves.length > 0)
      .filter((p) => (seen.has(p.line.id) ? false : (seen.add(p.line.id), true)))
      .map((p) => ({ title: p.title, line: p.line }));
    if (lines.length) chapters.push({ id: cid, name: nameOf(h, i), orientation, lines, include: true });
  });
  return { id, name, chapters };
}

/** Your studies (needs a lichess login). */
export async function myStudies(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  if (!lichess.token) throw new Error('Log in to lichess first (Settings).');
  let user = lichess.user;
  if (!user) {
    const r = await fetch(`${API}/api/account`, { headers: authHeaders() });
    if (!r.ok) throw new Error(errorText(r.status));
    user = lichess.user = ((await r.json()) as { username?: string }).username ?? '';
  }
  const r = await fetch(`${API}/api/study/by/${encodeURIComponent(user)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(errorText(r.status));
  return (await r.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: string; name: string; updatedAt: number })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/* ---------------- sync ---------------- */

export interface ChapterChange { chapter: Chapter; add: number; remove: number; rename?: string }
export interface SyncPlan {
  study: Study;
  book: Book | null; // null = a new book is created
  side: Color; // side of the book
  /** Chapters of this study that belong to this book (or to no book that is linked to it). */
  mine: Chapter[];
  /** New study chapters left out because their board is for the other side. */
  otherSide: StudyChapter[];
  newChapters: StudyChapter[];
  changes: ChapterChange[];
  /** Chapters deleted from the study: deleted here (or kept, unlinked, when they hold lines you added). */
  gone: { chapter: Chapter; keep: boolean }[];
  addedLines: number;
  removedLines: number;
}

const linked = (studyId: string) => state.chapters.filter((c) => c.src?.study === studyId);

/**
 * What a sync (or first import) of `study` into `book` would change. A study can feed several books
 * (e.g. its White chapters into one, its Black chapters into another): each book owns the chapters
 * it holds, new study chapters go to the book of their side.
 */
export function planSync(study: Study, book: Book | null, side: Color = book?.color ?? studySide(study)): SyncPlan {
  const link = book?.studies?.find((s) => s.id === study.id);
  const skip = new Set(link ? link.skip ?? [] : study.chapters.filter((c) => !c.include).map((c) => c.id));
  const all = linked(study.id);
  const otherBook = (c: Chapter) =>
    !!c.book && c.book !== book?.id && !!state.books.find((b) => b.id === c.book)?.studies?.some((s) => s.id === study.id);
  const mine = all.filter((c) => !otherBook(c));
  const taken = new Set(all.filter(otherBook).map((c) => c.src!.chapter));
  const plan: SyncPlan = { study, book, side, mine, otherSide: [], newChapters: [], changes: [], gone: [], addedLines: 0, removedLines: 0 };
  for (const sc of study.chapters) {
    if (skip.has(sc.id) || taken.has(sc.id)) continue;
    const ch = mine.find((c) => c.src!.chapter === sc.id);
    if (!ch && link && sc.orientation !== side) { plan.otherSide.push(sc); continue; }
    if (!ch) { plan.newChapters.push(sc); plan.addedLines += sc.lines.length; continue; }
    const now = new Set(sc.lines.map((l) => l.line.id));
    const have = new Set(ch.lines.map((l) => l.id));
    const was = new Set(ch.src!.lines);
    const add = sc.lines.filter((l) => !have.has(l.line.id)).length;
    const remove = ch.lines.filter((l) => was.has(l.id) && !now.has(l.id)).length;
    const rename = ch.name === ch.src!.name && sc.name !== ch.name ? sc.name : undefined;
    if (add || remove || rename) plan.changes.push({ chapter: ch, add, remove, rename });
    plan.addedLines += add;
    plan.removedLines += remove;
  }
  const ids = new Set(study.chapters.map((c) => c.id));
  for (const ch of plan.mine)
    if (!ids.has(ch.src!.chapter)) {
      const was = new Set(ch.src!.lines);
      plan.gone.push({ chapter: ch, keep: ch.lines.some((l) => !was.has(l.id)) });
      plan.removedLines += ch.lines.filter((l) => was.has(l.id)).length;
    }
  return plan;
}

export const planIsEmpty = (p: SyncPlan) => !p.newChapters.length && !p.changes.length && !p.gone.length;

/** Apply a plan: create/update/remove chapters, link the study to the book. Returns the book. */
export function applySync(plan: SyncPlan): Book {
  const { study } = plan;
  let book = plan.book;
  if (!book) book = createBook(study.name, plan.side);
  book.studies ??= [];
  let link = book.studies.find((s) => s.id === study.id);
  if (!link) {
    link = { id: study.id, name: study.name, syncedAt: 0 };
    const skip = study.chapters.filter((c) => !c.include).map((c) => c.id);
    if (skip.length) link.skip = skip;
    book.studies.push(link);
  }
  // A book still named after its study follows a rename on lichess.
  if (book.name === link.name && study.name !== link.name) book.name = study.name;
  link.name = study.name;
  link.syncedAt = Date.now();
  link.checkedAt = Date.now();
  link.modified = study.modified;
  delete link.changed;

  const byId = new Map(study.chapters.map((c) => [c.id, c]));
  for (const sc of plan.newChapters) {
    const ch = createChapter(sc.name, book.color, book.id);
    ch.lines = sc.lines.map((l) => storeLine(l.line, l.title));
    ch.src = { study: study.id, chapter: sc.id, name: sc.name, lines: sc.lines.map((l) => l.line.id) };
    setChapterBook(ch, book.id); // keeps the book's chapters together
  }
  for (const ch of plan.mine) {
    const sc = byId.get(ch.src!.chapter);
    if (!sc) continue;
    const was = new Set(ch.src!.lines);
    const now = new Set(sc.lines.map((l) => l.line.id));
    const old = new Map(ch.lines.map((l) => [l.id, l]));
    // Study lines in study order, then the lines you added here.
    const lines: StoredLine[] = sc.lines.map((l) => {
      const o = old.get(l.line.id);
      return o && !was.has(o.id) ? o : storeLine(l.line, l.title);
    });
    for (const l of ch.lines) if (!was.has(l.id) && !now.has(l.id)) lines.push(l);
    if (ch.name === ch.src!.name) ch.name = sc.name;
    ch.lines = lines;
    ch.src = { study: study.id, chapter: sc.id, name: sc.name, lines: [...now] };
    ch.updated = Date.now();
  }
  for (const g of plan.gone) {
    const was = new Set(g.chapter.src!.lines);
    if (g.keep) {
      g.chapter.lines = g.chapter.lines.filter((l) => !was.has(l.id));
      delete g.chapter.src;
      g.chapter.updated = Date.now();
    } else removeChapter(g.chapter.id);
  }
  state.selection = state.selection.filter((id) => state.chapters.some((c) => c.lines.some((l) => l.id === id)));
  return book;
}

/** Short description of a plan. */
export function planSummary(p: SyncPlan): string {
  const parts: string[] = [];
  if (p.newChapters.length) parts.push(`${p.newChapters.length} new chapter${p.newChapters.length === 1 ? '' : 's'}`);
  if (p.gone.length) parts.push(`${p.gone.length} chapter${p.gone.length === 1 ? '' : 's'} removed from the study`);
  const renamed = p.changes.filter((c) => c.rename).length;
  if (renamed) parts.push(`${renamed} renamed`);
  if (p.addedLines) parts.push(`+${p.addedLines} line${p.addedLines === 1 ? '' : 's'}`);
  if (p.removedLines) parts.push(`−${p.removedLines} line${p.removedLines === 1 ? '' : 's'}`);
  const out = parts.join(' · ') || 'already up to date';
  const o = p.otherSide.length;
  return o ? `${out} (${o} new chapter${o === 1 ? '' : 's'} for the other side left out)` : out;
}

/* ---------------- change check ---------------- */

const CHECK_MS = 6 * 3600000;

/** Ask lichess (HEAD, Last-Modified) whether linked studies changed since the last sync. */
export async function checkStudies(force = false) {
  for (const b of state.books)
    for (const s of b.studies ?? []) {
      if (!force && s.checkedAt && Date.now() - s.checkedAt < CHECK_MS) continue;
      try {
        const r = await fetch(`${API}/api/study/${s.id}.pgn`, { method: 'HEAD', headers: authHeaders() });
        s.checkedAt = Date.now();
        const lm = r.headers.get('Last-Modified');
        if (r.ok && lm && s.modified && lm !== s.modified) s.changed = true;
      } catch { /* offline: try again later */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
}

/** Fetch a linked study again and plan its sync. */
export async function planBookSync(b: Book, studyId: string): Promise<SyncPlan> {
  return planSync(await fetchStudy(studyId), b);
}

export { setChapterBook };
