const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const dir = __dirname, times = process.argv.slice(2).map(Number);
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] }); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => console.log('LOG', m.text()));
  await p.goto('file://' + path.join(dir, 'index.html')); await p.evaluate(a => setAudio(a), JSON.parse(fs.readFileSync(path.join(dir, 'audio.json'))));
  await p.evaluate(() => window.ready);
  for (const t of times) { await p.evaluate(t => render(t), t); await p.screenshot({ path: path.join(dir, `snap_${t}.jpg`), type: 'jpeg', quality: 80 }); }
  await b.close();
})();
