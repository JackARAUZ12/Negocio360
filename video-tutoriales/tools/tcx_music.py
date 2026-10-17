from sfxlib import *
def ep(m,d,g=1):
    x=X(d); f=nf(m); s=np.sin(2*np.pi*f*x)+.35*np.sin(4*np.pi*f*x)*np.exp(-x*3)+.12*np.sin(6*np.pi*f*x)*np.exp(-x*6)
    return g*s*np.exp(-x*1.1)*np.minimum(1,x/.01)*np.minimum(1,(d-x)/.3)*(1+.08*np.sin(2*np.pi*5*x))
def softkick(g=1):
    x=X(.35); f=45+80*np.exp(-x*30); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*9)
def brush(g=1):
    x=X(.25); return g*lp(hp(noise(.25),1800),6000)*np.exp(-x*14)
def shaker(g=1):
    x=X(.06); return g*hp(noise(.06),6000)*np.exp(-x*50)
prog=[[53,57,60,64],[52,55,59,62],[50,53,57,60],[48,52,55,59]]; bass=[41,40,38,36]
bar=B*4; nb=int(DUR/bar)+1
for i in range(nb):
    t0=i*bar; ch=prog[i%4]
    for m in ch: add(t0,ep(m,bar*1.02,.07),pan=(m%3-1)*.2)
    add(t0,ep(bass[i%4]-12,bar,.16))
    for b in range(4):
        add(t0+b*B,softkick(.3 if b in (0,2) else .18))
        if b in (1,3): add(t0+b*B,brush(.1))
        for s8 in range(2): add(t0+b*B+s8*B/2,shaker(.04),pan=.3)
env=np.minimum(1,np.arange(N)/sr/2)*np.minimum(1,(DUR-np.arange(N)/sr)/3)
Lm=np.tanh(L)*env; Rm=np.tanh(R)*env; pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk*1.1; Rm/=pk*1.1
d=(np.stack([Lm,Rm],1)*32767).astype(np.int16)
w=wave.open('tcx_music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('music ok')
