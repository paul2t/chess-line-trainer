const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  const t = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\n/g, ' ')).join(' || ');
  await page.setInputFiles('input[type=file]', 'test/caro-book.zip'); await page.waitForTimeout(300);
  console.log('modal:', await t('.modal h3'), '| name:', await page.locator('.zip-block input').inputValue(), '| side:', await t('.zip-block .seg .on'));
  console.log('chapters:', await t('.zip-block .schap-main'));
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('toast:', await t('.toast'), '| tab:', await t('.side-tabs .on'));
  console.log('library:', await t('.bookhead .bname'), '|', await t('.card.file.inbook .fname'));
  // a second zip into the existing book, one chapter left out
  await page.locator('.bookhead .dots').click(); await page.click('text=Import PGN or zip into it');
  await page.setInputFiles('input[type=file]', 'test/caro-book.zip'); await page.waitForTimeout(300);
  console.log('into book:', await page.locator('.zip-block select').inputValue() !== 'new', '|', await t('.zip-block p.small'));
  await page.locator('.zip-block .schap .cb').nth(0).click();
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('toast2:', await t('.toast'), '|', await t('.card.file.inbook .fname'));
  // not a zip with pgns
  console.log('errors', errs); await b.close();
})();
