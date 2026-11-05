# Guía rápida de uso de Negocio360 (16:9, ~2:46)

Video sin voz que enseña a USAR el sistema (no los módulos): iniciar sesión, elegir tu usuario
con su código, conocer la pantalla (menú, buscar módulo, fecha, moneda, modo noche,
configuración, resumen, "tu nombre · cambiar", ayuda "?"), moverse entre módulos, modo noche,
Configuración (pide el código del administrador), cambiar de usuario, todo en el celular y la ayuda.

Las pantallas son las páginas REALES del repo abiertas con la base simulada de las pruebas
(`clinica/pruebas/supabase-simulado.js`) y datos de ejemplo de "Tienda La Esperanza".

## Regenerar
```bash
cd video-guia-uso
mkdir -p vendor && curl -sS -o vendor/lucide.js https://unpkg.com/lucide@0.460.0/dist/umd/lucide.js
curl -sS -o vendor/chart.js https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
cp ../video-tutorial-multiusuario/site/fonts/*.woff2 vendor/ && sed 's#fonts/#/__v/#g' ../video-tutorial-multiusuario/site/fonts/fonts.css > vendor/fonts.css
node capture.js dm                      # capturas (shots/) y posiciones (rects.json)
python3 sfx2.py                         # efectos (sfx_only.wav) y con música (sfx_music.wav; pon music.mp3 aquí)
mkdir -p site/shots site/fonts && cp shots/*.png rects.json site/ 2>/dev/null; cp shots/*.png site/shots/
cp ../video-presentacion/piece*.png site/ && cp ../negocio360-isotipo.png site/iso.png
cp ../video-tutorial-multiusuario/site/fonts/* site/fonts/ && cp ../negocio360-logo-light-bg.png /dev/null
(cd site && python3 -m http.server 8793 &)
N=4980; for i in 0 1 2 3; do node vrender.js $((i*N/4)) $(((i+1)*N/4)) vpart$i.mp4 & done; wait
printf "file 'vpart%d.mp4'\n" 0 1 2 3 > list.txt
ffmpeg -f concat -i list.txt -i sfx_music.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest guia-uso-negocio360.mp4
```
(`wordmark_dark.png` sale de `video-tutorial-multiusuario/build.py`.)
