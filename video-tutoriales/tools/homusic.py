# Hotel promo music: elegant deep-house, 120 BPM, Rhodes maj7 chords (drop 6s, breakdown 48-55, outro 55-60)
from sfxlib import *
def rhodes(ms,d,g=1):
    x=X(d); s=0
    for m in ms:
        f=nf(m); s=s+np.sin(2*np.pi*f*x+1.2*np.exp(-x*3)*np.sin(2*np.pi*f*x))*(1+.004*np.sin(2*np.pi*5*x))
    s=s/len(ms); return g*s*np.exp(-x*1.1)*np.minimum(1,x/.006)*np.minimum(1,(d-x)/.08)
def padw(ms,d,g=1,cut=1400):
    x=X(d); s=0
    for m in ms:
        f=nf(m)
        for c in (-.07,0,.07): s=s+np.sin(2*np.pi*f*2**(c/12)*x)+.3*np.sin(4*np.pi*f*2**(c/12)*x)
    s=lp(s/len(ms)/3,cut); return g*s*np.minimum(1,x/.6)*np.minimum(1,(d-x)/.6)
def sub(m,d,g=1):
    x=X(d); f=nf(m); s=np.tanh(1.6*np.sin(2*np.pi*f*x)); return g*lp(s,500)*np.minimum(1,x/.005)*np.minimum(1,(d-x)/.03)
def kickd(g=1):
    x=X(.45); f=42+110*np.exp(-x*28); return g*np.tanh(1.6*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*6))
def rim(g=1):
    x=X(.06); return g*(np.sin(2*np.pi*1700*x)*np.exp(-x*90)+.5*hp(noise(.06),2500)*np.exp(-x*120))
def shaker(g=1):
    x=X(.09); return g*hp(noise(.09),6000)*np.sin(np.pi*np.minimum(1,x/.09))**2
def bell(m,g=1,d=1.2):
    x=X(d); f=nf(m); return g*(np.sin(2*np.pi*f*x)+.4*np.sin(2*np.pi*f*2.76*x)*np.exp(-x*6))*np.exp(-x*3)
B=.5; BAR=2.0
prog=[[65,69,72,76],[64,67,71,74],[62,65,69,72],[60,64,67,71]]  # Fmaj7 Em7 Dm7 Cmaj7
roots=[41,40,38,36]
# intro 0-6: airy pad + rhodes, filter opening, soft pulse
for i in range(3):
    ch=prog[i]; add(i*2,padw(ch,2.1,.28,700+500*i)); add(i*2,rhodes(ch,1.9,.16))
for i in range(4,12): add(i*B,kickd(.18+.03*(i-4)))
for i in range(16): add(2+i*B/4,shaker(.05+.04*(i%2)))
for k,m in enumerate([84,88,91,95]): add(.6+k*.35,bell(m,.05),pan=(k%2-.5)*.7)
add(4.0,riser(2.0,.28)); add(5.75,revcym(.25,.25))
# groove 6-47.9
t=6.0; bi=0
while t<47.9:
    ch=prog[bi%4]; r=roots[bi%4]
    add(t,padw(ch,BAR,.10,1600))
    for b in range(4):
        at=t+b*B
        if at>=47.9: break
        add(at,kickd(.55))
        if b in (1,3): add(at,clap(.20)); add(at+B*.75,rim(.07),pan=.3)
        add(at+B/2,hat(.07,.09),pan=-.15)
        for s in range(4): add(at+s*B/4,shaker(.035 if s%2 else .05),pan=.3)
        add(at+B/2,sub(r,B/2-.03,.36))
        if b==3: add(at+B*.75,sub(r+12,B/4-.02,.16))
        if b in (0,) or (b==2 and bi%2): add(at+(B/2 if b==2 else 0),rhodes([m-12 for m in ch],.9,.13))
        if b==1: add(at+B*.5,rhodes([m-12 for m in ch[1:]],.4,.08))
    if bi%2==1:
        mel=[ch[3]+12,ch[2]+12,ch[1]+12]
        for k,m in enumerate(mel): add(t+1.0+k*.25,bell(m,.035,.8),pan=(k-1)*.4)
    t+=BAR; bi+=1
# breakdown 48-55
for i in range(4):
    ch=prog[i%4]; add(48+i*1.75,padw(ch,1.85,.22,1300)); add(48+i*1.75,rhodes(ch,1.7,.14))
for i in range(14): add(48+i*B,shaker(.04))
for i in range(6): add(51+i*B,kickd(.25))
for i in range(16): add(53+i*.11,rim(.03+.08*i/16))
add(53,riser(1.75,.3)); add(54.5,revcym(.25,.25))
# outro 55-60
add(55,boom(.4,2.5)); add(55,padw([65,69,72,76,79],5.0,.30,2000)); add(55,rhodes([53,65,69,72,76],4.5,.2))
for i in range(4): add(55+i*B,kickd(.3))
for k,m in enumerate([88,91,93,96,100]): add(55.6+k*.22,bell(m,.05),pan=(k%2-.5)*.6)
env=np.minimum(1,np.arange(N)/sr/.05)*np.minimum(1,(DUR-np.arange(N)/sr)/2.0)
Lm=np.tanh(L*1.2)*env; Rm=np.tanh(R*1.2)*env; pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk; Rm/=pk
d=(np.stack([Lm,Rm],1)*32767*.92).astype(np.int16)
w=wave.open('homusic.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('music ok')
