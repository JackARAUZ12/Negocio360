import json
from sfxlib import *
def saw(f,x): return 2*((f*x)%1)-1
def supersaw(m,d,g=1,det=(-.12,-.05,0,.05,.12)):
    x=X(d); f=nf(m); s=sum(saw(f*2**(c/12),x+i*.013) for i,c in enumerate(det))/len(det); return g*s
def pad(ms,d,g=1,cut=1800):
    x=X(d); s=sum(supersaw(m,d) for m in ms)/len(ms); s=lp(s,cut); return g*s*np.minimum(1,x/.35)*np.minimum(1,(d-x)/.4)
def stab(ms,g=1,d=.22):
    x=X(d); s=sum(supersaw(m,d) for m in ms)/len(ms); s=lp(s,np.linspace(5200,1200,len(x))); return g*s*np.exp(-x*9)
def bass(m,d,g=1):
    x=X(d); f=nf(m); s=np.tanh(2*(np.sin(2*np.pi*f*x)+.5*saw(f,x))); return g*lp(s,900)*np.minimum(1,x/.004)*np.exp(-x*4)*np.minimum(1,(d-x)/.02)
def pluck(m,g=1,d=.3):
    x=X(d); f=nf(m); return g*lp(saw(f,x),np.linspace(4000,600,len(x)))*np.exp(-x*12)
def kick2(g=1):
    x=X(.4); f=45+150*np.exp(-x*30); return g*np.tanh(2*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*7))
def snare(g=1):
    x=X(.25); return g*(hp(noise(.25),1500)*np.exp(-x*18)*.7+np.sin(2*np.pi*190*x)*np.exp(-x*25)*.5)
def oh(g=1):
    x=X(.25); return g*hp(noise(.25),7000)*np.exp(-x*14)
B=.5; BAR=2.0
prog=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]   # Am F C G
roots=[33,29,36,31]
prog=[[60,64,67],[55,59,62],[57,60,64],[53,57,60]]   # C G Am F (brillante)
roots=[36,31,33,29]
# ---- intro 0-4
add(0,pad([60,64,67,72],2.05,.18,900)); add(2,pad([57,60,64,69],2.0,.22,1500))
for i in range(4,8): add(i*B,kick2(.28))
for i in range(8): add(2+i*B/4,hat(.05 if i%2 else .08))
for i in range(16): add(2+i*.125,snare(.03+.15*i/16))
add(2.0,riser(2.0,.32)); add(3.8,revcym(.2,.28))
# ---- groove 4-38
t=4.0; bi=0
while t<37.9:
    ch=prog[bi%4]; r=roots[bi%4]
    add(t,pad(ch+[ch[0]+12],BAR,.07,2600))
    for b in range(4):
        at=t+b*B
        add(at,kick2(.55))
        if b in (1,3): add(at,clap(.30))
        add(at+B/2,oh(.10)); add(at+B/2,bass(r,B/2-.02,.32)); add(at+B*.75,bass(r+12,B/4-.02,.18))
        for s2 in range(4): add(at+s2*B/4,hat(.04 if s2%2 else .06),pan=.25)
        if b in (0,2): add(at,stab([m+12 for m in ch],.10))
        arp=[ch[0]+24,ch[1]+24,ch[2]+24,ch[1]+24]
        for s2 in range(4): add(at+s2*B/4,pluck(arp[(b*4+s2)%4],.05),pan=-.3)
    t+=BAR; bi+=1
# ---- build 38-42
for i,ch in enumerate(prog[:2]): add(38+i*2,pad(ch+[ch[0]+12],2.05,.16,1800))
for i in range(8): add(38+i*B,kick2(.3))
for i in range(16): add(40+i*.125,snare(.04+.15*i/16))
add(40,riser(2.0,.35)); add(41.75,revcym(.25,.3))
# ---- outro 42-48
add(42,boom(.5,2.5)); add(42,pad([60,64,67,72,76],6.0,.24,2400))
for i in range(4): add(42+i*B,kick2(.35)); add(42+i*B+B/2,oh(.08))
for k,m in enumerate([84,88,91,96,100]): add(42.5+k*.25,pluck(m,.06),pan=(k%2-.5)*.6)
env=np.minimum(1,np.arange(N)/sr/.05)*np.minimum(1,(DUR-np.arange(N)/sr)/2.0)
Lm=np.tanh(L*1.2)*env; Rm=np.tanh(R*1.2)*env; pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk; Rm/=pk
d=(np.stack([Lm,Rm],1)*32767*.92).astype(np.int16)
w=wave.open('tumusic.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('music ok')
