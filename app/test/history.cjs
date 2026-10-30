const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.click('.side-tabs button:has-text("Black")');
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal'); await page.click('.modal .btn.primary'); await page.waitForTimeout(200);
  const where = async () => (await page.evaluate(() => location.hash.split('?')[0] || '(library)')) + ` [${await page.locator('.psearch').count() ? 'search' : await page.locator('.trainer:visible').count() ? 'train' : await page.locator('.summary').count() ? 'summary' : await page.locator('.settings').count() ? 'settings' : 'library'}]`;
  const hlen = () => page.evaluate(() => history.length);
  // 1. disable a line, search options
  await page.locator('.library .lrow .switch span').first().click();
  await page.locator('.library .lrow .cb').nth(1).click(); await page.locator('.library .lrow .cb').nth(2).click(); await page.locator('.library .lrow .cb').nth(3).click();
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  console.log('A search:', await where(), '| history', await hlen());
  await page.click('.ctl-row .seg >> nth=0 >> text=Moves');
  await page.click('.psearch .colorpick .seg button:has-text("Me")');
  await page.fill('.psearch .card .inp >> nth=0', 'e6'); await page.waitForTimeout(400);
  const res = async () => (await page.locator('.presult').innerText()).replace(/\n/g, ' ');
  console.log('B only selected (3):', await res(), '| history', await hlen(), '| url has search:', (await page.evaluate(() => location.hash)).slice(0, 60));
  await page.click('.search-opts label:has-text("Only selected") input'); await page.waitForTimeout(200);
  console.log('C all lines:', await res());
  await page.click('.search-opts label:has-text("Hide disabled") input'); await page.waitForTimeout(200);
  console.log('D hide disabled:', await res());
  await page.click('.view-tabs button:has-text("Boards")'); await page.waitForTimeout(300);
  console.log('E my-move boards:', (await page.locator('.bgroup').allInnerTexts()).join(' | '), '|', (await page.locator('.bcap').allInnerTexts()).slice(0, 2).join(' | '));
  console.log('  arrows on first board:', await page.locator('.bcell').first().locator('line').count());
  await page.locator('.bcell').first().screenshot({ path: 'test/38-mine.png' });
  // 2. refresh keeps the search
  const before = await page.evaluate(() => location.hash);
  await page.reload(); await page.waitForTimeout(800);
  console.log('F after refresh:', await where(), '| same address:', before === await page.evaluate(() => location.hash), '| moves box:', await page.locator('.psearch .card .inp >> nth=0').inputValue(), '| view:', await page.locator('.view-tabs .on').innerText());
  // 3. back -> library, forward -> search restored
  await page.goBack(); await page.waitForTimeout(400);
  console.log('G back:', await where());
  await page.goForward(); await page.waitForTimeout(600);
  console.log('H forward:', await where(), '| moves box:', await page.locator('.psearch .card .inp >> nth=0').inputValue());
  await page.goBack(); await page.waitForTimeout(300);
  // 4. settings and back
  await page.click('.top .icon'); await page.waitForTimeout(200);
  console.log('I settings:', await where());
  await page.click('.top .icon'); await page.waitForTimeout(300);
  console.log('J close settings (✕):', await where(), '| history', await hlen());
  // 5. training -> explore -> back -> training ; quit -> summary ; back -> library
  await page.click('text=All in order'); await page.waitForTimeout(1200);
  console.log('K training:', await where());
  await page.click('.trainer .icon-btn'); await page.waitForTimeout(400);
  console.log('L explore from training:', await where());
  await page.goBack(); await page.waitForTimeout(400);
  console.log('M back:', await where(), '| status:', await page.locator('.trainer .status').innerText());
  console.log('   history before quit:', await hlen());
  await page.click('.tbar .icon >> nth=0'); await page.waitForTimeout(400);
  console.log('N quit (nothing finished):', await where(), '| history', await hlen());

  await page.reload(); await page.waitForTimeout(500);
  console.log('P refresh:', await where());
  console.log('errors', errs); await browser.close();
})();
