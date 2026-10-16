const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pg.goto('file://' + __dirname + '/tk.html'); await pg.waitForTimeout(800);
  for (const [k, n] of [['dashboard', 'Dashboard'], ['ventas', 'Ventas'], ['productos', 'Productos'], ['clientes', 'Clientes'], ['compras', 'Compras'], ['gastos', 'Gastos'], ['caja', 'Caja']]) {
    await pg.evaluate(n => { render(5); const c = document.getElementById('card'); const l = c.querySelector('.list'); if (l) l.remove(); c.querySelector('.ti').textContent = n; c.querySelector('.ti').style.fontSize = '190px'; }, n);
    await pg.screenshot({ path: `tut/th_${k}.jpg`, type: 'jpeg', quality: 85 });
  }
  await b.close();
})();
