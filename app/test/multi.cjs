const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Per chapter")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  console.log('warning:', await page.locator('.warnhead').innerText());
  await page.click('.warnhead'); await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/15-conflict-open.png', fullPage: true });
  console.log('conflict:', (await page.locator('.conf').first().innerText()).replace(/\n/g, ' | '));
  console.log('lichess href:', await page.locator('.confacts a').nth(1).getAttribute('href'));
  await page.click('text=Open in position search'); await page.waitForTimeout(300);
  console.log('search:', await page.locator('.crumbs').innerText(), '|', await page.locator('.dis').innerText(), '|', await page.locator('.phist a').getAttribute('href'));
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(200);
  // disable Be7 option -> warning disappears
  console.log('lines in first conflict:', (await page.locator('.conf').first().locator('.conf-line').allInnerTexts()).map(t=>t.replace(/\n/g,' ')));
  // switch off the single e4 line (Game 3) via its own toggle -> first conflict disappears
  await page.locator('.conf').first().locator('.conf-line .switch span').nth(2).click(); await page.waitForTimeout(200);
  console.log('after line toggle:', await page.locator('.warnhead').innerText());
  // second conflict (Najdorf Qb6/Be7): disable all Be7
  await page.locator('.conf').first().locator('.confopt-head .btn').nth(1).click(); await page.waitForTimeout(200);
  console.log('warnings left:', await page.locator('.warncard').count());
  await page.screenshot({ path: 'test/14-conflict.png', fullPage: true });
  // multi mistakes on first Najdorf line
  await page.click('text=All in order'); await page.waitForTimeout(1100);
  const sq = async (k) => { const b = await page.locator('cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  const move = async (u) => { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await page.mouse.click(a.x,a.y); await page.waitForTimeout(60); await page.mouse.click(c.x,c.y); await page.waitForTimeout(800); };
  console.log('lichess in trainer:', await page.locator('.tbtns a').getAttribute('href'));
  await move('e7e5'); await move('e7e6'); // two wrong tries same position -> 1 mistake
  await move('c7c5'); await move('d7d6');
  await move('c5d4'); await move('b8c6'); await move('g8f6'); await move('a7a6'); await move('e7e5'); await move('c8e6');
  console.log('end:', await page.locator('.status').innerText());
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(300);
  console.log('summary:', (await page.locator('.kpis').innerText()).replace(/\n/g, ' '));
  await page.click('.summary .btn.primary'); await page.click('.fmain'); await page.click('.gmain >> nth=0'); await page.waitForTimeout(200);
  console.log('stat:', await page.locator('.lstat').first().innerText());
  console.log('errors', errs); await browser.close();
})();
