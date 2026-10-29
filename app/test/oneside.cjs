const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  console.log('empty app tabs:', (await page.locator('.side-tabs button').allInnerTexts()).join(' | '));
  await page.click('.side-tabs button:has-text("Black")');
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal');
  console.log('import default side on Black tab:', await page.locator('.pend-block .seg .on').innerText());
  await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  await page.click('.side-tabs button:has-text("White")');
  console.log('white tab, no chapter:', await page.locator('.library p.center').innerText().catch(() => '-'), '| scope:', await page.locator('.scope').innerText());
  await page.setInputFiles('input[type=file]', 'test/sample.pgn'); await page.waitForSelector('.modal');
  console.log('import default side on White tab:', await page.locator('.pend-block .seg .on').innerText());
  await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  console.log('white scope:', (await page.locator('.scope').innerText()).replace(/\n/g, ' '));
  // select one line on each side
  await page.locator('.library .lrow .cb').first().click();
  await page.click('.side-tabs button:has-text("Black")');
  await page.locator('.library .lrow .cb').first().click();
  console.log('black scope with selection:', (await page.locator('.scope').innerText()).replace(/\n/g, ' '));
  await page.click('text=All in order'); await page.waitForTimeout(1200);
  console.log('trainer:', await page.locator('.tbar .tprog').innerText(), '|', await page.locator('.tsub').innerText(), '| board:', await page.locator('.trainer .cg-wrap').getAttribute('class'));
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(200);
  // search: training from search uses one side
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.click('.ctl-row .seg >> nth=1 >> text=All');
  console.log('search (all, board white):', await page.locator('.presult ~ .row2 .btn.primary').innerText());
  await page.click('.tbar .icon >> nth=1'); await page.waitForTimeout(150); // flip
  console.log('search (all, board black):', await page.locator('.presult ~ .row2 .btn.primary').innerText());
  console.log('errors', errs); await browser.close();
})();
