const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { spawn } = require('child_process');
(async () => {
  const [, , mode, a, b, out] = process.argv;
  const fps = 30;
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1080, height: 1920 } });
  pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.goto('file://' + __dirname + '/tutp_b.html');
  await pg.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
  await pg.waitForTimeout(800);
  if (mode === 'info') { console.log(JSON.stringify(await pg.evaluate(() => window.EVENTS))); await br.close(); return; }
  if (mode === 'stills') {
    for (const t of a.split(',')) { await pg.evaluate(t => render(t), +t); await pg.waitForTimeout(50); await pg.screenshot({ path: `tu_st_${t}.jpg`, type: 'jpeg', quality: 85 }); }
    await br.close(); return;
  }
  const f0 = +a, f1 = +b;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', '-r', '30', out], { stdio: ['pipe', 'ignore', 'inherit'] });
  for (let i = f0; i < f1; i++) {
    await pg.evaluate(t => render(t), i / fps);
    const buf = await pg.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await br.close();
})();
