const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.click('.fmain'); await page.click('.gmain >> nth=0'); await page.waitForTimeout(200);
  await page.locator('.lrow .cb').first().click();
  const sq = async (k) => { const b = await page.locator('cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  const tap = async (k) => { const p = await sq(k); await page.mouse.click(p.x, p.y); };
  const st = () => page.locator('.status').innerText();
  await page.click('.train-card .btn.primary');
  await page.waitForTimeout(150);
  // during the opening delay (white hasn't played e4 yet): premove c7-c5
  await tap('c7'); await page.waitForTimeout(50); await tap('c5');
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test/9-premove.png' });
  await page.waitForTimeout(1200);
  console.log('premove result:', await st());
  // now white plays Nf3 after delay; select d7 while waiting, then tap d6 after
  await page.waitForTimeout(100); await tap('d7');
  console.log('selected during wait:', await page.evaluate(() => document.querySelectorAll('square.selected').length));
  await page.waitForTimeout(900);
  console.log('still selected after opp move:', await page.evaluate(() => document.querySelectorAll('square.selected').length), 'dests:', await page.evaluate(() => document.querySelectorAll('square.move-dest').length));
  await tap('d6'); await page.waitForTimeout(200);
  console.log('after d6:', await st());
  // wrong premove: during wait premove b8c6 (wrong; expected cxd4)
  await page.waitForTimeout(100); await tap('b8'); await tap('c6');
  await page.waitForTimeout(1100);
  console.log('wrong premove:', await st());
  await page.screenshot({ path: 'test/10-blue.png' });
  console.log(errs); await browser.close();
})();
