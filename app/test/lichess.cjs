// Fakes lichess (OAuth token exchange, account, explorer) to test the integration end to end.
const { chromium } = require('playwright'); const path = require('path');
const { Chess } = require('chess.js');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const calls = { explorer: 0, token: 0, auth: [] };
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  await ctx.route('https://lichess.org/api/token', async (r) => { calls.token++; await r.fulfill({ headers: cors, body: JSON.stringify({ access_token: 'lio_FAKE', expires_in: 3e7 }) }); });
  await ctx.route('https://lichess.org/api/account', (r) => r.fulfill({ headers: cors, body: JSON.stringify({ username: 'paul2t' }) }));
  await ctx.route('https://explorer.lichess.org/**', async (r) => {
    calls.explorer++;
    const u = new URL(r.request().url());
    calls.auth.push(r.request().headers()['authorization']);
    const c = new Chess(u.searchParams.get('fen'));
    // deterministic fake popularity: a pseudo-random weight per move
    let total = 0;
    const moves = c.moves({ verbose: true }).map((m) => {
      let h = 0; for (const ch of c.fen().split(' ')[0] + m.from + m.to) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const n = 50 + (h % 3000);
      total += n; return { uci: m.from + m.to, san: m.san, white: Math.floor(n / 2), draws: 0, black: n - Math.floor(n / 2) };
    }).sort((a, b) => b.white + b.black - a.white - a.black);
    await r.fulfill({ headers: cors, body: JSON.stringify({ white: Math.floor(total / 2), draws: 0, black: total - Math.floor(total / 2), moves }) });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const url = 'file://' + path.resolve('dist/index.html');
  await page.goto(url);
  await page.evaluate(() => { localStorage.setItem('clt.settings.v1', JSON.stringify({ missingThreshold: 3 })); localStorage.setItem('clt.test.gap', '30'); localStorage.setItem('clt.lichess.pkce.v1', JSON.stringify({ verifier: 'v', state: 'S1' })); });
  await page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await page.click('.pend-block .seg button:has-text("Black")'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(3800);
  // come back from lichess OAuth with a code
  await page.goto(url + '?code=abc&state=S1');
  await page.waitForTimeout(1500);
  console.log('toast:', await page.locator('.toast').innerText().catch(() => '-'), '| url cleaned:', !page.url().includes('code='), '| token calls:', calls.token);
  await page.waitForTimeout(9000);
  console.log('explorer calls:', calls.explorer, '| auth header ok:', calls.auth.every((a) => a === 'Bearer lio_FAKE'));
  await page.click('.top .icon'); await page.waitForTimeout(200);
  console.log('settings:', (await page.locator('section:has-text("Lichess statistics")').innerText()).split('\n').filter(Boolean).slice(1, 5).join(' | '));
  await page.click('.top .icon'); await page.waitForTimeout(200);
  console.log('smart:', (await page.locator('.train-card .btn.primary').innerText()).replace(/\n/g, ' '));
  console.log('missing card:', (await page.locator('.misscard .warnhead').innerText().catch(() => 'none')).replace(/\n/g, ' '));
  await page.click('.misscard .warnhead').catch(() => {}); await page.waitForTimeout(200);
  console.log('first missing:', (await page.locator('.misscard .conf').first().innerText().catch(() => '-')).replace(/\n/g, ' '));
  await page.click('.fmain'); await page.waitForTimeout(200);
  console.log('line games:', (await page.locator('.library .lstat .gcount').allInnerTexts()).join(', '));
  await page.screenshot({ path: 'test/27-lib.png', fullPage: true });
  await page.click('.misscard >> text=Open in explorer'); await page.waitForTimeout(500);
  console.log('explorer here:', await page.locator('.lichess-here').innerText(), '|', (await page.locator('.explorer').innerText()).replace(/\n/g, ' ').slice(0, 260));
  await page.screenshot({ path: 'test/28-explorer.png', fullPage: true });
  // change settings -> refetch
  const before = calls.explorer;
  await page.click('.tbar .icon'); await page.click('.top .icon'); await page.click('.chips .chip:has-text("Bullet")'); await page.waitForTimeout(4500);
  console.log('refetch after settings change:', calls.explorer - before);
  console.log('errors', errs); await browser.close();
})();
