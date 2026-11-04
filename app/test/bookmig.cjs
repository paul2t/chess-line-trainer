// A book holding White and Black chapters (made before books had one side) is split in two.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const ch = (id, name, color, moves) => ({ id, name, color, book: 'bk1', lines: [{ id: id + 'l', title: name, moves }], added: 1, updated: 1, src: { study: 'AbCdEfGh', chapter: id, name, lines: [id + 'l'] } });
    localStorage.setItem('clt.chapters.v2', JSON.stringify([ch('c1', 'Advance', 'b', 'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5'), ch('c2', 'Exchange', 'b', 'e2e4 c7c6 d2d4 d7d5 e4d5 c6d5'), ch('c3', 'As White', 'w', 'e2e4 c7c6 b1c3 d7d5 g1f3')]));
    localStorage.setItem('clt.books.v1', JSON.stringify([{ id: 'bk1', name: 'Caro-Kann Rep', added: 1, updated: 1, studies: [{ id: 'AbCdEfGh', name: 'Caro-Kann Rep', syncedAt: 1, checkedAt: Date.now() }] }]));
  });
  await page.goto('file://' + path.resolve('dist/index.html')); await page.waitForTimeout(500);
  const t = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\n/g, ' ')).join(' || ');
  await page.click('.side-tabs button:has-text("Black")'); await page.waitForTimeout(150);
  console.log('black:', await t('.bookhead .bname'), '|', await t('.card.file.inbook .fname'));
  await page.click('.side-tabs button:has-text("White")'); await page.waitForTimeout(150);
  console.log('white:', await t('.bookhead .bname'), '|', await t('.card.file.inbook .fname'));
  await page.waitForTimeout(400);
  console.log('stored:', await page.evaluate(() => JSON.parse(localStorage.getItem('clt.books.v1')).map((b) => `${b.id}:${b.name}:${b.color}:${(b.studies || []).map((s) => s.id)}`).join(' ')));
  // moving a chapter only offers books of its side; switching its side takes it out of the book
  await page.locator('.card.file.inbook .dots').first().click(); await page.click('text=Move to book…');
  console.log('move targets:', await t('.sheet .btn'));
  await page.click('.sheet .btn:has-text("Close")');
  await page.locator('.card.file.inbook .dots').first().click(); await page.click('text=Play Black in this chapter'); await page.waitForTimeout(200);
  console.log('switched:', await t('.toast'));
  await page.click('.side-tabs button:has-text("Black")'); await page.waitForTimeout(150);
  console.log('black now:', await t('.bookhead .bname'), '| loose:', await t('.loosehead'));
  console.log('errors', errs); await browser.close();
})();
