const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.click('.side-tabs button:has-text("Black")');
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.click('.psearch .colorpick .seg button:has-text("Opponent")');
  await page.fill('.psearch .card .inp >> nth=0', 'Nf3'); await page.waitForTimeout(200);
  await page.click('.view-tabs button:has-text("Boards")'); await page.waitForTimeout(300);
  const summary = async () => (await page.locator('.presult').innerText()).replace(/\n/g, ' ');
  console.log('Nf3 (opp):', await summary());
  console.log('groups:', (await page.locator('.bgroup').allInnerTexts()).join(' | '));
  console.log('first captions:', (await page.locator('.bcap').allInnerTexts()).slice(0, 4).join(' | '));
  await page.screenshot({ path: 'test/37-boards.png', fullPage: true });
  // filter only
  await page.fill('.psearch .card .inp >> nth=0', '');
  await page.fill('.psearch .card .inp >> nth=1', 'BBg4'); await page.waitForTimeout(200);
  console.log('BBg4 only:', await summary(), '| groups:', (await page.locator('.bgroup').allInnerTexts()).slice(0, 4).join(' | '));
  // move + filter
  await page.fill('.psearch .card .inp >> nth=0', 'Nf3');
  await page.fill('.psearch .card .inp >> nth=1', 'WBe2'); await page.waitForTimeout(200);
  console.log('Nf3 + WBe2:', await summary(), '| groups:', (await page.locator('.bgroup').allInnerTexts()).join(' | '));
  // FEN pattern: black pawn c5 (cxd4 not played yet), white pawn e5, white pawn d4
  await page.fill('.psearch .card .inp >> nth=0', '');
  await page.fill('.psearch .card .inp >> nth=1', '8/8/8/2p1P3/3P4/8/8/8'); await page.waitForTimeout(200);
  console.log('FEN pattern:', await summary(), '|', await page.locator('.psearch .card p.small').first().innerText().then((t) => t.slice(-14)));
  // bad token
  await page.fill('.psearch .card .inp >> nth=1', 'BBg4 Xz9'); await page.waitForTimeout(200);
  console.log('bad token note:', await page.locator('.psearch .warn').innerText());
  // open a board
  await page.fill('.psearch .card .inp >> nth=1', 'BBg4'); await page.waitForTimeout(200);
  await page.locator('.bcell').first().click(); await page.waitForTimeout(400);
  console.log('opened:', (await page.locator('.crumb.cur').innerText()), '| tab:', await page.locator('.ctl-row .seg >> nth=0 >> .on').innerText().catch(() => 'board'));
  console.log('errors', errs); await browser.close();
})();
