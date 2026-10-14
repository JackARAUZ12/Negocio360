"""Acorta SOLO los silencios largos entre frases (no cambia velocidad ni tono de la voz).
Conserva la pausa dramatica antes de "vender mucho no significa ganar mucho"."""
import subprocess, numpy as np, re, sys
SR = 48000
src = "assets/voz_original.mp3"
raw = subprocess.run(["ffmpeg","-v","error","-i",src,"-ar",str(SR),"-ac","1","-f","f32le","-"],capture_output=True).stdout
a = np.frombuffer(raw, np.float32).copy()
log = subprocess.run(["ffmpeg","-hide_banner","-i",src,"-af","silencedetect=n=-35dB:d=0.25","-f","null","-"],capture_output=True,text=True).stderr
st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
KEEP = 0.30          # pausa maxima entre frases
PROTEGER = (14.9, 15.4)  # pausa tras "Y cuidado:" -> se respeta
cuts = []
for s, e in zip(st, en):
    if e - s > KEEP and not (PROTEGER[0] <= s <= PROTEGER[1]):
        mid = (s + e) / 2
        cuts.append((mid - (e - s - KEEP) / 2, mid + (e - s - KEEP) / 2))
out, pos, fade = [], 0, int(0.008 * SR)
for c0, c1 in cuts:
    out.append(a[pos:int(c0 * SR)]); pos = int(c1 * SR)
out.append(a[pos:])
y = np.concatenate(out)
y = np.concatenate([np.zeros(int(0.05 * SR), np.float32), y])  # 50 ms de aire inicial
y.astype(np.float32).tofile("assets/voz.f32")
subprocess.run(["ffmpeg","-v","error","-y","-f","f32le","-ar",str(SR),"-ac","1","-i","assets/voz.f32",
                "-af","highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-15:TP=-1.5:LRA=7",
                "-ar",str(SR),"assets/voz.wav"])
import os; os.remove("assets/voz.f32")
print("recortado:", round(sum(c1 - c0 for c0, c1 in cuts), 2), "s  -> duracion", round(len(y) / SR, 2), "s")
