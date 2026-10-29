const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=1 >> text=Black');
  await page.fill('.pinput .inp', '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Bg5 e6 7.f4 Qb6'); await page.click('.pinput .btn');
  await page.waitForTimeout(300);
  console.log('crumbs:', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' '));
  console.log('legend:', await page.locator('.crumb-legend').innerText());
  await page.locator('.crumbs').screenshot({ path: 'test/24-crumbs.png' });
  await browser.close();
})();
