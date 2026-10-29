const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.screenshot({ path: 'test/0-empty.png' });
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.waitForSelector('.modal');
  await page.screenshot({ path: 'test/1-import.png' });
  console.log('guessed:', await page.locator('.seg button.on').innerText());
  await page.click('.seg button:has-text("Black")');
  await page.click('.modal .btn.primary');
  await page.waitForTimeout(300);
  await page.click('.fmain');
  await page.click('.gmain >> nth=0');
  await page.waitForTimeout(200);
  // disable the last Najdorf line
  await page.locator('.lrow .switch span').nth(4).click();
  await page.screenshot({ path: 'test/2-library.png', fullPage: true });
  console.log('train card:', (await page.locator('.train-card').innerText()).replace(/\n/g,' | '));

  const sq = async (key, black) => {
    const b = await page.locator('cg-board').boundingBox();
    const f = key.charCodeAt(0) - 97, r = +key[1];
    const s = b.width / 8;
    const x = black ? (7 - f + 0.5) * s : (f + 0.5) * s;
    const y = black ? (r - 1 + 0.5) * s : (8 - r + 0.5) * s;
    return { x: b.x + x, y: b.y + y };
  };
  const move = async (uci, black = true) => {
    const a = await sq(uci.slice(0,2), black), c = await sq(uci.slice(2,4), black);
    await page.mouse.click(a.x, a.y); await page.waitForTimeout(80);
    await page.mouse.click(c.x, c.y); await page.waitForTimeout(900);
  };
  const status = () => page.locator('.status').innerText();

  await page.click('.train-card .btn.primary');
  await page.waitForTimeout(1200);
  console.log('trainer:', await page.locator('.tbar').innerText().then(t=>t.replace(/\n/g,' | ')), '/', await status());
  await move('c7c5');
  console.log('after c5:', await status());
  await move('g8f6'); // wrong (should be d6)
  console.log('after wrong:', await status());
  await page.screenshot({ path: 'test/3-wrong.png' });
  for (const m of ['d7d6','c5d4','g8f6','a7a6','e7e5','c8e6']) { await move(m); }
  console.log('end:', await status());
  await page.screenshot({ path: 'test/4-done.png' });
  // Next line (Bg5 Qb6 line): play cleanly
  await page.click('.tbtns .btn.primary'); await page.waitForTimeout(1200);
  for (const m of ['c7c5','d7d6','c5d4','g8f6','a7a6','e7e6','d8b6']) { await move(m); }
  console.log('line2 end:', await status());
  await page.waitForTimeout(1300);
  console.log('now:', await page.locator('.tbar').innerText().then(t=>t.replace(/\n/g,' | ')));
  await page.click('.tbar .icon'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/5-summary.png', fullPage: true });
  console.log('summary:', (await page.locator('.summary').innerText()).replace(/\n/g,' | '));
  await page.click('.summary .btn.primary'); await page.waitForTimeout(300);
  console.log('lib after:', (await page.locator('.train-card').innerText()).replace(/\n/g,' | '));
  // reload: persistence
  await page.reload(); await page.waitForTimeout(500);
  await page.click('.fmain'); await page.click('.gmain >> nth=0'); await page.waitForTimeout(200);
  await page.screenshot({ path: 'test/6-reloaded.png', fullPage: true });
  console.log('lines after reload:', (await page.locator('.lines').first().innerText()).replace(/\n/g,' | '));
  console.log('errors:', errs);
  await browser.close();
})();
