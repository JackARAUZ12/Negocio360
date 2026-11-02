# Tutorial visual: Sistema Multiusuario (vertical 9:16)

Video sin voz de ~1:57 (1080×1920, 30 fps) que muestra el sistema multiusuario de Negocio360
en computadora y celular. Las pantallas que aparecen son las páginas reales del sistema
(`dashboard`, `configuracion`, `auditoria`, `productos`, `sucursales`, `login`) con su CSS real;
`site/mock.js` las anima (cursor, toques, escritura) con datos de ejemplo.

Pasos que muestra: activar el multiusuario (Configuración), crear usuarios con PIN y módulos,
entrar desde el celular con "¿Quién eres?" + PIN, menú limitado por usuario, permisos por
acción en Productos/Servicios, Auditoría y accesos por sucursal.

## Regenerar
```bash
cd video-tutorial-multiusuario
python3 build.py
(cd site && python3 -m http.server 8765 &)
node vsnap.js 20 58 90          # cuadros de prueba
N=3498; for i in 0 1 2 3; do node vrender.js $((i*N/4)) $(((i+1)*N/4)) vpart$i.mp4 & done; wait
printf "file 'vpart%d.mp4'\n" 0 1 2 3 > list.txt
ffmpeg -f concat -i list.txt -c copy tutorial-multiusuario-sin-audio.mp4
ffmpeg -i tutorial-multiusuario-sin-audio.mp4 -i music.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k \
  -af "afade=t=out:st=113.5:d=3" -shortest tutorial-multiusuario.mp4
```
