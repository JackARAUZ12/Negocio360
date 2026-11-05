const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8791/video.html'); await p.evaluate(() => window.ready);
  for (const t of process.argv.slice(2)) { await p.evaluate(t => render(t), +t); await p.screenshot({ path: `${__dirname}/v_${t}.jpg`, type: 'jpeg', quality: 80 }); }
  await b.close();
})();
