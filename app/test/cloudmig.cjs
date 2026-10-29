const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const old = JSON.parse(fs.readFileSync('test/old-state.json', 'utf8'));
  const store = {};
  const P = 'data/users/u_test/';
  // old v1 cloud documents: PGN file + chunks, stats shards, meta
  for (const f of old['clt.files.v1']) {
    const CH = 60000, n = Math.max(1, Math.ceil(f.text.length / CH));
    store[P + 'f_' + f.id] = JSON.stringify({ id: f.id, name: f.name, added: f.added, updated: f.updated, color: f.color, colors: f.colors, chunks: n });
    for (let i = 0; i < n; i++) store[P + `c_${f.id}_${i}`] = JSON.stringify({ t: f.text.slice(i * CH, (i + 1) * CH) });
  }
  const shards = {};
  for (const [id, st] of Object.entries(old['clt.stats.v1'])) (shards['s_' + id[0]] ??= {})[id] = st;
  for (const [k, v] of Object.entries(shards)) store[P + k] = JSON.stringify({ stats: v });
  store[P + 'meta'] = JSON.stringify({ settings: old['clt.settings.v1'], selection: old['clt.selection.v1'], disabled: old['clt.disabled.v1'], deletedFiles: {}, updated: Date.now() - 1000 });
  const before = JSON.stringify(Object.fromEntries(Object.entries(store).filter(([k]) => /\/[fc]_/.test(k))));
  const browser = await browser_();
  async function browser_() { return chromium.launch(); }
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
  await page.waitForTimeout(4000);
  console.log('status:', await page.locator('.cloud').innerText());
  console.log('chapters:', (await page.locator('.fname').allInnerTexts()).join(' | '), '|', (await page.locator('.fmeta').allInnerTexts()).join(' | '));
  const keys = Object.keys(store).map((k) => k.slice(P.length));
  console.log('server docs:', keys.sort().join(' '));
  const after = JSON.stringify(Object.fromEntries(Object.entries(store).filter(([k]) => /\/[fc]_/.test(k))));
  console.log('old f_/c_ documents untouched:', before === after);
  const h = Object.entries(store).filter(([k]) => /\/l_/.test(k)).map(([, v]) => JSON.parse(v).t).join('');
  console.log('lines stored in new docs:', h.length > 0);
  // a second fresh device reads the new format
  const page2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page2.context().exposeBinding('__dbGet', (_, prefix) => Object.entries(store).filter(([k]) => k.startsWith(prefix + '/') && k.slice(prefix.length + 1).indexOf('/') < 0).map(([k, v]) => [k.slice(prefix.length + 1), v]));
  await page2.context().exposeBinding('__dbSet', (_, p, v) => { store[p] = v; });
  await page2.context().exposeBinding('__dbDel', (_, p) => { delete store[p]; });
  await page2.context().addInitScript(() => {
    const mkcol = (path) => ({
      doc: (id) => ({ set: async (d) => window.__dbSet(path + '/' + id, JSON.stringify(d)), delete: async () => window.__dbDel(path + '/' + id) }),
      get: async () => ({ docs: (await window.__dbGet(path)).map(([id, v]) => ({ id, exists: true, data: () => JSON.parse(v) })) }),
    });
    setTimeout(() => { window.claude = { use: async (n) => n === 'db' ? { collection: mkcol } : n === 'user' ? { id: async () => 'u_test' } : null }; }, 300);
  });
  await page2.goto('file://' + path.resolve('dist/index.html'));
  await page2.waitForTimeout(3500);
  console.log('device 2:', (await page2.locator('.fname').allInnerTexts()).join(' | '), '|', (await page2.locator('.train-card .scope').innerText()));
  console.log('errors', errs); await browser.close();
})();
