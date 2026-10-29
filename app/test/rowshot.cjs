const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal');
  await page.fill('.pend-block input', 'caro kann 1 advance sidelines');
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  await page.setInputFiles('input[type=file]', 'test/sample.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  await page.locator('.frow .switch span').nth(1).click(); await page.waitForTimeout(4000);
  await page.locator('.library .file').first().screenshot({ path: 'test/31-row.png' });
  await page.locator('.library .file').nth(1).screenshot({ path: 'test/32-off.png' });
  await browser.close();
})();
