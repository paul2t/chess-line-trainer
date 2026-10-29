const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  // disable the first Najdorf line so we can check ordering
  await page.waitForTimeout(200);
  await page.locator('.lrow .switch span').nth(0).click(); await page.waitForTimeout(200);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.fill('.psearch .card .inp', 'a6'); await page.waitForTimeout(200);
  console.log('a6 rows:', (await page.locator('.psearch .lrow').evaluateAll(els => els.map(e => e.classList.contains('off') ? 'OFF' : 'on'))).join(','));
  await page.click('text=🔍 Explore these lines'); await page.waitForTimeout(300);
  console.log('scope:', (await page.locator('.scopebar').innerText()).replace(/\n/g, ' '), '| explorer:', (await page.locator('.explorer').innerText()).replace(/\n/g, ' '));
  for (let i = 0; i < 5; i++) { await page.click('.xrow .chip.mine'); await page.waitForTimeout(120); }
  console.log('crumb markers:', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' '), '| branch:', await page.locator('.crumb.branch').count(), 'conflict:', await page.locator('.crumb.conflict').count());
  await page.screenshot({ path: 'test/23-crumbs.png' });
  console.log('after 5 pairs:', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' '), '|', (await page.locator('.explorer').innerText()).replace(/\n/g, ' '));
  await page.click('.scopebar .btn'); await page.waitForTimeout(200);
  console.log('pos rows:', (await page.locator('.psearch .lrow').evaluateAll(els => els.map(e => e.classList.contains('off') ? 'OFF' : 'on'))).join(','));
  await page.locator('.psearch .lrow .lmain').first().click(); await page.waitForTimeout(300);
  console.log('opened line, future moves:', await page.locator('.crumb.future').count());
  const crumbsBefore = (await page.locator('.crumbs').innerText()).replace(/\n/g, ' ');
  // train from search -> mistake -> quit -> summary -> back to search
  await page.click('.presult ~ .row2 .btn.primary'); await page.waitForTimeout(1200);
  await page.click('.trainer .tbtns .btn >> nth=1'); await page.waitForTimeout(200);
  const sq = async (k) => { const b = await page.locator('.trainer cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  for (const u of ['e7e5', 'c8e6']) { const a = await sq(u.slice(0,2)), c = await sq(u.slice(2,4)); await page.mouse.click(a.x, a.y); await page.mouse.click(c.x, c.y); await page.waitForTimeout(800); }
  console.log('trainer status:', await page.locator('.trainer .status').innerText());
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(300);
  if (await page.locator('.summary').count()) { console.log('summary button:', await page.locator('.summary .btn.primary').innerText()); await page.click('.summary .btn.primary'); }
  await page.waitForTimeout(400);
  const crumbsAfter = (await page.locator('.crumbs').innerText()).replace(/\n/g, ' ');
  console.log('back in search:', await page.locator('.psearch .tprog').innerText(), '| same position:', crumbsBefore === crumbsAfter);
  await page.reload(); await page.waitForTimeout(800);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(400);
  console.log('after reload same position:', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' ') === crumbsBefore);
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves'); await page.waitForTimeout(200);
  console.log('moves query remembered:', await page.locator('.psearch .card .inp').inputValue());
  await page.click('.tbar .icon'); await page.waitForTimeout(200);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  console.log('reopens on last tab:', await page.locator('.ctl-row .seg >> nth=0 >> .on').innerText());
  console.log('errors', errs); await browser.close();
})();
