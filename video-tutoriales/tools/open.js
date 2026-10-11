// Abre el dashboard real con datos simulados. Exporta openDash(browser) -> page
const path = require('path'), fs = require('fs');
const T = __dirname, REPO = '/home/user/Negocio360';
const deps = T + '/deps/node_modules';
async function openDash(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: opts.dpr || 2, locale: 'es-NI', timezoneId: 'America/Managua' });
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u.includes('supabase-js')) return route.fulfill({ body: fs.readFileSync(T + '/fake-supabase.js'), contentType: 'application/javascript' });
    if (u.includes('chart.js') || u.includes('chart.umd')) return route.fulfill({ body: fs.readFileSync(deps + '/chart.js/dist/chart.umd.js'), contentType: 'application/javascript' });
    if (u.includes('lucide')) return route.fulfill({ body: fs.readFileSync(deps + '/lucide/dist/umd/lucide.js'), contentType: 'application/javascript' });
    if (u.includes('fonts.googleapis.com/css')) return route.fulfill({ body: fs.readFileSync(T + '/fonts.css'), contentType: 'text/css' });
    if (u.startsWith('http://local.test/')) {
      const p = path.join(REPO, decodeURIComponent(new URL(u).pathname));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.extname(p); const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
        return route.fulfill({ body: fs.readFileSync(p), contentType: ct });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.clock.install({ time: new Date('2026-10-10T10:24:00-06:00') });
  if (opts.clean) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#tm-ayuda-flotante,#pg-switch-btn,#pg-notif-badge{display:none!important}'; document.head.appendChild(s); }); });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.addStyleTag && 0;
  await page.goto('http://local.test/' + (opts.file || 'dashboard.html'));
  await page.waitForTimeout(opts.wait || 4500);
  return page;
}
module.exports = { openDash };
if (require.main === module) (async () => {
  const { chromium } = require('/opt/node-tools/node_modules/playwright');
  const b = await chromium.launch(); const pg = await openDash(b, { dpr: 1 });
  await pg.screenshot({ path: T + '/shot_top.png' });
  await pg.screenshot({ path: T + '/shot_full.png', fullPage: true });
  await b.close();
})();
