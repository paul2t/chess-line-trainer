/** Last state of the Find & explore screen, remembered across visits and reloads (this device). */
export interface SavedSearch {
  tab: 'board' | 'moves'; startFen: string; history: { uci: string; san: string }[]; cursor: number;
  orientation: 'white' | 'black'; query: string; moveQuery: string; moveBy: 'me' | 'opp';
  fromHere: boolean; fromFirst: boolean; scope: string[] | null;
}

const KEY = 'clt.search.v1';

function load(): SavedSearch | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSearch) : undefined;
  } catch {
    return undefined;
  }
}

export const searchMemory: { saved?: SavedSearch; lastChapter?: string } = { saved: load() };

export function rememberSearch(s: SavedSearch) {
  searchMemory.saved = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
