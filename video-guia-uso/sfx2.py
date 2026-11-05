import numpy as np, subprocess, sys
src = open('../video-tiktok-clinica/sfx.py').read().split('EV = []')[0]
exec(src)
EV = []
def at(t, snd, g=0.5, pan=0.0): EV.append((t, snd, g, pan))
def mclick(): x = np.zeros(int(.09 * SR)); a = click(3800, .012); b = click(2600, .015); x[:len(a)] += a; i = int(.045 * SR); x[i:i + len(b)] += b * .6; return norm(x, .8)
def soft_tap(): t = t_(.08); return norm(lp(noise(.08), 1800) * np.exp(-t * 60) + np.sin(2 * np.pi * 180 * t) * np.exp(-t * 50) * .6, .7)
def switch(): x = np.zeros(int(.5 * SR)); a = click(2000, .02); x[:len(a)] += a; w = whoosh(.35, True, 500, 2500); i = int(.03 * SR); x[i:i + len(w)] += w * .4; return norm(x, .7)
desk_clicks = [8.1, 10.3, 12.0, 13.2, 15.85, 19.55, 22.45, 54.2, 57.6, 61.0, 64.2, 66.05, 71.5, 75.0, 80.0, 85.5, 89.5, 92.4, 112.0, 152.1]
ph_clicks = [119.8, 121.4, 123.2, 125.5, 126.6, 127.0, 127.4, 127.8, 128.6, 132.0, 134.0, 136.8, 141.0, 145.0]
for c in desk_clicks: at(c, mclick(), .55)
for c in ph_clicks: at(c, soft_tap(), .6)
def typing(a, b, n=None):
    n = n or max(3, int((b - a) * 11))
    for i in range(n): at(a + (b - a) * i / n + rng.uniform(-.02, .02), click(rng.uniform(2400, 3600), .018), .3)
for a, b in [(8.5, 9.7), (10.6, 11.4), (66.4, 67.2), (120.0, 121.0), (121.5, 122.3), (134.3, 134.95)]: typing(a, b)
for x in [20.6, 21.0, 21.4, 21.8, 90.9, 91.5]: at(x, click(2900, .02), .35)
for x in [6, 16.6, 26.5, 52.5, 78.2, 88.2, 109, 118, 150, 158]: at(x - .2, whoosh(.5, True, 300, 2200), .3)
for x in [80.0, 85.5, 141.0]: at(x + .05, switch(), .4)
for x in [23.0, 129.0]: at(x, chord(), .28)
for x in [26.5, 29.2, 31.8, 34.4, 37.0, 39.6, 42.2, 44.8, 47.4, 50.0]: at(x, pop(1300, .09), .22)
at(0.2, sparkle(1.2), .25); at(1.9, impact(False), .3); at(161.0, sparkle(1.0), .3); at(161.5, chord(), .3)
DUR = 166.0
L = int(DUR * SR); mix = np.zeros((L, 2), np.float32)
for t, snd, g, pan in EV:
    i = int(t * SR); s = snd[:max(0, L - i)]; mix[i:i + len(s)] += (s * g)[:, None]
def write(name, arr):
    arr.astype(np.float32).tofile('tmp.f32')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'tmp.f32', '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'pcm_s16le', name], check=True)
write('sfx_only.wav', mix)
mus = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', 'music.mp3', '-t', str(DUR), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout, dtype=np.float32).reshape(-1, 2)
m = np.zeros((L, 2), np.float32); m[:len(mus)] = mus[:L]
fade = np.ones(L); fi = int(1.5 * SR); fo = int(4 * SR); fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
write('sfx_music.wav', mix + m * fade[:, None] * 0.16)
print('events', len(EV))
