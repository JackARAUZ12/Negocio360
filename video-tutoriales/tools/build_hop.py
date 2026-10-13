head=open('_hop_head.txt').read(); mid=open('_hop_mid.txt').read(); tail=open('_hop_tail.txt').read()
rep=[("R.style.opacity = t < 6 ? (t < 4 ? .9 : .9 * (1 - p(t, 4, 5))) : 0;","R.style.opacity = 0;"),
("const at = [46.7, 47.6, 48.6][i];","const at = [48.7, 49.6, 50.6][i];"),("[47.4, 48.5, 49.2][i]","[49.4, 50.5, 51.2][i]"),
("const ta = 49.1; if (t > 48.3 && t < 49.8)","const ta = 51.1; if (t > 50.3 && t < 51.8)"),("p(t, 48.3, 48.9)","p(t, 50.3, 50.9)"),("p(t, 48.3, 48.5)) * (1 - p(t, 49.5, 49.8))","p(t, 50.3, 50.5)) * (1 - p(t, 51.5, 51.8))"),
("p(t, 54.2, 54.9)","p(t, 55.2, 55.9)"),("p(t, 54.8, 55.4)","p(t, 55.8, 56.4)"),("p(t, 55.6, 56.2)","p(t, 56.6, 57.2)"),("if (t < 54) {","if (t < 55) {"),
("const light = t >= 6 && t < 54;","const light = t >= 6 && t < 55;"),("$('segs').style.opacity = t >= 10 && t < 46 ? 1 : 0;","$('segs').style.opacity = t >= 9 && t < 48 ? 1 : 0;"),
("b.style.width = (p(t, 10 + i * 3, 13 + i * 3) * 100) + '%';","b.style.width = (p(t, FEATS[i][0], FEATS[i][0] + FEATS[i][1]) * 100) + '%';"),
("const fi = Math.floor((t - 10) / 3); $('bnum').textContent = t >= 10 && t < 46 ? String(fi + 1).padStart(2, '0') : ''; $('bnum').style.opacity = t >= 10 && t < 46 ? ease(p(t, 10 + fi * 3, 10.4 + fi * 3)) : 0;",
 "let fi = -1; FEATS.forEach((f, i) => { if (t >= f[0]) fi = i; }); $('bnum').textContent = fi >= 0 && t < 48 ? String(fi + 1).padStart(2, '0') : ''; $('bnum').style.opacity = fi >= 0 && t < 48 ? ease(p(t, FEATS[fi][0], FEATS[fi][0] + .4)) : 0;"),
("const kan = META.d_kanban.kan;","const kan = META.d_mapa.tabla;"),("url(htx/d_kanban.jpg)","url(htx/d_mapa.jpg)"),
("rotate(${lerp(14, 5, ex(k))}deg)`;","rotate(${lerp(10, 2, ex(k))}deg)`;")]
for a,b in rep:
    assert a in tail, a[:60]; tail=tail.replace(a,b)
keyjs='''
{ const R0 = window.render; window.render = t => { R0(t);
  const K2 = $('key'); const k = p(t, 2.0, 2.6), ko = p(t, 4.2, 4.6); K2.style.opacity = ease(k) * (1 - ko);
  K2.style.transform = `translateY(${lerp(1300, 1180, ex(k))}px) perspective(1600px) rotateX(${lerp(40, 12, ex(k))}deg) rotateY(${Math.sin(t * 1.4) * 10}deg) rotateZ(-6deg)`;
  K2.querySelector('.shine').style.left = lerp(-200, 800, p(t, 2.4, 3.6)) + 'px';
  $('cyc').style.top = '860px'; } }
'''
i=tail.index('</script>'); tail=tail[:i]+keyjs+tail[i:]
html=head+mid+tail
open('hop.html','w').write(html)
m=open('htx/meta.json').read()
open('hop_b.html','w').write(html.replace('<body>','<body><script>window.META='+m+';</script>',1))
print('built')
