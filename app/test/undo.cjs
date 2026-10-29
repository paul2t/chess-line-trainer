// Records every board FEN chessground is given during an undo: must go straight to the target, never via the start position.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  await page.click('text=Find & explore lines'); await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) { await page.click('.xrow .chip.mine'); await page.waitForTimeout(150); }
  const fenOf = () => page.evaluate(() => [...document.querySelectorAll('cg-board piece')].length + ' pieces');
  // observe piece DOM mutations during undo: count how many times a piece appears on its initial square e2
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => {
      const b = document.querySelector('cg-board');
      const g1 = [...b.querySelectorAll('piece.white.knight')].some((p) => p.cgKey === 'g1');
      window.__seen.push(g1 ? 'KNIGHT BACK ON g1' : 'ok');
    }).observe(document.querySelector('cg-board'), { childList: true, subtree: true, attributes: true });
  });
  await page.click('.phist .btn >> nth=0'); await page.waitForTimeout(40);
  console.log('pieces animating right after undo:', await page.evaluate(() => document.querySelectorAll('cg-board piece.anim').length));
  await page.waitForTimeout(600);
  console.log('crumbs after undo:', (await page.locator('.crumbs').innerText()).replace(/\n/g, ' '));
  await browser.close();
})();
