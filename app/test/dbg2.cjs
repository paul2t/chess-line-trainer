const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(300);
  await page.click('.fmain');
  await page.click('.gmain >> nth=0');
  const loc = page.locator('.lrow .switch span');
  console.log('count', await loc.count());
  for (let i = 0; i < await loc.count(); i++) console.log(i, await loc.nth(i).isVisible(), await loc.nth(i).boundingBox());
  console.log('lrow in library?', await page.locator('.library .lrow').count(), 'other lrows:', await page.locator('.lrow:not(.library .lrow)').count());
  await browser.close();
})();
