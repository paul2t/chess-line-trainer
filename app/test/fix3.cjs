const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Split by side")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.waitForTimeout(200);
  console.log('user-select on line text:', await page.locator('.library .lmain').first().evaluate(e => getComputedStyle(e).userSelect || getComputedStyle(e).webkitUserSelect));
  // select 3 Najdorf lines + London line, copy
  await page.click('.side-tabs button:has-text("Black")'); await page.waitForTimeout(100);
  for (const i of [0, 1, 2]) await page.locator('.library .lrow .cb').nth(i).click();
  await page.click('.side-tabs button:has-text("White")'); await page.waitForTimeout(100);
  await page.locator('.library .lrow .cb').nth(0).click();
  await page.click('.selbar >> text=Copy PGN'); await page.waitForTimeout(300);
  console.log('toast:', await page.locator('.toast').innerText());
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  console.log(clip);
  // fallback when clipboard is blocked
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); });
  await page.click('.selbar >> text=Copy PGN'); await page.waitForTimeout(300);
  console.log('fallback box shown:', await page.locator('.pgnbox').count(), '| lines in box:', (await page.locator('.pgnbox').inputValue()).split('\n').length);
  await page.click('.modal .btn.primary');
  // orientation: moves search, Black, explore these lines
  await page.click('.selbar >> text=Clear');
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=1 >> text=White'); await page.waitForTimeout(150);
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.click('.ctl-row .seg >> nth=1 >> text=Black'); await page.waitForTimeout(150);
  await page.fill('.psearch .card .inp', 'a6'); await page.waitForTimeout(200);
  await page.click('text=🔍 Explore these lines'); await page.waitForTimeout(400);
  console.log('explore orientation:', await page.locator('.psearch .cg-wrap').getAttribute('class'));
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves'); await page.waitForTimeout(150);
  await page.locator('.psearch .lrow .lmain').first().click(); await page.waitForTimeout(400);
  console.log('open-line orientation:', await page.locator('.psearch .cg-wrap').getAttribute('class'), '| pieces:', await page.locator('.psearch cg-board piece').count());
  await page.screenshot({ path: 'test/26-black.png' });
  console.log('errors', errs); await browser.close();
})();
