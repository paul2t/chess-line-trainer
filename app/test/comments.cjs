const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('https://explorer.lichess.org/**', (r) => r.abort());
  await page.goto('file://' + path.resolve('dist/index.html'));
  const t = async (sel) => (await page.locator(sel).allInnerTexts()).map((x) => x.replace(/\n+/g, ' ⏎ ')).join(' || ');
  await page.setInputFiles('input[type=file]', 'test/fantasy.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  await page.setInputFiles('input[type=file]', 'test/caro.pgn'); await page.waitForSelector('.modal');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary'); await page.waitForTimeout(300);
  console.log('stored comments:', await page.evaluate(() => JSON.parse(localStorage.getItem('clt.chapters.v2'))[0].lines.map((l) => Object.keys(l.comments || {}).length).join(',')));
  // select two lines of the other chapter (caro), then explore a Fantasy line (not selected)
  const caro = page.locator('.card.file', { hasText: 'caro' });
  if (!(await caro.locator('.lrow').count())) await caro.locator('.fmain').click(); await page.waitForTimeout(100);
  await caro.locator('.lrow .cb').nth(0).click(); await caro.locator('.lrow .cb').nth(1).click();
  const fan = page.locator('.card.file', { hasText: 'Fantasy' }).first();
  if (!(await fan.locator('.lrow').count())) await fan.locator('.fmain').click(); await page.waitForTimeout(100);
  await fan.locator('.lrow .dots').nth(1).click(); await page.click('text=Explore this line'); await page.waitForTimeout(500);
  console.log('focus bar:', await t('.focusbar'), '| cursor crumb:', await t('.crumb.cur'), '| future crumbs:', await page.locator('.crumb.future').count());
  console.log('explorer at start:', await t('.explorer .xrow'));
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  console.log('after 5 →:', await t('.crumb.cur'), '| comment:', (await t('.xcomment')).slice(0, 160));
  console.log('order (explorer before comment):', await page.evaluate(() => { const x = document.querySelector('.psearch .explorer'), c = document.querySelector('.xcomment'); return !!x && !!c && !!(x.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  console.log('clamped:', await page.locator('.xcomment .clamp').count(), '| h:', Math.round((await page.locator('.xcomment').boundingBox()).height));
  await page.click('.xcomment'); await page.waitForTimeout(100);
  console.log('expanded:', await page.locator('.xcomment .clamp').count(), '| h:', Math.round((await page.locator('.xcomment').boundingBox()).height), '|', await t('.xcomment .more'));
  await page.screenshot({ path: 'test/46-comment.png' });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  console.log('after 6 →:', await t('.crumb.cur'), '| comment:', (await t('.xcomment')).slice(0, 120));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  console.log('7th (4.c3):', await t('.crumb.cur'), '|', (await t('.xcomment')).slice(0, 100));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Home'); await page.waitForTimeout(150);
  console.log('← Home:', await t('.crumb.cur'));
  await page.keyboard.press('End'); await page.waitForTimeout(150);
  console.log('End:', await t('.crumb.cur'), '| explorer rows:', await page.locator('.explorer .xrow').count());
  // url keeps the focus
  console.log('url has fl:', await page.evaluate(() => location.hash.includes('fl=')));
  await page.reload(); await page.waitForTimeout(500);
  console.log('after reload focus:', await t('.focusbar'));
  await page.screenshot({ path: 'test/45-explore-line.png', fullPage: false });
  // trainer keeps both comments
  await page.goto('file://' + path.resolve('dist/index.html')); await page.waitForTimeout(300);
  await page.click('.selbar .btn:has-text("Clear")').catch(() => {});
  const fan2 = page.locator('.card.file', { hasText: 'Fantasy' }).first();
  if (!(await fan2.locator('.lrow').count())) await fan2.locator('.fmain').click();
  await fan2.locator('.lrow .cb').nth(0).click();
  await page.click('text=All in order'); await page.waitForTimeout(1500);
  const sq = async (k) => { const bb = await page.locator('.trainer cg-board').boundingBox(); const f = k.charCodeAt(0) - 97, r = +k[1], s = bb.width / 8; return { x: bb.x + (7 - f + 0.5) * s, y: bb.y + (r - 0.5) * s }; };
  for (const u of ['c7c6', 'd7d5']) { const a = await sq(u.slice(0, 2)), c = await sq(u.slice(2, 4)); await page.mouse.click(a.x, a.y); await page.mouse.click(c.x, c.y); await page.waitForTimeout(900); }
  console.log('hidden by default:', await page.locator('.trainer .comment').count(), '| button:', await t('.comments-toggle'));
  await page.click('.comments-toggle'); await page.waitForTimeout(100);
  console.log('trainer after 3.f3:', (await t('.trainer .comment')).slice(0, 100), '| button:', await t('.comments-toggle'));
  const a = await sq('e7'), c = await sq('e5'); await page.mouse.click(a.x, a.y); await page.mouse.click(c.x, c.y); await page.waitForTimeout(1200);
  console.log('trainer after ...e5 and reply:', (await t('.trainer .comment')).slice(0, 260));
  console.log('errors', errs); await b.close();
})();
