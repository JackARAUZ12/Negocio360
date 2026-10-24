import numpy as np, json
sr=22050; x=np.fromfile('audio.raw',dtype=np.int16).astype(np.float32)/32768
fps=30; hop=sr//fps; n=len(x)//hop
win=2048; frames=[]
w=np.hanning(win)
freqs=np.fft.rfftfreq(win,1/sr)
bass=[];full=[];hi=[]
pad=np.pad(x,(win,win))
for i in range(n):
    c=i*hop+win
    seg=pad[c-win//2:c+win//2]*w
    S=np.abs(np.fft.rfft(seg))
    bass.append(S[(freqs>30)&(freqs<150)].sum()); hi.append(S[freqs>4000].sum()); full.append(np.sqrt((seg**2).mean()))
def norm(a):
    a=np.array(a); a=a/np.percentile(a,99); return np.clip(a,0,1.2)
bass,full,hi=norm(bass),norm(full),norm(hi)
# onset/bpm from bass flux at higher resolution
on=np.maximum(0,np.diff(bass,prepend=bass[0]))
seg=on[30*60:30*180]-on[30*60:30*180].mean()
ac=np.correlate(seg,seg,'full')[len(seg)-1:]
lags=np.arange(len(ac))/fps
best=None
for bpm in np.arange(90,140,0.05):
    lag=60/bpm*fps
    s=sum(np.interp(lag*k,np.arange(len(ac)),ac) for k in range(1,9))
    if best is None or s>best[0]: best=(s,bpm)
print('bpm',best[1])
# smoothed loudness per 2s to see structure
L=np.convolve(full,np.ones(60)/60,'same')
for t in range(0,n//30,10): print(t, round(float(L[t*30]),2), round(float(np.convolve(bass,np.ones(60)/60,'same')[t*30]),2))
json.dump({'fps':fps,'bpm':float(best[1]),'bass':[round(float(v),3) for v in bass],'full':[round(float(v),3) for v in full],'hi':[round(float(v),3) for v in hi]},open('audio.json','w'))
