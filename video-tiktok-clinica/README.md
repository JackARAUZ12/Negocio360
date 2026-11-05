# Video TikTok · Negocio360 Clínica (vertical 9:16, ~64 s)

Voz de ElevenLabs + efectos de sonido sintetizados (sin música). Las pantallas son las páginas
REALES del módulo Clínica, abiertas con la base simulada de las pruebas
(`clinica/pruebas/supabase-simulado.js`) y datos de ejemplo "Centro Médico San Rafael":
Panel, Agenda, Sala de espera (modo TV), expediente con código, consulta (alergias, signos,
IMC, CIE-10), nota firmada, receta, especialidades (pediatría, ginecología, odontograma,
fisioterapia), cobro con seguro y Médicos y seguridad.

## Regenerar
```bash
cd video-tiktok-clinica
# 1) capturas reales (se guardan en shots/ y las posiciones en rects.json)
mkdir -p vendor && curl -sS -o vendor/lucide.js https://unpkg.com/lucide@0.460.0/dist/umd/lucide.js
cp ../video-tutorial-multiusuario/site/fonts/*.woff2 vendor/ && sed 's#fonts/#/__v/#g' ../video-tutorial-multiusuario/site/fonts/fonts.css > vendor/fonts.css
node capture.js
# 2) tiempos de cada palabra de la voz (vo.mp3) y efectos + mezcla (mix.wav)
python3 stt.py            # requiere faster-whisper; genera words.json
python3 sfx.py            # requiere numpy y scipy
# 3) video
mkdir -p site/shots site/fonts && cp shots/*.png site/shots/ && cp ../video-presentacion/piece*.png ../video-presentacion/wordmark.png site/
cp ../negocio360-isotipo.png site/iso.png && cp ../video-tutorial-multiusuario/site/fonts/* site/fonts/
(cd site && python3 -m http.server 8791 &)
N=1933; for i in 0 1 2 3; do node vrender.js $((i*N/4)) $(((i+1)*N/4)) vpart$i.mp4 & done; wait
printf "file 'vpart%d.mp4'\n" 0 1 2 3 > list.txt
ffmpeg -f concat -i list.txt -i mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest negocio360-clinica-tiktok.mp4
```
