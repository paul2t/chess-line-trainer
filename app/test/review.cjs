const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('.fmain'); await page.click('.gmain >> nth=0'); await page.waitForTimeout(200);
  await page.locator('.lrow .cb').nth(0).click(); await page.locator('.lrow .cb').nth(1).click(); await page.locator('.lrow .cb').nth(3).click();
  await page.click('text=All in order'); await page.waitForTimeout(1100);
  const sq = async (k) => { const b = await page.locator('.trainer cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  const move = async (u) => { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await page.mouse.click(a.x,a.y); await page.waitForTimeout(60); await page.mouse.click(c.x,c.y); await page.waitForTimeout(800); };
  const bar = async () => (await page.locator('.tbar .tprog').first().innerText());
  const st = () => page.locator('.trainer .status').innerText();
  // Line 1 (Be3) with a mistake at 4...Nf6
  for (const m of ['c7c5','d7d6','c5d4','b8c6','g8f6','a7a6','e7e5','c8e6']) await move(m);
  console.log('L1:', await bar(), '|', await st());
  console.log('buttons:', (await page.locator('.trainer .tbtns').allInnerTexts()).join(' / ').replace(/\n/g,' '));
  await page.click('text=🔍 Explore'); await page.waitForTimeout(400);
  console.log('explore:', await page.locator('.psearch .tprog').innerText(), '| cur:', await page.locator('.crumb.cur').innerText(), '| future:', await page.locator('.crumb.future').count());
  await page.click('.navb >> nth=1'); await page.waitForTimeout(200);
  console.log('after ›:', await page.locator('.crumb.cur').innerText(), '| explorer:', (await page.locator('.explorer').innerText()).replace(/\n/g,' '));
  await page.click('.xrow .chip.mine'); await page.waitForTimeout(200);
  console.log('pair kept line:', await page.locator('.crumb.cur').innerText(), '| future:', await page.locator('.crumb.future').count());
  await page.click('.xrow:has-text("Bg5") .chip >> nth=0'); await page.waitForTimeout(200);
  console.log('side line:', (await page.locator('.crumbs').innerText()).replace(/\n/g,' '), '| future:', await page.locator('.crumb.future').count());
  await page.click('text=‹ Back to training'); await page.waitForTimeout(400);
  console.log('back:', await bar(), '|', await st(), '| board pieces:', await page.locator('.trainer cg-board piece').count());
  await page.click('.trainer .btn.primary'); await page.waitForTimeout(1100); // Next
  // Line 2 (Bg5 Qb6) clean -> auto-advance
  for (const m of ['c7c5','d7d6','c5d4','g8f6','a7a6','e7e6','d8b6']) await move(m);
  console.log('L2:', await st()); await page.waitForTimeout(1400);
  console.log('auto-advanced to:', await bar(), '| prev button:', await page.locator('.prevline').count());
  await page.click('.prevline'); await page.waitForTimeout(400);
  console.log('prev:', await bar(), '|', await st(), '|', (await page.locator('.trainer .tbtns').allInnerTexts()).join(' / ').replace(/\n/g,' '));
  await page.click('.prevline'); await page.waitForTimeout(400);
  console.log('prev again:', await bar(), '|', await st());
  await page.click('text=↻ Redo'); await page.waitForTimeout(1100);
  console.log('redo:', await bar(), '|', await st());
  for (const m of ['c7c5','d7d6','c5d4','g8f6','a7a6','e7e5','c8e6']) await move(m);
  console.log('redo done:', await st()); await page.waitForTimeout(1400);
  console.log('after redo ->', await bar(), '|', await page.locator('.trainer .tsub').innerText());
  await page.screenshot({ path: 'test/18-train.png' });
  console.log('errors', errs); await browser.close();
})();
