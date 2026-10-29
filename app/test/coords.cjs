const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("White")'); await page.click('.modal .btn.primary');
  await page.click('.train-card .btn.primary'); await page.waitForTimeout(500);
  console.log(await page.evaluate(() => [...document.querySelectorAll('coords')].map(c => c.className + ' parent=' + c.parentElement.className + ': ' + [...c.children].map(x => x.textContent + '(' + getComputedStyle(x).color + ')').join(' '))));
  await browser.close();
})();
