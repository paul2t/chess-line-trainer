/** Read the PGN files of a zip archive, sorted alphabetically by file name. */
import { unzipSync, strFromU8 } from 'fflate';

export interface ZipPgn { name: string; text: string }

export const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

/** Chapter name from a file path: base name without .pgn, underscores as spaces. */
export const chapterName = (path: string) => path.split('/').pop()!.replace(/\.pgn$/i, '').replace(/_/g, ' ').trim();

export function readZipPgns(bytes: Uint8Array): ZipPgn[] {
  const files = unzipSync(bytes, {
    filter: (f) => /\.pgn$/i.test(f.name) && !f.name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'),
  });
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return Object.entries(files)
    .map(([path, data]) => ({ name: chapterName(path), text: strFromU8(data) }))
    .filter((f) => f.text.trim())
    .sort((a, b) => coll.compare(a.name, b.name));
}
