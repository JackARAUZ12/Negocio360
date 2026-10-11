from sfxlib import *
def pad(ms,d,g=1,bright=.3):
    x=X(d); s=sum(np.sin(2*np.pi*nf(m)*dt*x)+bright*np.sin(4*np.pi*nf(m)*dt*x) for m in ms for dt in (.997,1.003))
    return g*s/len(ms)*np.minimum(1,x/.4)*np.minimum(1,(d-x)/.4)
def pluck(m,d=.35,g=1):
    x=X(d); f=nf(m); return g*(np.sin(2*np.pi*f*x)+.4*np.sin(4*np.pi*f*x)+.15*np.sign(np.sin(2*np.pi*f*x)))*np.exp(-x*9)*np.minimum(1,x/.003)
def softkick(g=1):
    x=X(.3); f=48+110*np.exp(-x*35); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*10)
def pop(g=1,f0=900):
    x=X(.12); f=f0+600*np.exp(-x*40); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*28)
def shimmer(d,g=1):
    x=X(d); return g*sum(np.sin(2*np.pi*nf(m)*x)*np.exp(-x*1.5) for m in (84,88,91,96))/4*np.minimum(1,x/.05)
def impact(g=1):
    x=X(2.2); f=40+70*np.exp(-x*5); return g*(np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*2)+lp(noise(2.2),900)*np.exp(-x*4)*.8)
# ---- problem bed 0-11.7: low pulse + clock tick
x=X(11.9); add(0,(np.sin(2*np.pi*nf(38)*x)+.5*np.sin(2*np.pi*nf(45)*x*1.002))*np.minimum(1,x/.3)*np.minimum(1,(11.9-x)/.4)*(.7+.3*np.sin(2*np.pi*x*.8)),.10)
for k in range(int(11.6/(B/2))):
    at=k*B/2; add(at,tick(.10 if k%2 else .16))
for k in range(int(11.6/B)): add(k*B,softkick(.18))
# ---- imagine 11.7-14.9: airy pad + riser
add(11.75,whoosh(.7,.35,up=False)); add(12.1,pad([62,66,69,73],2.9,.10,.1)); add(12.2,shimmer(2.5,.12))
add(13.3,riser(1.55,.22))
# ---- organized 14.85-37.4: bright groove
add(14.85,impact(.35)); add(14.85,shimmer(1.5,.14))
prog=[[57,61,64,68],[54,57,61,64],[50,54,57,61],[52,56,59,62]]   # A maj7-ish, F#m, D, E
roots=[33,30,26,28]
bar=B*4; t0=14.85; i=0
while t0<44.4:
    end=min(44.75,t0+bar)
    ch=prog[i%4]; brandpart=t0>=37.4
    add(t0,pad(ch,end-t0+.05,.075,.25))
    add(t0,pad([roots[i%4]+12],end-t0,.12,.05))
    for b in range(4):
        at=t0+b*B
        if at>=44.5: break
        add(at,softkick(.32 if not brandpart else .22))
        if b in (1,3): add(at,hp(noise(.12),3500)*np.exp(-X(.12)*30),.06)
        for s in range(4):
            a2=at+s*B/4
            if a2<44.5: add(a2,hat(.035 if s%2 else .05),pan=.3)
            if not brandpart and s in (0,2,3) and a2<37.3: add(a2,pluck(ch[(b*4+s)%4]+12,.3,.035),pan=-.25)
    t0+=bar; i+=1
# ---- SFX
for at,g in [(0.05,.18),(6.15,.16),(42.3,.14),(43.2,.12)]: add(at,pop(g))
for at in (2.6,18.3,23.15,23.85,24.6,26.3,27.2,28.8,33.5): add(at,whoosh(.45,.18))
for i in range(9): add(3.3+i*.25,tick(.06))
for at in (16.1,16.8,17.4,30.4): add(at,pop(.10,700))
add(36.3,whoosh(.3,.15)); add(36.85,softkick(.4)); add(37.45,impact(.45)); add(37.5,shimmer(2.0,.15)); add(39.4,pop(.10,600))
for k in range(12): add(41.55+k*.06,tick(.05))
env=np.minimum(1,np.arange(N)/sr/.05)*np.minimum(1,(DUR-np.arange(N)/sr)/.5)
Lm=L*env; Rm=R*env; pk=max(np.abs(Lm).max(),np.abs(Rm).max()); Lm/=pk; Rm/=pk
d=(np.stack([Lm,Rm],1)*32767*.9).astype(np.int16)
w=wave.open('admusic.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok')
