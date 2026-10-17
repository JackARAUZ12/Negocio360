import json,re,os
tk=open('tk_script.js').read()
head=tk[:tk.index('const M = JSON.parse')]
eng=tk[tk.index('window.EVENTS ='):]
body=open('tcx_body.js').read()
meta=json.load(open('xshots/meta.json'))
states=sorted({f[:-8] for f in os.listdir('xshots') if f.endswith('_top.jpg')})
head=re.sub(r"const DUR = [\d.]+;","const DUR = 343.38;",head)
head=re.sub(r"const STATES = \[.*?\];","const STATES = "+json.dumps(states)+";",head,flags=re.S)
head=re.sub(r"const _X = \[.*?\];\n","",head,flags=re.S)
head=head.replace("'cshots/' + s + '_top.jpg'","'xshots/' + s + '_top.jpg'")
a="function sl(a, b, r, title, text, n) { if (r[0] >= 600 && r[0] + r[2] <= 1330 && r[3] < 380) focus(a - .35, [600, r[1] + r[3] / 2 - 250, 720, 500], 1.75, 1.0, .55); spot(a, b, r); label(a + .12, b, r, title, text, n); }"
assert a in head; head=head.replace(a,"function sl(a, b, r, title, text, n) { spot(a, b, r); label(a + .12, b, r, title, text, n); }")
def R(x,y):
    global eng
    assert x in eng,x[:50]; eng=eng.replace(x,y)
R('<div class="ti" style="font-size:130px;margin-top:16px">Caja</div>','<div class="ti" style="font-size:120px;margin-top:16px">Cuentas por Pagar</div>')
R('<div class="ti" style="font-size:96px">Caja: el centro de tu negocio</div><div class="su" style="margin-top:30px">Cuánto tenés · Dónde está · A dónde fue</div><div class="su" style="margin-top:40px">Nos vemos en el próximo tutorial</div>',
  '<div class="ti" style="font-size:96px">Tus deudas con proveedores, al día</div><div class="su" style="margin-top:30px">Comprá al crédito · Pagá a tiempo · Todo conectado</div><div class="su" style="margin-top:40px;font-size:44px;color:#fff;font-weight:800">Próximo tutorial: Salarios</div>')
R("t < 268.4","t < 301.4")
open('tcx_script.js','w').write(head+'const M = '+json.dumps(meta)+';\n'+body+'\n'+eng)
open('tcx.html','w').write(open('tv_head.html').read()+'<script>'+open('tcx_script.js').read()+'</script></body></html>')
print('built',len(states))
