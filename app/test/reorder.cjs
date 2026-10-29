const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  await page.setInputFiles('input[type=file]', 'test/sample.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  const names = async () => (await page.locator('.side-head').allInnerTexts()).join(' / ') + ' :: ' + (await page.locator('.fname').allInnerTexts()).join(' | ');
  console.log('before:', await names());
  await page.click('text=⇅ Reorder'); await page.waitForTimeout(150);
  await page.screenshot({ path: 'test/35-reorder.png' });
  console.log('groups:', (await page.locator('.side-head').allInnerTexts()).join(' | '), '| list:', (await page.locator('.rname').allInnerTexts()).join(' | '));
  // Black group: [caro, sample (Black)] -> move sample (Black) to top
  await page.locator('.rrow').nth(2).locator('button[aria-label="Move to top"]').click();
  console.log('reorder list:', (await page.locator('.rname').allInnerTexts()).join(' | '));
  await page.click('.lib-head >> text=Done'); await page.waitForTimeout(150);
  console.log('after:', await names());
  await page.reload(); await page.waitForTimeout(500);
  console.log('after reload:', await names());
  console.log('errors', errs); await browser.close();
})();
