const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(800);
  await page.click('.fmain'); await page.waitForTimeout(300);
  await page.click('.gmain >> nth=0'); await page.waitForTimeout(300);
  console.log('lrows:', await page.locator('.lrow').count(), 'visible first:', await page.locator('.lrow').first().isVisible(), 'games rows:', await page.locator('.gmain').count());
  await page.screenshot({ path: 'test/dbg.png', fullPage: true });
  console.log(errs.slice(0, 5));
  await browser.close();
})();
