const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  const now = Date.now();
  // chapters as saved by the previous version: per-line colours, mixed in one chapter
  const v2 = [{ id: 'abc123', name: 'Rep', color: 'b', added: now, updated: now, lines: [
    { id: 'L1', title: 'Sicilian', color: 'b', moves: 'e2e4 c7c5 g1f3 d7d6' },
    { id: 'L2', title: 'London', color: 'w', moves: 'd2d4 d7d5 c1f4' },
    { id: 'L3', title: 'Scandi', color: 'b', moves: 'e2e4 d7d5' },
  ] }];
  await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('clt.chapters.v2', JSON.stringify(v));
    localStorage.setItem('clt.stats.v1', JSON.stringify({ L2: { a: 2, e: 1, m: [Date.now()], lr: Date.now(), lm: Date.now(), s: 0, lc: false, ep: 1 } })); }, v2);
  await page.reload(); await page.waitForTimeout(800);
  const ch = await page.evaluate(() => JSON.parse(localStorage.getItem('clt.chapters.v2')));
  console.log(ch.map((c) => `${c.id} "${c.name}" [${c.color}]: ${c.lines.map((l) => l.title + ('color' in l ? '(!color)' : '')).join(', ')}`).join('  |  '));
  // line ids are recomputed from moves when built; stats keyed by stored id L2 are only valid if ids match — check trainer sees both chapters
  console.log('library:', (await page.locator('.fname').allInnerTexts()).join(', '), '| errors', errs);
  await browser.close();
})();
