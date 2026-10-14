import { chromium } from 'playwright';
const pages = process.argv.slice(2);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now()/1000)+86400*30;
const user = { id:'00000000-0000-4000-8000-000000000360', aud:'authenticated', role:'authenticated', email:'demo@negocio360.app', app_metadata:{provider:'email'}, user_metadata:{}, created_at:'2026-01-01T00:00:00Z' };
const jwt = b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,exp,role:'authenticated',email:user.email,aud:'authenticated'})+'.sig';
const session = { access_token: jwt, token_type:'bearer', expires_in:86400*30, expires_at:exp, refresh_token:'r', user };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' in {} ? undefined : undefined });
const ctx = await browser.newContext({ viewport:{width:390,height:693}, deviceScaleFactor: 1080/390, isMobile:true, hasTouch:true, locale:'es-NI' });
await ctx.addInitScript(([s,u]) => { localStorage.setItem('sb-zvlincmqmmoclqhykejv-auth-token', s); sessionStorage.setItem('n360_perfil_activo', JSON.stringify({authUserId:u, id:'p1', nombre:'Admin', tipo:'admin', modulos:[]})); localStorage.setItem('n360_bienvenida_vista','1'); }, [JSON.stringify(session), user.id]);
const log = [];
await ctx.route(/supabase\.co/, async route => {
  const u = route.request().url();
  log.push(route.request().method()+' '+u.replace(/^https:\/\/[^/]+/,'').slice(0,140));
  if (u.includes('/auth/v1/user')) return route.fulfill({ json: user });
  if (u.includes('/auth/v1/')) return route.fulfill({ json: session });
  if (u.includes('/rest/v1/tutoriales_vistos')) return route.fulfill({ json: [{auth_user_id:user.id, modulo_key:'x', visto_en:'2026-01-01T00:00:00Z'}] });
  const acc = route.request().headers()['accept']||'';
  if (acc.includes('vnd.pgrst.object')) return route.fulfill({ status:406, json:{code:'PGRST116',message:'none'} });
  return route.fulfill({ json: [], headers:{'content-range':'0-0/0'} });
});
for (const p of pages) {
  const page = await ctx.newPage();
  page.on('pageerror', e => log.push('ERR '+p+': '+e.message.slice(0,150)));
  await page.goto('http://localhost:8765/'+p, { waitUntil:'networkidle' }).catch(e=>log.push('nav '+e.message));
  await page.waitForTimeout(2500);
  for (const txt of ['Saltar']) { const b = page.getByText(txt, {exact:true}).first(); if (await b.isVisible().catch(()=>false)) { await b.click().catch(()=>{}); await page.waitForTimeout(2500); } }
  await page.evaluate(()=>{ window.scrollTo(0,0);
    for (const el of document.querySelectorAll('body *')) { const cs=getComputedStyle(el); if (cs.position==='fixed' && el.textContent.includes('Bienvenido a Caja')) el.style.display='none'; }
    for (const el of document.querySelectorAll('body *')) { const cs=getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter!=='none' && cs.position==='fixed' && el.offsetHeight>500) el.style.display='none'; }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui/'+p.replace(/[^a-z0-9]/gi,'_')+'.png' });
  await page.screenshot({ path: 'ui/full_'+p.replace(/[^a-z0-9]/gi,'_')+'.png', fullPage:true });
  log.push('URL '+p+' -> '+page.url());
  await page.close();
}
console.log(log.filter(l=>l.startsWith('URL')||l.startsWith('ERR')).join('\n'));
await browser.close();
