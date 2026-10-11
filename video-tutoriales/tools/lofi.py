import json
from sfxlib import *
ev=json.load(open('events.json'))
def ep(m,d,g=1):  # electric piano
    x=X(d); f=nf(m); s=np.sin(2*np.pi*f*x)+.35*np.sin(4*np.pi*f*x)*np.exp(-x*3)+.12*np.sin(6*np.pi*f*x)*np.exp(-x*6)
    return g*s*np.exp(-x*1.1)*np.minimum(1,x/.01)*np.minimum(1,(d-x)/.3)*(1+.08*np.sin(2*np.pi*5*x))
def softkick(g=1):
    x=X(.35); f=45+80*np.exp(-x*30); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*9)
def brush(g=1):
    x=X(.25); return g*lp(hp(noise(.25),1800),6000)*np.exp(-x*14)
def shaker(g=1):
    x=X(.06); return g*hp(noise(.06),6000)*np.exp(-x*50)
def uclick(g=1):
    x=X(.05); return g*(np.sin(2*np.pi*1800*x)*np.exp(-x*160)+.5*hp(noise(.05),3000)*np.exp(-x*220))
def pop(g=1):
    x=X(.12); f=500+700*np.exp(-x*40); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*30)
def chime(g=1):
    out=np.zeros(int(2.5*sr))
    for i,m in enumerate([72,76,79,84]):
        x=X(2.5-i*.08); s=np.sin(2*np.pi*nf(m)*x)*np.exp(-x*2.2); a=int(i*.08*sr); out[a:a+len(s)]+=s
    return g*out
prog=[[53,57,60,64],[52,55,59,62],[50,53,57,60],[48,52,55,59]]  # Fmaj7 Em7 Dm7 Cmaj7
bass=[41,40,38,36]
bar=B*4; nb=int(DUR/bar)+1
mel=[(0,72),(1.5,74),(2,76),(3,74),(4.5,72),(6,69),(7,67)]
for i in range(nb):
    t0=i*bar; ch=prog[i%4]
    for m in ch: add(t0,ep(m,bar*1.02,.07),pan=(m%3-1)*.2)
    add(t0,ep(bass[i%4]-12,bar,.16))
    for b in range(4):
        add(t0+b*B,softkick(.35 if b in (0,2) else .2))
        if b in (1,3): add(t0+b*B,brush(.12))
        for s8 in range(2): add(t0+b*B+s8*B/2,shaker(.05),pan=.3)
    if i%4 in (1,3) and i>2:
        for off,m in mel: add(t0+off*B/2,ep(m+(0 if i%8<4 else -2),B*.9,.045),pan=-.2)
# SFX
for c in ev['clicks']: add(c,uclick(.5))
for a in ev['spots']: add(a,pop(.12))
for a in ev['chapters']: add(a,whoosh(.6,.18))
add(0.2,chime(.25)); add(DUR-7,chime(.25))
env=np.minimum(1,np.arange(N)/sr/2)*np.minimum(1,(DUR-np.arange(N)/sr)/3)
Lm=np.tanh(L*1.0)*env; Rm=np.tanh(R*1.0)*env
pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk*1.1; Rm/=pk*1.1
d=(np.stack([Lm,Rm],1)*32767).astype(np.int16)
w=wave.open('tut.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok')
