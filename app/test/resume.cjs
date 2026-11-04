// Coming back from the lichess login reopens the study import on "My studies".
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const reqs = [];
  await page.route('https://lichess.org/**', (r) => {
    const u = r.request().url(); reqs.push(r.request().method() + ' ' + u.replace('https://lichess.org', ''));
    const h = { 'Access-Control-Allow-Origin': '*' };
    if (u.endsWith('/api/token') && r.request().method() === 'POST') return r.fulfill({ status: 200, headers: h, body: '{"access_token":"lio_new"}' });
    if (u.endsWith('/api/account')) return r.fulfill({ status: 200, headers: h, body: '{"username":"paul2t"}' });
    if (u.endsWith('/api/token/test')) return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ lio_new: { scopes: 'study:read' } }) });
    if (u.includes('/api/study/by/paul2t')) return r.fulfill({ status: 200, headers: h, body: '{"id":"AbCdEfGh","name":"Caro-Kann Rep","updatedAt":1762000000000}\n{"id":"Qqqqqqqq","name":"Slav","updatedAt":1761000000000}\n' });
    return r.fulfill({ status: 404, headers: h, body: '' });
  });
  await page.route('https://explorer.lichess.org/**', (r) => r.abort());
  // state before the redirect to lichess (as login() leaves it)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', 1);
    localStorage.setItem('clt.lichess.pkce.v1', JSON.stringify({ verifier: 'v', state: 'S1' }));
    localStorage.setItem('clt.lichess.resume.v1', JSON.stringify({ kind: 'studies' }));
  });
  await page.goto('file://' + path.resolve('dist/index.html') + '?code=abc&state=S1'); await page.waitForTimeout(900);
  console.log('url:', page.url().split('/').pop());
  console.log('toast:', await page.locator('.toast').innerText().catch(() => '-'));
  console.log('dialog open:', await page.locator('.study-import').count(), '| list:', (await page.locator('.study-list .btn').allInnerTexts()).join(' || '));
  console.log('resume cleared:', await page.evaluate(() => localStorage.getItem('clt.lichess.resume.v1')));
  // back from settings: returns to settings
  await page.click('.study-import .btn:has-text("Cancel")');
  await page.evaluate(() => { localStorage.setItem('clt.lichess.pkce.v1', JSON.stringify({ verifier: 'v', state: 'S2' })); localStorage.setItem('clt.lichess.resume.v1', JSON.stringify({ kind: 'page', hash: '#settings' })); });
  await page.goto('file://' + path.resolve('dist/index.html') + '?code=abc&state=S2'); await page.waitForTimeout(900);
  console.log('settings resume:', await page.evaluate(() => location.hash), '| study access:', await page.locator('.study-access').innerText().catch(() => '-'));
  console.log(reqs.join(' ; '));
  console.log('errors', errs); await b.close();
})();
