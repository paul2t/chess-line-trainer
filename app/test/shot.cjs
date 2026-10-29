const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('text=All in order'); await page.waitForTimeout(1100);
  const sq = async (k) => { const b = await page.locator('.trainer cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  const move = async (u) => { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await page.mouse.click(a.x,a.y); await page.waitForTimeout(60); await page.mouse.click(c.x,c.y); await page.waitForTimeout(800); };
  for (const m of ['c7c5','d7d6','c5d4','g8f6','a7a6','e7e5','c8e6']) await move(m);
  await page.waitForTimeout(1300);
  await page.click('.prevline'); await page.waitForTimeout(500);
  await page.screenshot({ path: 'test/19-review.png' });
  await browser.close();
})();
