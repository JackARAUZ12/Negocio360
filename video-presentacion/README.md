# Video de presentación Negocio360

Animación 16:9 (1920×1080, 30 fps) sincronizada a la música (120 BPM) para conferencias.
La música no se incluye en el repo; colócala como `music.mp3` en esta carpeta.

## Estructura (según la canción)
- 0:00–1:36 (drop 1): intro del logo sobre fondo blanco, módulos, funciones, dashboard, números reales, IA.
- 1:36–2:48 (parte tranquila): bucle del logo sobre fondo blanco.
- 2:48–4:24 (drop 2): tipos de negocio, dispositivos, pasos, seguridad, precio, cierre.
- 4:24–5:12 (parte tranquila): bucle del logo sobre fondo blanco.
- 5:12–6:50 (drop 3): intro del logo, más funciones, números, IA, precio, cierre.

## Cómo regenerarlo
```bash
cd video-presentacion
ffmpeg -i music.mp3 -ac 1 -ar 22050 -f s16le audio.raw && python3 analyze.py   # genera audio.json
N=12302; for i in 0 1 2 3; do node render.js $((i*N/4)) $(((i+1)*N/4)) part$i.mp4 & done; wait
printf "file 'part%d.mp4'\n" 0 1 2 3 > list.txt
ffmpeg -f concat -i list.txt -i music.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest negocio360-presentacion.mp4
```
`node snap.js 12 40 100` guarda cuadros de prueba en esos segundos.
