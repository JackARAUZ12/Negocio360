import json
from sfxlib import *
ev=json.load(open('tpp_events.json'))
def key(g=1):
    x=X(.035); return g*(hp(noise(.035),2500)*np.exp(-x*220)+.4*np.sin(2*np.pi*1800*x)*np.exp(-x*300))
def uclick(g=1):
    x=X(.045); return g*(np.sin(2*np.pi*2100*x)*np.exp(-x*200)+.6*hp(noise(.045),3000)*np.exp(-x*240))
def pop(g=1):
    x=X(.14); f=650+800*np.exp(-x*40); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*24)
def blip(g=1,f=1600):
    x=X(.08); return g*np.sin(2*np.pi*f*x)*np.exp(-x*50)*np.minimum(1,x/.002)
def chime(g=1):
    out=np.zeros(int(1.1*sr))
    for i,m in enumerate([76,81,88]):
        x=X(.8); s=np.sin(2*np.pi*nf(m)*x)*np.exp(-x*4); a=int(i*.09*sr); out[a:a+len(s)]+=s
    return g*out
def soft(g=1):
    x=X(.5); f=60+50*np.exp(-x*12); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*8)
import random; random.seed(3)
for k in ev['keys']: add(k,key(1),.16*random.uniform(.7,1.1),pan=random.uniform(-.2,.2))
for c in ev['clicks']: add(c,uclick(1),.35)
for c in ev['chapters']: add(c-.1,whoosh(.45,1),.16)
for c in ev['cards']: add(c,soft(1),.3); add(c,whoosh(.6,1),.1)
for p_ in ev['pops']: add(p_,pop(1),.3); add(p_+.02,blip(1,1900),.08)
add(ev['tap'],uclick(1),.4); add(ev['tap']+1.0,whoosh(.8,1),.2)
for r in ev['xrows']: add(r,key(1),.12); add(r+.05,blip(1,2400),.03)
for a in (ev['xsave'],39.7,87.7,103.1,131.8,162.5,170.9): add(a,chime(1),.22)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('tpp_sfx.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('sfx ok')
