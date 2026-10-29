# Chess Line Trainer

Train your opening repertoire on your phone: load PGNs, drill every line, review the ones you get wrong.

**Open it:** https://paul2t.github.io/chess-line-trainer/

- Your repertoire is a list of **chapters**, each a list of **lines** (a title and a sequence of moves). A chapter is for one side; move a line to another chapter to train it from the other side. Chapters and lines can each be switched off.
- Import a PGN as a new chapter or into an existing one: each game becomes a line titled with its Event (games with variations are split into one line per variation). You can also add lines from the explorer.
- The opponent's moves are played for you; you play your side.
- Smart review: lines with recent mistakes first, then due lines, then the most played lines on lichess.
- Find & explore: search by position (board, FEN or moves) or by moves you play; explore the repertoire tree.
- Lichess statistics (log in with lichess): game counts per move, common replies missing from your lines.
- Everything is stored in your browser (export a backup from Settings).

## Development

The page is a single self-contained `index.html` built from `app/` (Vue 3 + TypeScript + Vite, lichess chessground board).

```sh
cd app
npm install
npm run dev      # local dev server
npm run build    # type check + build → app/dist/index.html
```

Every push to `main` builds and publishes the page with GitHub Actions (`.github/workflows/deploy.yml`).
Pages must be set to **Settings → Pages → Source: GitHub Actions**.

Board images and piece sets come from lichess.org (lila); see lila's COPYING.md for their licenses.
