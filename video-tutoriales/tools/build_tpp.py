import json,re,os
tk=open('tk_script.js').read()
head=tk[:tk.index('const M = JSON.parse')]
eng=tk[tk.index('window.EVENTS ='):]
body=open('tpp_body.js').read()+"\nfunction hubHTML(){return ''}\nfunction hubFrame(){}\n"
meta=json.load(open('nshots/meta.json'))
states=sorted({f[:-8] for f in os.listdir('nshots') if f.endswith('_top.jpg')})
head=re.sub(r"const DUR = [\d.]+;","const DUR = 177.5;",head)
head=re.sub(r"const STATES = \[.*?\];","const STATES = "+json.dumps(states)+";",head,flags=re.S)
head=re.sub(r"const _X = \[.*?\];\n","",head,flags=re.S)
head=head.replace("'cshots/' + s + '_top.jpg'","'nshots/' + s + '_top.jpg'").replace("const ST = [{ t: 0, s: 'base' }]","const ST = [{ t: 0, s: 'r1' }]")
a="function sl(a, b, r, title, text, n) { if (r[0] >= 600 && r[0] + r[2] <= 1330 && r[3] < 380) focus(a - .35, [600, r[1] + r[3] / 2 - 250, 720, 500], 1.75, 1.0, .55); spot(a, b, r); label(a + .12, b, r, title, text, n); }"
assert a in head; head=head.replace(a,"function sl(a, b, r, title, text, n) { spot(a, b, r); label(a + .12, b, r, title, text, n); }")
def R(x,y):
    global eng
    assert x in eng,x[:60]; eng=eng.replace(x,y)
R("window.EVENTS = { DUR, clicks: CLICKS,","window.EVENTS = { DUR, keys: KEYS, pops: WA_POP, tap: WA_T.tap, xrows: XROWS.map((_, i) => XLS_T.rows0 + i * XLS_T.rowDt), xsave: XLS_T.save, clicks: CLICKS,")
R("if (cd.type === 'hub') CE.innerHTML = hubHTML();","if (cd.type === 'hub') CE.innerHTML = hubHTML(); else if (cd.type === 'scene') CE.innerHTML = '';")
R('<div class="ti" style="font-size:130px;margin-top:16px">Caja</div>','<div class="ti" style="font-size:130px;margin-top:16px">Primeros pasos</div><div class="su" style="font-size:34px">Del código por WhatsApp a tu inventario listo</div>')
R('<div class="ti" style="font-size:96px">Caja: el centro de tu negocio</div><div class="su" style="margin-top:30px">Cuánto tenés · Dónde está · A dónde fue</div><div class="su" style="margin-top:40px">Nos vemos en el próximo tutorial</div>',
  '<div class="ti" style="font-size:110px">¡Listo para vender! 🎉</div><div class="su" style="margin-top:30px">Código → Cuenta → Personalización → Caja → Inventario</div><div class="su" style="margin-top:40px;font-size:40px;color:#fff;font-weight:800">Tu siguiente paso: tu primera venta</div>')
R("t < 268.4","t < 170.6")
R("render(0);","const _render = window.render; window.render = function (t) { _render(t); sceneFrame(t); typeFrame(t); };\nrender(0);")
open('tpp_script.js','w').write(head+'const M = '+json.dumps(meta)+';\n'+body+'\n'+eng)
open('tpp.html','w').write(open('tv_head.html').read()+'<script>'+open('tpp_script.js').read()+'</script></body></html>')
print('built',len(states))
