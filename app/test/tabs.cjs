const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal'); await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  const view = async () => `[${await page.locator('.side-tabs .on').innerText()}] ` + (await page.locator('.library .fname').allInnerTexts()).join(' | ');
  console.log('after Caro import:', await view());
  await page.setInputFiles('input[type=file]', 'test/sample.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('after split import:', await view());
  await page.click('.side-tabs button:has-text("Black")'); await page.waitForTimeout(100);
  console.log('black tab:', await view());
  await page.click('text=⇅ Reorder');
  console.log('reorder (black only):', (await page.locator('.rname').allInnerTexts()).join(' | '));
  await page.locator('.rrow').nth(1).locator('button[aria-label="Move to top"]').click();
  await page.click('.lib-head >> text=Done');
  console.log('reordered:', await view());
  await page.screenshot({ path: 'test/36-tabs.png' });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('clt.chapters.v2')).map((c) => c.name).join(' | '));

  await page.reload(); await page.waitForTimeout(500);
  console.log('after reload:', await view(), '| scope:', await page.locator('.scope').innerText());
  console.log('errors', errs); await browser.close();
})();
