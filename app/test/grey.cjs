const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Per chapter")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('.fmain');
  await page.click('.gmain >> nth=1'); await page.waitForTimeout(200);
  await page.click('.lines-tools a'); // disable all lines of London
  await page.click('.gmain >> nth=0'); await page.waitForTimeout(200);
  await page.locator('.lrow .switch span').nth(1).click(); // one Najdorf line off
  await page.waitForTimeout(200);
  console.log('grey chapters:', await page.locator('.grow.off').count(), 'grey lines:', await page.locator('.lrow.off').count());
  await page.screenshot({ path: 'test/13-grey.png', fullPage: true });
  console.log(errs); await browser.close();
})();
