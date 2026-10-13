import json
from sfxlib import *
E=json.load(open('tp_events.json')); S=E['S']
def pop(g=1):
    x=X(.12); f=700+700*np.exp(-x*40); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*28)
def blip(g=1,f=1600):
    x=X(.08); return g*np.sin(2*np.pi*f*x)*np.exp(-x*50)*np.minimum(1,x/.002)
def clk(g=1):
    x=X(.04); return g*(np.sin(2*np.pi*2400*x)*np.exp(-x*260)+.6*hp(noise(.04),3500)*np.exp(-x*300))
def chime(g=1):
    out=np.zeros(int(1.0*sr))
    for i,m in enumerate([76,81,88]):
        x=X(.7); s=np.sin(2*np.pi*nf(m)*x)*np.exp(-x*4); a=int(i*.08*sr); out[a:a+len(s)]+=s
    return g*out
for t in S['whoosh']: add(t,whoosh(.45,1),.40)
for t in S['pop']: add(t,pop(1),.22); add(t+.02,blip(1,1900),.06)
for t in S['tick']: add(t,tick(1),.20)
for t in S['click']: add(t,clk(1),.6)
for t in S['chime']: add(t,chime(1),.30)
for t in S['impact']: add(t,boom(1,1.6),.45)
for t in E['WIPES']: add(t,whoosh(.55,1),.45)
for i in range(5): add(2.1+i*.5,whoosh(.25,1),.16)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('trsfx.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('sfx ok')
