const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path'), fs = require('fs');
const T = __dirname, REPO = process.env.REPO || '/home/user/Negocio360', deps = T + '/deps/node_modules';
async function openPage(browser, file, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: +(process.env.MW||430), height: +(process.env.MH||932) }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-NI', timezoneId: 'America/Managua' });
  await ctx.clock.install({ time: new Date('2026-10-10T10:24:00-06:00') });
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u.includes('supabase-js')) return route.fulfill({ body: fs.readFileSync(T + '/' + (process.env.FAKE || 'fake-supabase.js')), contentType: 'application/javascript' });
    if (u.includes('chart.js') || u.includes('chart.umd')) return route.fulfill({ body: fs.readFileSync(deps + '/chart.js/dist/chart.umd.js'), contentType: 'application/javascript' });
    if (u.includes('lucide')) return route.fulfill({ body: fs.readFileSync(deps + '/lucide/dist/umd/lucide.js'), contentType: 'application/javascript' });
    if (u.includes('fonts.googleapis.com/css')) return route.fulfill({ body: fs.readFileSync(T + '/fonts.css'), contentType: 'text/css' });
    if (u.startsWith('http://local.test/')) {
      const p = path.join(REPO, decodeURIComponent(new URL(u).pathname));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) { const ext = path.extname(p); return route.fulfill({ body: fs.readFileSync(p), contentType: { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream' }); }
      return route.fulfill({ status: 404, body: '' });
    }
    console.log('BLOCKED', u.slice(0, 90));
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#tm-ayuda-flotante,#pg-switch-btn,#pg-notif-badge{display:none!important}'; document.head.appendChild(s); }); });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', file, e.message.slice(0, 120)));
  await page.goto('http://local.test/' + file);
  await page.waitForTimeout(opts.wait || 5000);
  return page;
}
module.exports = { openPage };
if (require.main === module) (async () => {
  const b = await chromium.launch();
  for (const f of process.argv.slice(2)) { const pg = await openPage(b, f); await pg.screenshot({ path: T + '/m_' + f.replace('.html', '') + '.png', fullPage: true }); console.log('ok', f, pg.url()); await pg.context().close(); }
  await b.close();
})();
