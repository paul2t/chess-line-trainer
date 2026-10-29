const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })).newPage();
  await page.goto('file://' + path.resolve('dist/index.html'));
  await page.click('.top .icon'); await page.waitForTimeout(200);
  const shots = [];
  for (const [b, p] of [['Blue 3', 'Cburnett'], ['Wood 4', 'California'], ['Green', 'Pirouetti']]) {
    await page.click(`.theme-pick:has-text("${b}")`); await page.click(`.theme-pick:has-text("${p}")`); await page.waitForTimeout(150);
    const f = `test/prev-${p}.png`; await page.locator('.mini-board').screenshot({ path: f }); shots.push(f);
    // check: each img box equals one quarter-width / half-height cell
    const box = await page.locator('.mini-board').boundingBox();
    const cells = await page.locator('.mini-board img').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    const ok = cells.every(([x, y, w, h], i) => Math.abs(x - (box.x + (i % 4) * box.width / 4)) < 1 && Math.abs(y - (box.y + Math.floor(i / 4) * box.height / 2)) < 1 && Math.abs(w - box.width / 4) < 1 && Math.abs(h - box.height / 2) < 1);
    console.log(p, 'aligned to squares:', ok);
  }
  await browser.close();
  const { execSync } = require('child_process');
  execSync(`python3 -c "from PIL import Image; ims=[Image.open(f) for f in ${JSON.stringify(shots)}]; w=sum(i.width for i in ims)+20; o=Image.new('RGB',(w,ims[0].height),'#16181c'); x=0
for i in ims: o.paste(i,(x,0)); x+=i.width+10
o.save('test/22-previews.png')"`);
})();
