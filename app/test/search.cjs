const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary');
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=1 >> text=Black'); await page.waitForTimeout(100);
  const res = async () => (await page.locator('.presult').innerText()).replace(/\n/g,' ');
  console.log('start:', await res(), '| chips:', (await page.locator('.explorer').innerText()).replace(/\n/g,' '));
  await page.fill('.pinput .inp', '1.Nf3 d6 2.e4 c5'); await page.click('.pinput .btn');
  await page.waitForTimeout(200);
  console.log('transposition:', await page.locator('.crumbs').innerText(), '->', await res(), '| chips:', (await page.locator('.explorer').innerText()).replace(/\n/g,' '));
  await page.fill('.pinput .inp', 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'); await page.click('.pinput .btn');
  await page.waitForTimeout(200);
  console.log('FEN:', await res(), '| chips:', (await page.locator('.explorer').innerText()).replace(/\n/g,' '));
  await page.click('.xrow:has-text("Be3") .chip >> nth=0'); await page.waitForTimeout(200); // Bg5
  console.log('after chip:', await page.locator('.crumbs').innerText(), '->', await res());
  await page.click('.phist .btn >> nth=0'); await page.waitForTimeout(200);
  console.log('after undo:', await res());
  await page.screenshot({ path: 'test/11-search.png' });
  await page.click('.presult ~ .row2 .btn.primary'); await page.waitForTimeout(1500);
  console.log('trainer:', (await page.locator('.tbar').innerText()).replace(/\n/g,' | '), '/', await page.locator('.status').innerText(), '/', await page.locator('.movelist').innerText());
  await page.screenshot({ path: 'test/12-trainfrom.png' });
  console.log('errors', errs); await browser.close();
})();
