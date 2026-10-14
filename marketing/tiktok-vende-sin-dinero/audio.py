"""Musica instrumental original (sintetizada, sin derechos de terceros) + efectos discretos.
Tension en menor hasta "Por eso...", luego progresion mayor positiva para la solucion."""
import numpy as np

SR = 48000
BPM = 100
BEAT = 60 / BPM
RNG = np.random.default_rng(360)

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12)


def env_adsr(n, a, d, s, r):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    e = np.full(n, s, np.float32)
    e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    e[a:a + d] = np.linspace(1, s, len(e[a:a + d]), endpoint=False)
    if r:
        e[-r:] *= np.linspace(1, 0, len(e[-r:]))
    return e


def tone(f, dur, harm=(1, .5, .25), decay=None, detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    y = np.zeros_like(t)
    for k, amp in enumerate(harm, 1):
        y += amp * np.sin(2 * np.pi * f * k * t)
        if detune:
            y += amp * np.sin(2 * np.pi * f * k * (1 + detune) * t)
    if decay:
        y *= np.exp(-t / decay)
    return y.astype(np.float32)


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    # filtro IIR de 1 polo vectorizado por bloques (suficiente para texturas)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(0, len(x), 4096):
        blk = x[i:i + 4096]
        out = np.empty_like(blk)
        for j, v in enumerate(blk):
            acc = (1 - a) * v + a * acc
            out[j] = acc
        y[i:i + 4096] = out
    return y


def hp_noise(n, amount=1.0):
    w = RNG.standard_normal(n).astype(np.float32)
    return (np.diff(w, prepend=0) * 0.5 * amount).astype(np.float32)


def add(buf, sig, t):
    i = int(t * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i]


def reverb(x, secs=1.1, mix=0.22):
    n = int(secs * SR)
    ir = RNG.standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / SR / (secs / 5))
    ir /= np.sqrt((ir ** 2).sum())
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    return ((1 - mix) * x + mix * wet).astype(np.float32)


TENSION = [[("A", 2), ("C", 3), ("E", 3)], [("F", 2), ("A", 2), ("C", 3)],
           [("D", 2), ("F", 2), ("A", 2)], [("E", 2), ("G#", 2), ("B", 2)]]
POSITIVO = [[("C", 3), ("E", 3), ("G", 3)], [("G", 2), ("B", 2), ("D", 3)],
            [("A", 2), ("C", 3), ("E", 3)], [("F", 2), ("A", 2), ("C", 3)]]


def musica(total, t_cambio):
    n = int(total * SR)
    pad = np.zeros(n, np.float32)
    bass = np.zeros(n, np.float32)
    perc = np.zeros(n, np.float32)
    arp = np.zeros(n, np.float32)
    bar = 4 * BEAT
    kick = tone(52, 0.35, (1,), decay=0.09) * np.exp(-np.arange(int(.35 * SR)) / SR / .2)
    kick[:int(.05 * SR)] += tone(110, 0.05, (1,), decay=0.01) * 0.3
    tick = hp_noise(int(0.03 * SR)) * np.exp(-np.arange(int(0.03 * SR)) / SR / 0.006)
    clap = hp_noise(int(0.15 * SR)) * np.exp(-np.arange(int(0.15 * SR)) / SR / 0.035)

    # Seccion A: tension (menor), pulso de bajo + ticks tipo reloj
    t, k = 0.0, 0
    while t < t_cambio:
        chord = TENSION[k % 4]
        d = min(bar, t_cambio - t) + 0.4
        for nm, o in chord:
            add(pad, tone(hz(nm, o + 1), d, (1, .35, .15), detune=0.004) * env_adsr(int(d * SR), .6, .1, .8, .5) * .16, t)
        for e in range(8):
            te = t + e * BEAT / 2
            if te < t_cambio:
                add(bass, tone(hz(chord[0][0], 1), .28, (1, .6, .2), decay=.12) * .5, te)
        for s in range(16):
            ts = t + s * BEAT / 4
            if ts < t_cambio:
                add(perc, tick * (0.5 if s % 4 == 0 else 0.22), ts)
        for b in (0, 2.5):
            if t + b * BEAT < t_cambio:
                add(perc, kick * 0.55, t + b * BEAT)
        t += bar
        k += 1

    # Riser hacia la solucion
    rl = 1.4
    rn = int(rl * SR)
    ramp = np.linspace(0, 1, rn) ** 2
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(180, 900, rn)) / SR) * 0.08
    add(perc, (hp_noise(rn, 0.9) * 0.35 + sweep) * ramp, t_cambio - rl)

    # Seccion B: positiva (mayor), arpegio pluck + kick suave a negras
    t, k = t_cambio, 0
    while t < total:
        chord = POSITIVO[k % 4]
        d = bar + 0.5
        for nm, o in chord:
            add(pad, tone(hz(nm, o + 1), d, (1, .3, .1), detune=0.003) * env_adsr(int(d * SR), .25, .2, .7, .6) * .13, t)
        pattern = [chord[0], chord[1], chord[2], chord[1]] * 2
        for e, (nm, o) in enumerate(pattern):
            add(arp, tone(hz(nm, o + 2), .5, (1, .4, .2, .1), decay=.16) * .22, t + e * BEAT / 2)
        for e in range(8):
            add(bass, tone(hz(chord[0][0], 1 if chord[0][1] == 2 else 2), .3, (1, .5, .15), decay=.14) * .45, t + e * BEAT / 2)
        for b in range(4):
            add(perc, kick * 0.6, t + b * BEAT)
            add(perc, tick * 0.35, t + b * BEAT + BEAT / 2)
            if b % 2:
                add(perc, clap * 0.25, t + b * BEAT)
        t += bar
        k += 1

    pad = onepole_lp(pad, 1800)
    mix = reverb(pad + arp, 1.6, 0.3) + onepole_lp(bass, 600) + reverb(perc, 0.6, 0.12)
    fade = int(1.2 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)
    mix /= np.abs(mix).max() + 1e-9
    return mix.astype(np.float32)


# ---------- efectos ----------
def whoosh(d=0.38):
    n = int(d * SR)
    x = np.linspace(0, 1, n)
    e = np.sin(np.pi * x) ** 2
    nz = onepole_lp(RNG.standard_normal(n).astype(np.float32), 2500) * 1.6
    return (nz * e * 0.5).astype(np.float32)


def pop():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    f = 1400 * np.exp(-t * 18) + 500
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.025) * 0.35).astype(np.float32)


def golpe():
    n = int(0.9 * SR)
    t = np.arange(n) / SR
    f = 75 * np.exp(-t * 2) + 38
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    y[:int(.02 * SR)] += hp_noise(int(.02 * SR), .6)
    return (y * 0.75).astype(np.float32)


def efectos(total, eventos):
    buf = np.zeros(int(total * SR), np.float32)
    gen = {"whoosh": whoosh, "pop": pop, "golpe": golpe}
    for t, kind in eventos:
        s = gen[kind]()
        add(buf, s, max(0, t - (0.22 if kind == "whoosh" else 0)))
    return reverb(buf, 0.5, 0.1)


def guardar(path, x):
    import subprocess
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", path],
                   input=np.clip(x, -1, 1).astype(np.float32).tobytes(), check=True)
