const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.seg button:has-text("Per game")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  const ex = async () => (await page.locator('.explorer').innerText()).replace(/\n/g, ' ');
  console.log('ALL start:', await ex());
  await page.click('.ctl-row .seg >> nth=1 >> text=Black'); await page.waitForTimeout(200);
  console.log('BLACK start:', await ex(), '|', await page.locator('.presult').innerText());
  await page.click('.xrow .chip.mine'); await page.waitForTimeout(200); // 1.e4 c5
  await page.click('.xrow .chip.mine'); await page.waitForTimeout(200); // 2.Nf3 d6
  console.log('after 2 pairs:', (await page.locator('.crumbs').innerText()).replace(/\n/g,' '), '|', await ex());
  await page.screenshot({ path: 'test/16-explore.png', fullPage: true });
  await page.click('.crumb >> nth=2'); await page.waitForTimeout(200); // back to after 1...c5
  console.log('crumb back:', (await page.locator('.crumbs').innerText()).replace(/\n/g,' '), '|', await ex());
  // moves tab
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.fill('.psearch .card .inp', 'a6'); await page.waitForTimeout(200);
  console.log('a6 me:', await page.locator('.presult').innerText());
  await page.fill('.psearch .card .inp', 'cxd4 Qb6'); await page.waitForTimeout(200);
  console.log('cxd4 Qb6:', await page.locator('.presult').innerText(), '|', await page.locator('.psearch .lrow .ltext').first().innerText());
  await page.fill('.psearch .card .inp', 'Bg5'); await page.click('text=Opponent'); await page.waitForTimeout(200);
  console.log('Bg5 opp:', await page.locator('.presult').innerText());
  await page.click('.ctl-row .seg >> nth=1 >> text=White'); await page.waitForTimeout(200);
  console.log('Bg5 opp white:', await page.locator('.presult').innerText());
  await page.click('.ctl-row .seg >> nth=1 >> text=All');
  await page.screenshot({ path: 'test/17-moves.png', fullPage: true });
  await page.click('.psearch .lrow .lmain'); await page.waitForTimeout(300);
  console.log('opened:', (await page.locator('.crumbs').innerText()).replace(/\n/g,' '));
  // train from first match in moves tab
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves'); await page.click('.psearch .colorpick .seg button:has-text("Me")');
  await page.fill('.psearch .card .inp', 'Nxe4'); await page.click('text=Start training at the first matching move'); await page.waitForTimeout(100);
  await page.click('.presult ~ .row2 .btn.primary'); await page.waitForTimeout(1300);
  console.log('trainer:', (await page.locator('.tbar').innerText()).replace(/\n/g,' | '), '/', await page.locator('.status').innerText());
  console.log('errors', errs); await browser.close();
})();
