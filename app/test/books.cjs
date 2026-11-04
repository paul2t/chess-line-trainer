const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  let version = 1; const hits = [];
  await page.route('https://lichess.org/**', async (route) => {
    const u = route.request().url(); hits.push(route.request().method() + ' ' + u.replace('https://lichess.org', ''));
    const lm = version === 1 ? 'Tue, 03 Nov 2026 10:00:00 GMT' : 'Wed, 04 Nov 2026 15:00:00 GMT';
    if (u.includes('/api/study/AbCdEfGh.pgn')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/x-chess-pgn', 'Last-Modified': lm, 'Access-Control-Allow-Origin': '*' }, body: route.request().method() === 'HEAD' ? '' : fs.readFileSync(`test/study-v${version}.pgn`, 'utf8') });
    if (u.includes('/api/study/Zzzzzzzz.pgn')) return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    if (u.endsWith('/api/account')) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ username: 'paul' }) });
    if (u.includes('/api/study/by/paul')) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ id: 'AbCdEfGh', name: 'Caro-Kann Rep', updatedAt: Date.now() }) + '\n' + JSON.stringify({ id: 'Qqqqqqqq', name: 'Slav', updatedAt: Date.now() - 86400000 }) + '\n' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.route('https://explorer.lichess.org/**', (r) => r.abort());
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.evaluate(() => localStorage.setItem('clt.lichess.token.v1', 'tok'));
  await page.reload(); await page.waitForTimeout(300);
  const t = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\n/g, ' ')).join(' || ');
  const add = async () => { await page.click('.lib-head .btn.primary'); await page.waitForTimeout(150); };

  // 1. bad id, then not found, then my studies
  await add(); await page.click('text=Import a lichess study'); await page.waitForTimeout(150);
  await page.fill('.study-import .inp', 'not a study'); await page.click('text=Load study'); await page.waitForTimeout(150);
  console.log('1 bad id:', await t('.study-import .warn'));
  await page.fill('.study-import .inp', 'https://lichess.org/study/Zzzzzzzz'); await page.click('text=Load study'); await page.waitForTimeout(300);
  console.log('  404:', await t('.study-import .warn'));
  await page.click('text=My studies'); await page.waitForTimeout(300);
  console.log('  my studies:', await t('.study-list .btn'));
  await page.click('.study-list .btn >> nth=0'); await page.waitForTimeout(300);
  console.log('2 preview:', await t('.study-import .study-name'), '|', await t('.schap'));
  console.log('  sides on:', await page.$$eval('.schap', (els) => els.map((e) => e.querySelector('.sidepick .on')?.textContent).join(' ')));
  await page.click('.study-import .btn.primary'); await page.waitForTimeout(300);
  console.log('3 toast:', await t('.toast'));
  console.log('  black tab:', await t('.bookhead'), '|', await t('.card.file.inbook .fname'));
  await page.click('.side-tabs button:has-text("White")'); await page.waitForTimeout(150);
  console.log('  white tab:', await t('.bookhead'), '|', await t('.card.file.inbook .fname'));
  await page.click('.side-tabs button:has-text("Black")'); await page.waitForTimeout(150);
  console.log('  black again:', await t('.card.file.inbook .fname'));

  // 4. local line added to "Advance" via paste into existing chapter
  await add(); await page.click('text=Paste PGN');
  await page.fill('.card textarea.inp', '[Event "My idea"]\n\n1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 *');
  await page.click('text=Next ›'); await page.waitForTimeout(150);
  const advId = await page.$eval('.pend-block select', (s) => [...s.options].find((o) => o.text.includes('Advance')).value);
  await page.selectOption('.pend-block select', advId); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  await page.locator('.card.file', { hasText: 'Advance' }).locator('.fmain').click(); await page.waitForTimeout(150);
  console.log('4 advance lines:', (await page.locator('.card.file', { hasText: 'Advance' }).locator('.ltitle').allInnerTexts()).join(' | '));

  // 5. study changes on lichess: change check (HEAD) flags the book, sync from the badge
  version = 2;
  await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('clt.books.v1')); b[0].studies[0].checkedAt = 0; localStorage.setItem('clt.books.v1', JSON.stringify(b)); });
  await page.reload(); await page.waitForTimeout(1500);
  console.log('5 badge:', await t('.sync-badge'));
  await page.click('.sync-badge'); await page.waitForTimeout(400);
  console.log('  confirm:', await t('.modal h3'), '|', await t('.modal p'));
  await page.click('.modal .btn.danger'); await page.waitForTimeout(300);
  console.log('  toast:', await t('.toast'));
  console.log('  chapters:', await t('.card.file.inbook .fname'), '| badge left:', await page.locator('.sync-badge').count());
  if (!(await page.locator('.card.file', { hasText: 'Advance' }).locator('.ltitle').count())) await page.locator('.card.file', { hasText: 'Advance' }).locator('.fmain').click();
  await page.waitForTimeout(150);
  console.log('  advance lines:', (await page.locator('.card.file', { hasText: 'Advance' }).locator('.ltitle').allInnerTexts()).join(' | '));
  // sync again = up to date
  await page.click('.bookhead .dots'); await page.click('text=Sync with lichess'); await page.waitForTimeout(400);
  console.log('6 resync:', await t('.toast'));

  // 7. new book, move chapter there
  await add(); await page.click('.sheet >> text=New book');
  await page.fill('.modal .inp', 'Slav'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  const tk = page.locator('.card.file', { hasText: 'Two Knights' });
  await tk.locator('.dots').first().click(); await page.click('text=Move to book…'); await page.click('.sheet .btn:has-text("Slav")'); await page.waitForTimeout(200);
  console.log('7 books:', await t('.bookhead .bname'), '| toast:', await t('.toast'));
  console.log('  sections:', await page.$$eval('.library > .bookhead, .library > .card.file, .library > .loosehead', (els) => els.map((e) => e.classList.contains('bookhead') ? '[' + e.querySelector('.bname').textContent + ']' : e.classList.contains('loosehead') ? '[none]' : e.querySelector('.fname').textContent).join(' ')));

  // 8. smart review a book
  await page.locator('.bookhead', { hasText: 'Caro-Kann' }).locator('.dots').click(); await page.click('text=Smart review this book'); await page.waitForTimeout(1200);
  console.log('8 training:', await t('.tbar .tprog'));
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(400);
  // 9. switch book off
  await page.locator('.bookhead', { hasText: 'Caro-Kann' }).locator('.switch span').click(); await page.waitForTimeout(200);
  console.log('9 off:', await t('.bookhead .bname'), '| scope:', await t('.train-card .scope'), '| smart:', await t('.train-card .btn.primary .pill'));
  // train-only-this-book (Slav)
  await page.locator('.bookhead', { hasText: 'Slav' }).locator('.dots').click(); await page.click('text=Train only this book'); await page.waitForTimeout(200);
  console.log('  only Slav:', await t('.train-card .scope'));
  // 10. reorder view
  await page.click('text=⇅ Reorder'); await page.waitForTimeout(150);
  console.log('10 reorder:', await t('.reorder .rname'));
  await page.click('.reorder .rbook >> nth=1 >> [aria-label="Move book up"]'); await page.waitForTimeout(150);
  console.log('   after:', await t('.reorder .rbook .rname'));
  await page.click('text=Done');
  // 11. delete book keeping chapters
  await page.locator('.bookhead', { hasText: 'Slav' }).locator('.dots').click(); await page.click('text=Delete book…'); await page.click('text=keep its chapters'); await page.waitForTimeout(200);
  console.log('11 after delete:', await t('.bookhead .bname'), '| loose:', await t('.loosehead'), await t('.library > .card.file .fname'));
  // 12. backup has books, reload keeps everything
  await page.reload(); await page.waitForTimeout(400);
  console.log('12 reload:', await t('.bookhead .bname'), '| books in storage:', await page.evaluate(() => JSON.parse(localStorage.getItem('clt.books.v1')).map((b) => b.name + (b.disabled ? '(off)' : '')).join(',')));
  console.log('requests:', hits.join(' ; '));
  await page.screenshot({ path: 'test/40-books.png', fullPage: true });
  console.log('errors', errs); await browser.close();
})();
