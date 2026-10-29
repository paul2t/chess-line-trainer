const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Per game")'); await page.click('.modal .btn.primary');
  await page.locator('.lrow .cb').nth(7).click();
  console.log(await page.locator('.scope').innerText());
  const sq = async (k) => { const b = await page.locator('cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(f+0.5)*s, y:b.y+(8-r+0.5)*s }; };
  const move = async (u) => { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await page.mouse.click(a.x,a.y); await page.waitForTimeout(60); await page.mouse.click(c.x,c.y); await page.waitForTimeout(800); };
  await page.click('.train-card .btn >> nth=2'); await page.waitForTimeout(900);
  for (const m of ['e2e4','g1f3','f1b5','b5a4','e1g1']) { await move(m); console.log(m, await page.locator('.status').innerText()); }
  await page.screenshot({ path: 'test/8-castle.png' });
  console.log(errs); await browser.close();
})();
