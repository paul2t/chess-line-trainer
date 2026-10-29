const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  const sq = async (key) => { const b = await page.locator('cg-board').boundingBox(); const f = key.charCodeAt(0)-97, r=+key[1], s=b.width/8; return { x: b.x+(7-f+0.5)*s, y: b.y+(r-0.5)*s }; };
  const move = async (u) => { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await page.mouse.click(a.x,a.y); await page.waitForTimeout(60); await page.mouse.click(c.x,c.y); await page.waitForTimeout(700); };
  const st = () => page.locator('.status').innerText();
  const bar = () => page.locator('.tbar').innerText().then(t=>t.replace(/\n/g,' | '));
  // select only the Bb5+ line
  await page.waitForTimeout(200);
  await page.locator('.lrow .cb').nth(3).click();
  console.log('scope:', await page.locator('.scope').innerText());
  await page.click('.train-card .btn.primary'); await page.waitForTimeout(1100);
  console.log(await bar());
  await move('c7c5'); await move('b8c6'); // mistake
  await move('d7d6'); await move('c8d7'); await move('d8d7');
  console.log('1:', await st()); await page.click('.tbtns .btn.primary'); await page.waitForTimeout(1100);
  console.log('requeued:', await bar());
  await page.click('.tbar .icon'); await page.waitForTimeout(200);
  await page.click('.summary .btn.primary'); await page.waitForTimeout(200);
  // drill today's mistakes
  await page.click('.train-card .btn >> nth=1'); await page.waitForTimeout(1100);
  console.log('drill:', await bar());
  await move('c7c5'); await page.click('.tbtns .btn >> nth=0'); // hint = mistake
  await page.waitForTimeout(200);
  await move('d7d6'); await move('c8d7'); await move('d8d7');
  console.log('drill1:', await st()); await page.click('.tbtns .btn.primary'); await page.waitForTimeout(1100);
  console.log('drill again:', await bar());
  await move('c7c5'); await move('d7d6'); await move('c8d7'); await move('d8d7');
  console.log('drill2:', await st()); await page.waitForTimeout(1400);
  console.log('summary:', (await page.locator('.summary').innerText()).replace(/\n/g,' | '));
  await page.screenshot({ path: 'test/7-summary.png' });
  // big PGN perf
  let big = '[Event "Big"]\n\n1. e4 e5 ';
  const t0 = Date.now();
  console.log('errors', errs);
  await browser.close();
})();
