import json
from sfxlib import *
ev=json.load(open('tc_events.json'))
def uclick(g=1):
    x=X(.045); return g*(np.sin(2*np.pi*2100*x)*np.exp(-x*200)+.6*hp(noise(.045),3000)*np.exp(-x*240))
def blip(g=1,f=1600):
    x=X(.07); return g*np.sin(2*np.pi*f*x)*np.exp(-x*55)*np.minimum(1,x/.002)
def beep(g=1):
    x=X(.11); return g*np.sin(2*np.pi*2750*x)*np.minimum(1,x/.004)*np.minimum(1,(.11-x)/.01)
def confirm(g=1):
    out=np.zeros(int(.35*sr)); a=blip(1,1046); b=blip(1,1568); out[:len(a)]+=a; o=int(.09*sr); out[o:o+len(b)]+=b; return g*out
def soft(g=1):
    x=X(.5); f=60+50*np.exp(-x*12); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*8)
for c in ev['clicks']: add(c,uclick(1),.35)
for c in ev['chapters']: add(c-.1,whoosh(.45,1),.16)
for c in ev['cards']: add(c,soft(1),.35); add(c,whoosh(.6,1),.12)
pass
for a in (64.3,141.4,155.4,172.0): add(a,confirm(1),.10)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('tc_sfx.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('sfx ok')
