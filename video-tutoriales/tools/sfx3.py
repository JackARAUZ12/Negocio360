import json
from sfxlib import *
E=json.load(open('a3_events.json')); S=E['SFX']
def impact(g=1):
    x=X(.9); f=35+75*np.exp(-x*9); return g*(np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*5)+.5*lp(noise(.9),700)*np.exp(-x*14))
def pop(g=1):
    x=X(.1); f=500+500*np.exp(-x*45); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*32)
def swish(g=1):
    n=noise(.22); x=X(.22); return g*hp(lp(n,np.linspace(3000,9000,len(n))),1500)*np.sin(np.pi*x/.22)**2
def blip(g=1,f=1600):
    x=X(.07); return g*np.sin(2*np.pi*f*x)*np.exp(-x*60)*np.minimum(1,x/.002)
def confirm(g=1):
    out=np.zeros(int(.3*sr)); a=blip(1,1046); b=blip(1,1568); out[:len(a)]+=a; o=int(.085*sr); out[o:o+len(b)]+=b; return g*out
def key(g=1):
    x=X(.035); return g*hp(noise(.035),1800)*np.exp(-x*200)
def nriser(d,g=1):
    x=X(d); k=x/d; return g*k**2*lp(noise(d),300+8000*k)
def snap(g=1):
    x=X(.06); return g*hp(noise(.06),2500)*np.exp(-x*120)
for i,t in enumerate(S['pops']): add(t,pop(1),.13,pan=((i%3)-1)*.25)
for t in S['whoosh']: add(t-.08,whoosh(.45,1),.30)
for t in S['impact']: add(t,impact(1),.42); add(t,snap(1),.18)
for t in S['tick']: add(t,blip(1,1900),.10); add(t,tick(1),.12)
for t in S['swish']: add(t-.05,swish(1),.20); add(t+.05,pop(1),.12)
for t in S['rise']: add(t,riser(.95,1),.20)
for t in S['keys']: add(t,key(1),.22,pan=.15)
for t in S['cash']: add(t,kaching(1),.30); add(t+.02,coin(1,0),.12); add(t+.12,coin(1,4),.10)
for t in S['confirm']: add(t,confirm(1),.24)
for t in S['stamp']: add(t,stamp(1),.45)
for t in S['sparkle']: add(t,sparkle(1),.16)
for t in E['FLASH']: add(t-.05,revcym(.3,1),.12); add(t,whoosh(.4,1),.22)
for i in range(9): add(37.0+i*.07,pop(1),.08,pan=((i%3)-1)*.4)
add(20.3,whoosh(.5,1,up=False),.24)
for i,t in enumerate((26.6,26.75,26.9)): add(t,swish(1),.16,pan=(i-1)*.5)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('sfx3.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok', N/sr)
