const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.click('.ctl-row .seg >> nth=1 >> text=Black');
  for (const q of ['e6', 'a6', 'Bd7']) {
    await page.click('.ctl-row .seg >> nth=0 >> text=Moves'); await page.waitForTimeout(100);
    await page.fill('.psearch .card .inp >> nth=0', q); await page.waitForTimeout(150);
    await page.click('text=🔍 Explore these lines'); await page.waitForTimeout(300);
    console.log(q, '->', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' '), '| explorer:', (await page.locator('.explorer').innerText()).replace(/\n/g, ' ').slice(0, 90), '|', await page.locator('.psearch .cg-wrap').getAttribute('class'));
  }
  console.log('errors', errs); await browser.close();
})();
