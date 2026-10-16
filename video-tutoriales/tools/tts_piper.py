"""Voz con Piper (es_MX "claude", Apache-2.0) via sherpa-onnx, sin claves ni internet tras descargar el modelo.
Uso: python3 tts_piper.py guion.txt salida   ->  salida.wav, salida.mp3 y salida_tiempos.json
guion.txt: una frase por línea; las líneas que empiezan con '#' son títulos de capítulo (se leen como capítulo y
quedan marcadas en el json); las líneas vacías agregan una pausa larga.
Modelo: curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_MX-claude-high.tar.bz2 | tar xj
"""
import sys, json, os, subprocess, numpy as np, soundfile as sf, sherpa_onnx as so
M = os.environ.get('PIPER_DIR', 'vits-piper-es_MX-claude-high') + '/'
SPEED = float(os.environ.get('SPEED', '1.0'))       # >1 = más rápido
PAUSA, PAUSA_LARGA, PAUSA_CAP = .35, .8, .6
tts = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(vits=so.OfflineTtsVitsModelConfig(
    model=M + 'es_MX-claude-high.onnx', tokens=M + 'tokens.txt', data_dir=M + 'espeak-ng-data'), num_threads=4)))
src, out = sys.argv[1], sys.argv[2]
sr = None; parts = []; tiempos = []; t = 0.0
def sil(d): return np.zeros(int(d * (sr or 22050)), dtype=np.float32)
for raw in open(src, encoding='utf-8'):
    line = raw.strip()
    if not line: parts.append(sil(PAUSA_LARGA)); t += PAUSA_LARGA; continue
    cap = line.startswith('#'); txt = line.lstrip('#').strip()
    a = tts.generate(txt, sid=0, speed=SPEED); sr = a.sample_rate; x = np.array(a.samples, dtype=np.float32)
    nz = np.where(np.abs(x) > 0.01)[0]; x = x[max(0, nz[0] - 200):nz[-1] + 400] if len(nz) else x   # recorta silencios
    tiempos.append({'a': round(t, 2), 'b': round(t + len(x) / sr, 2), 'texto': txt, 'capitulo': cap})
    parts += [x, sil(PAUSA_CAP if cap else PAUSA)]; t += len(x) / sr + (PAUSA_CAP if cap else PAUSA)
y = np.concatenate([sil(.3)] + parts); y = y / max(1e-6, np.abs(y).max()) * .89
for d in tiempos: d['a'] = round(d['a'] + .3, 2); d['b'] = round(d['b'] + .3, 2)
sf.write(out + '.wav', y, sr)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', out + '.wav', '-af', 'loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-b:a', '160k', out + '.mp3'], check=True)
json.dump(tiempos, open(out + '_tiempos.json', 'w'), ensure_ascii=False, indent=1)
print(f'ok {out}.mp3  {len(y)/sr:.2f}s  {len(tiempos)} frases')
