const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  const toast = async () => (await page.locator('.toast').innerText().catch(() => '')).replace(/\n/g, ' / ');
  // 1. import as a new chapter (default)
  await page.setInputFiles('input[type=file]', 'test/caro.pgn');
  await page.waitForSelector('.modal');
  console.log('modal default target:', await page.locator('.pend-block select').inputValue(), '| name:', await page.locator('.pend-block input').inputValue(), '| side:', await page.locator('.pend-block .seg .on').innerText());
  await page.click('.pend-block .seg button:has-text("Black")');
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('1:', await toast());
  console.log('chapter:', await page.locator('.fname').first().innerText(), '|', await page.locator('.fmeta').first().innerText());
  console.log('first titles:', (await page.locator('.library .ltitle').allInnerTexts()).slice(0, 3));
  await page.screenshot({ path: 'test/30-chapter.png', fullPage: true });
  // 2. import the same file into the existing chapter
  await page.setInputFiles('input[type=file]', 'test/caro.pgn');
  await page.waitForSelector('.modal');
  const chId = await page.locator('.pend-block select option').nth(1).getAttribute('value');
  await page.selectOption('.pend-block select', chId);
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('2:', await toast(), '| chapters:', await page.locator('.fname').count());
  // 3. paste a PGN with variations as a new chapter
  await page.click('.lib-head >> text=Paste');
  await page.fill('.library textarea', require('fs').readFileSync('test/sample.pgn', 'utf8'));
  await page.click('text=Next ›'); await page.waitForSelector('.modal');
  await page.fill('.pend-block input', 'Mixed');
  await page.click('.pend-block .seg button:has-text("Per game")');
  await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('3:', await toast(), '| chapters:', (await page.locator('.fname').allInnerTexts()).join(', '));
  // 4. line menu: rename + switch side + delete
  await page.locator('.library .lrow .dots').first().click();
  await page.click('.sheet >> text=Rename');
  await page.fill('.modal .inp', 'Intro line'); await page.click('.modal .btn.primary'); await page.waitForTimeout(150);
  console.log('4 renamed:', await page.locator('.library .ltitle').first().innerText());
  await page.locator('.library .lrow .dots').first().click();
  await page.click('.sheet >> text=Train as'); await page.waitForTimeout(150);
  console.log('   side shown:', await page.locator('.library .ltitle').first().innerText(), '| guess was Black:', true);
  await page.locator('.library .lrow .dots').nth(1).click();
  await page.click('.sheet >> text=Delete line'); await page.click('.modal .btn.danger'); await page.waitForTimeout(150);
  console.log('   after delete:', await page.locator('.fmeta').first().innerText());
  // 5. chapter menu: copy PGN and rename
  await page.locator('.frow .dots').first().click();
  await page.click('.sheet >> text=Copy as PGN'); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  console.log('5 copied games:', (clip.match(/\[Event /g) || []).length, '| first:', clip.split('\n')[0]);
  await page.locator('.frow .dots').first().click();
  await page.click('.sheet >> text=Rename'); await page.fill('.modal .inp', 'Caro-Kann Advance'); await page.click('.modal .btn.primary'); await page.waitForTimeout(150);
  console.log('   chapter renamed:', await page.locator('.fname').first().innerText());
  // 6. add a line from the explorer
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  await page.fill('.pinput .inp', '1.e4 c6 2.d4 d5 3.e5 c5 4.c3 Nc6 5.h3'); await page.click('.pinput .btn'); await page.waitForTimeout(200);
  await page.click('text=+ Add line'); await page.waitForTimeout(150);
  console.log('6 dialog:', await page.locator('.modal .inp').first().inputValue(), '| chapter:', await page.locator('.modal select').inputValue() !== 'new' ? 'existing' : 'new', '| side:', await page.locator('.modal .seg .on').innerText());
  await page.selectOption('.modal select', { label: 'Caro-Kann Advance' });
  await page.fill('.modal .inp >> nth=0', '4.c3 Nc6 5.h3 (my idea)');
  await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  console.log('   ', await toast());
  await page.click('text=+ Add line'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  console.log('   again:', await toast());
  await page.click('text=+ Add line'); await page.selectOption('.modal select', 'new'); await page.fill('.modal input.inp >> nth=1', 'Ideas'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  console.log('   new chapter:', await toast());
  await page.click('.tbar .icon'); await page.waitForTimeout(200);
  console.log('chapters now:', (await page.locator('.fname').allInnerTexts()).join(', '), '|', (await page.locator('.fmeta').allInnerTexts()).join(', '));
  console.log('errors', errs); await browser.close();
})();
