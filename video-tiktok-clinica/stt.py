from faster_whisper import WhisperModel
import json
m = WhisperModel("small", device="cpu", compute_type="int8")
import numpy as np
audio=np.fromfile("vo16.raw",dtype=np.float32)
segs, info = m.transcribe(audio, language="es", word_timestamps=True, beam_size=5)
words = []
for s in segs:
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text}")
    for w in s.words: words.append([round(w.start, 2), round(w.end, 2), w.word.strip()])
json.dump(words, open("words.json", "w"), ensure_ascii=False)
