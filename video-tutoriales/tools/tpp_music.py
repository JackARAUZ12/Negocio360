from sfxlib import *
def saw(f,x): return 2*((f*x)%1)-1
def ep(m,d,g=1):
    x=X(d); f=nf(m); s=np.sin(2*np.pi*f*x)+.3*np.sin(4*np.pi*f*x)*np.exp(-x*3)
    return g*s*np.exp(-x*.9)*np.minimum(1,x/.01)*np.minimum(1,(d-x)/.25)
def pluck(m,g=1,d=.35):
    x=X(d); f=nf(m); return g*lp(saw(f,x),np.linspace(5000,700,len(x)))*np.exp(-x*10)
def kick(g=1):
    x=X(.35); f=48+120*np.exp(-x*32); return g*np.tanh(1.6*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*8))
def snap(g=1):
    x=X(.18); return g*hp(noise(.18),1800)*np.exp(-x*26)
def sh(g=1):
    x=X(.05); return g*hp(noise(.05),7000)*np.exp(-x*60)
def bass(m,d,g=1):
    x=X(d); f=nf(m); return g*lp(np.tanh(1.5*np.sin(2*np.pi*f*x)),700)*np.minimum(1,x/.005)*np.exp(-x*2.5)*np.minimum(1,(d-x)/.03)
prog=[[60,64,67,71],[55,59,62,66],[57,60,64,67],[53,57,60,64]]; roots=[36,31,33,29]
bar=B*4; nb=int(DUR/bar)+1
arp=[0,2,1,3,2,1,3,2]
for i in range(nb):
    t0=i*bar; ch=prog[i%4]; sec=(i//8)%4
    for m in ch[:3]: add(t0,ep(m,bar*1.02,.05),pan=(m%3-1)*.25)
    add(t0,bass(roots[i%4],B*1.6,.22)); add(t0+B*2,bass(roots[i%4],B*1.4,.18)); add(t0+B*3.5,bass(roots[i%4]+12,B*.45,.12))
    full = i>=2 and not (DUR-t0<6)
    for b in range(4):
        if full: add(t0+b*B,kick(.28 if b in (0,2) else .12))
        if full and b in (1,3): add(t0+b*B,snap(.16))
        for s8 in range(2):
            if i>=1: add(t0+b*B+s8*B/2,sh(.05 if s8 else .035),pan=.35)
    if i>=4:
        for k in range(8): add(t0+k*B/2,pluck(ch[arp[k]]+12,.06),pan=-.3+(k%2)*.6)
env=np.minimum(1,np.arange(N)/sr/1.5)*np.minimum(1,(DUR-np.arange(N)/sr)/3)
Lm=np.tanh(L*1.2)*env; Rm=np.tanh(R*1.2)*env; pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk*1.1; Rm/=pk*1.1
d=(np.stack([Lm,Rm],1)*32767).astype(np.int16)
w=wave.open('tpp_music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('music ok')
