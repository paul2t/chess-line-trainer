// Simulates the claude.ai runtime with an in-memory db shared across two "devices" (browser contexts).
const { chromium } = require('playwright'); const path = require('path');
const store = {}; // docPath -> json
(async () => {
  const browser = await chromium.launch();
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.exposeBinding('__dbGet', (_, prefix) => Object.entries(store).filter(([k]) => k.startsWith(prefix + '/') && k.slice(prefix.length + 1).indexOf('/') < 0).map(([k, v]) => [k.slice(prefix.length + 1), v]));
    await ctx.exposeBinding('__dbSet', (_, p, v) => { store[p] = v; });
    await ctx.exposeBinding('__dbDel', (_, p) => { delete store[p]; });
    await ctx.addInitScript(() => {
      const mkcol = (path) => ({
        doc: (id) => ({ set: async (d) => window.__dbSet(path + '/' + id, JSON.stringify(d)), delete: async () => window.__dbDel(path + '/' + id) }),
        get: async () => ({ docs: (await window.__dbGet(path)).map(([id, v]) => ({ id, exists: true, data: () => JSON.parse(v) })) }),
      });
      setTimeout(() => { window.claude = { use: async (n) => n === 'db' ? { collection: mkcol } : n === 'user' ? { id: async () => 'u_test' } : null }; }, 300);
    });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.resolve('dist/index.html'));
    return { page, errs };
  }
  const A = await device('A');
  await A.page.waitForTimeout(800);
  console.log('A status:', await A.page.locator('.cloud').innerText());
  await A.page.setInputFiles('input[type=file]', 'test/sample.pgn');
  await A.page.click('.seg button:has-text("Black")'); await A.page.click('.modal .btn.primary');
  // train one line with a mistake via "Show move"
  await A.page.click('.train-card .btn.primary'); await A.page.waitForTimeout(1000);
  await A.page.click('.tbtns .btn >> nth=1'); // show move (mistake)
  const sq = async (k) => { const b = await A.page.locator('cg-board').boundingBox(); const f=k.charCodeAt(0)-97, r=+k[1], s=b.width/8; return { x:b.x+(7-f+0.5)*s, y:b.y+(r-0.5)*s }; };
  for (const u of ['c7c5','d7d6','c5d4','g8f6','a7a6','e7e5','c8e6']) { const a=await sq(u.slice(0,2)), c=await sq(u.slice(2,4)); await A.page.mouse.click(a.x,a.y); await A.page.mouse.click(c.x,c.y); await A.page.waitForTimeout(900); }
  await A.page.click('.tbar .icon >> nth=0'); await A.page.waitForTimeout(300);
  if (await A.page.locator('.summary').count()) await A.page.click('.summary .btn.primary');
  await A.page.waitForTimeout(300);
  // set theme in settings
  await A.page.click('.top .icon'); await A.page.click('.theme-pick:has-text("Brown")');
  await A.page.waitForTimeout(2500);
  console.log('A status after:', await A.page.locator('.cloud').innerText());
  console.log('server docs:', Object.keys(store).map(k => k.split('/').pop() + ':' + store[k].length).join(' '));
  // device B: fresh browser storage
  const B = await device('B');
  await B.page.waitForTimeout(1500);
  console.log('B status:', await B.page.locator('.cloud').innerText());
  console.log('B library:', (await B.page.locator('.file .fmeta').first().innerText()));
  await B.page.click('.top .icon');
  await B.page.click('.fmain'); console.log('B first line stat:', await B.page.locator('.lstat').first().innerText());
  console.log('B theme selected:', await B.page.locator('.theme-pick.on').innerText());
  // delete file on B -> server should drop file docs
  await B.page.click('.top .icon'); await B.page.click('.fmain'); await B.page.click('.file-actions .btn.danger');
  await B.page.click('.modal .btn.danger'); await B.page.waitForTimeout(2500);
  console.log('server docs after delete:', Object.keys(store).map(k => k.split('/').pop()).join(' '));
  // A reloads -> file should be gone
  await A.page.reload(); await A.page.waitForTimeout(1500);
  console.log('A files after reload:', await A.page.locator('.file').count());
  console.log('errors', A.errs, B.errs);
  await browser.close();
})();
