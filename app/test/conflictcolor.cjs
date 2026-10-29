const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Split by side")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  // leave the explorer filter on White, then open a Black conflict
  await page.click('text=Find & explore lines'); await page.waitForTimeout(200);
  await page.click('.ctl-row .seg >> nth=1 >> text=White'); await page.waitForTimeout(100);
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(200);
  await page.click('.warnhead');
  const blackConf = page.locator('.conf:has-text("as Black")');
  console.log('conflict:', (await blackConf.locator('.ltext').first().innerText()));
  await blackConf.locator('text=Open in position search').click(); await page.waitForTimeout(400);
  console.log('filter:', await page.locator('.ctl-row .seg >> nth=1 >> .on').innerText(), '| board:', await page.locator('.psearch .cg-wrap').getAttribute('class'), '| explorer:', (await page.locator('.explorer').innerText()).replace(/\n/g, ' ').slice(0, 80));
  console.log('errors', errs); await browser.close();
})();
