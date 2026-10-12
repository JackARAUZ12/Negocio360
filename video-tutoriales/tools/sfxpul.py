import json
from sfxlib import *
E=json.load(open('pu_events.json')); S=E['S']
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
def snap(g=1):
    x=X(.06); return g*hp(noise(.06),2500)*np.exp(-x*120)
def uclick(g=1):
    x=X(.045); return g*(np.sin(2*np.pi*2100*x)*np.exp(-x*200)+.6*hp(noise(.045),3000)*np.exp(-x*240))
def scrib(g=1):
    x=X(.28); n=bp=hp(lp(noise(.28),3500),900); return g*n*(.6+.4*np.sin(2*np.pi*14*x))*np.sin(np.pi*x/.28)
def buzz(g=1):
    x=X(.35); s=np.sign(np.sin(2*np.pi*140*x))*.5+np.sin(2*np.pi*280*x)*.3; return g*s*np.exp(-x*4)*np.minimum(1,(.35-x)/.03)
def alarm(g=1):
    out=np.zeros(int(.5*sr))
    for i,f in enumerate((880,660,880)):
        b=blip(1,f); o=int(i*.13*sr); out[o:o+len(b)]+=b
    return g*out
def wa(g=1):
    x=X(.25); return g*(np.sin(2*np.pi*1180*x)*np.exp(-x*18)+.6*np.sin(2*np.pi*1770*np.maximum(0,x-.08))*np.exp(-np.maximum(0,x-.08)*18)*(x>.08))
for i,t in enumerate(S['pops']): add(t,pop(1),.12,pan=((i%3)-1)*.25)
for t in S['whoosh']: add(t-.08,whoosh(.45,1),.28)
for t in S['impact']: add(t,impact(1),.42); add(t,snap(1),.16)
for t in S['tick']: add(t,blip(1,1900),.10); add(t,tick(1),.12)
for t in S['swish']: add(t-.05,swish(1),.20); add(t+.05,pop(1),.12)
for t in S['rise']: add(t,riser(.95,1),.20)
for t in S['keys']: add(t,key(1),.22,pan=.15)
for t in S['cash']: add(t,kaching(1),.30); add(t+.02,coin(1,0),.12); add(t+.12,coin(1,4),.10)
for t in S['confirm']: add(t,confirm(1),.22)
for t in S['stamp']: add(t,stamp(1),.45)
for t in S['sparkle']: add(t,sparkle(1),.16)
for t in S['glitch']: add(t,glitchn(.12,1),.22); add(t,buzz(1),.10)
for t in S['scribble']: add(t,scrib(1),.18)
for t in S['alarm']: add(t,alarm(1),.20)
for t in S['wa']: add(t,wa(1),.26)
for t in S['click']: add(t,uclick(1),.30)
for t in E['FLASH']: add(t-.05,revcym(.3,1),.12); add(t,whoosh(.4,1),.22)
for i in range(9): add(66.4+i*.07,pop(1),.08,pan=((i%3)-1)*.4)
for i in range(30): add(.3+i*.085,tick(1),.05,pan=((i%2)-.5)*.4)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('sfxpul.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok', N/sr)
