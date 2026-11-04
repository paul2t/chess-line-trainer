// Settings show whether the lichess login can read private studies, with a button to allow it.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  let scopes = '';
  const reqs = [];
  await page.route('https://lichess.org/**', (r) => {
    const u = r.request().url(); reqs.push(r.request().method() + ' ' + u.replace('https://lichess.org', '') + (r.request().postData() ? ' body=' + r.request().postData() : ''));
    if (u.endsWith('/api/account')) return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"username":"paul2t"}' });
    if (u.endsWith('/api/token/test')) return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ [r.request().postData()]: { scopes, userId: 'paul2t' } }) });
    if (u.includes('/oauth?')) return r.fulfill({ status: 200, body: 'oauth page ' + new URL(u).searchParams.get('scope') });
    return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
  });
  await page.route('https://explorer.lichess.org/**', (r) => r.abort());
  await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('clt.lichess.token.v1', 'lio_old'); } });
  await page.goto('file://' + path.resolve('dist/index.html')); await page.waitForTimeout(500);
  await page.click('[aria-label="Settings"]'); await page.waitForTimeout(300);
  console.log('no scope:', await page.locator('.study-access').innerText());
  // study import dialog offers it too, and a 404 explains it
  await page.click('[aria-label="Settings"]'); await page.waitForTimeout(200);
  await page.click('.lib-head .btn.primary'); await page.click('text=Import a lichess study');
  await page.fill('.study-import .inp', 'Zzzzzzzz'); await page.click('text=Load study'); await page.waitForTimeout(300);
  console.log('dialog:', (await page.locator('.study-import').innerText()).replace(/\n/g, ' | '));
  await page.click('.study-import .btn:has-text("Cancel")');
  // with the scope
  scopes = 'study:read';
  await page.reload(); await page.waitForTimeout(500);
  await page.click('[aria-label="Settings"]'); await page.waitForTimeout(300);
  console.log('with scope:', await page.locator('.study-access').innerText());
  console.log(reqs.filter((x) => !x.includes('explorer')).join(' ; '));
  console.log('errors', errs); await b.close();
})();
