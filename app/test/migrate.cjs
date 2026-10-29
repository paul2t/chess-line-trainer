const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const old = JSON.parse(fs.readFileSync('test/old-state.json', 'utf8'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const url = 'file://' + path.resolve('dist/index.html');
  await page.goto(url);
  await page.evaluate((o) => { localStorage.clear(); for (const [k, v] of Object.entries(o)) if (k !== 'expect') localStorage.setItem(k, JSON.stringify(v)); }, old);
  await page.reload(); await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({
    v2: JSON.parse(localStorage.getItem('clt.chapters.v2') || 'null'),
    v1kept: !!localStorage.getItem('clt.files.v1'),
    stats: Object.keys(JSON.parse(localStorage.getItem('clt.stats.v1'))),
    disabled: Object.keys(JSON.parse(localStorage.getItem('clt.disabled.v1'))),
    sel: JSON.parse(localStorage.getItem('clt.selection.v1')),
  }));
  const ch = st.v2;
  console.log('chapters:', ch.map((c) => `${c.name} [${c.color}] ${c.lines.length} lines`).join(' | '));
  const myrep = ch.find((c) => c.name === 'My repertoire');
  console.log('lines kept:', myrep.lines.length, '/', old.expect.lines);
  const allIds = new Set(ch.flatMap((c) => c.lines.map((l) => l.id)));
  console.log('every old line id kept:', old.expect.ids.flat().every((id) => allIds.has(id)));
  console.log('titles + sides:'); for (const l of myrep.lines) console.log('   ', l.color, l.title);
  console.log('stats/disabled/selection ids still valid:', old.expect.statIds.every((i) => allIds.has(i)), old.expect.disabled.every((i) => allIds.has(i)), old.expect.selection.every((i) => allIds.has(i)));
  console.log('old data kept as fallback:', st.v1kept, '| stats unchanged:', JSON.stringify(st.stats.sort()) === JSON.stringify(old.expect.statIds.sort()));
  // UI shows the progress
  console.log('train card:', (await page.locator('.train-card').innerText()).split('\n').slice(0, 5).join(' | '));
  await page.click('.fmain >> nth=0'); await page.waitForTimeout(200);
  console.log('first chapter lines:', (await page.locator('.library .lrow').allInnerTexts()).map((t) => t.replace(/\n/g, ' / ')).slice(0, 3));
  console.log('selected:', await page.locator('.library .lrow .cb.all').count(), '| off:', await page.locator('.library .lrow.off').count(), '| theme kept:', await page.evaluate(() => JSON.parse(localStorage.getItem('clt.settings.v1')).theme));
  await page.screenshot({ path: 'test/29-migrated.png', fullPage: true });
  // second load: no re-migration, same data
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('clt.chapters.v2')); c[0].name = 'Renamed'; localStorage.setItem('clt.chapters.v2', JSON.stringify(c)); });
  await page.reload(); await page.waitForTimeout(800);
  console.log('second load uses v2:', await page.locator('.fname').first().innerText());
  console.log('errors', errs); await browser.close();
})();
