from sfxlib import *
def impact(g=1):
    x=X(.9); f=35+75*np.exp(-x*9); return g*(np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*5)+.5*lp(noise(.9),700)*np.exp(-x*14))
def uclick(g=1):
    x=X(.04); return g*(np.sin(2*np.pi*2200*x)*np.exp(-x*220)+.6*hp(noise(.04),3000)*np.exp(-x*260))
def lock(g=1):
    x=X(.09); s=hp(noise(.09),2500)*(np.exp(-x*300)+.7*np.exp(-np.maximum(0,x-.035)*300)*(x>.035)); return g*s
def blip(g=1,f=1600):
    x=X(.07); return g*np.sin(2*np.pi*f*x)*np.exp(-x*60)*np.minimum(1,x/.002)
def confirm(g=1):
    out=np.zeros(int(.3*sr)); a=blip(1,1046); b=blip(1,1568); out[:len(a)]+=a; o=int(.085*sr); out[o:o+len(b)]+=b; return g*out
def pop(g=1):
    x=X(.1); f=500+500*np.exp(-x*45); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*32)
def swish(g=1):
    n=noise(.22); x=X(.22); return g*hp(lp(n,np.linspace(3000,9000,len(n))),1500)*np.sin(np.pi*x/.22)**2
def shatter(g=1):
    out=np.zeros(int(1.2*sr))
    for i in range(14):
        d=.05+rng.random()*.25; s=hp(noise(d),2000+rng.random()*4000)*np.exp(-X(d)*(20+rng.random()*40)); a=int(rng.random()*.35*sr); out[a:a+len(s)]+=s*(1-i/20)
    return g*out
def key(g=1):
    x=X(.035); return g*hp(noise(.035),1800)*np.exp(-x*200)
def nriser(d,g=1):
    x=X(d); k=x/d; return g*k**2*lp(noise(d),300+8000*k)
E=[]
def ev(t,s,g,pan=0): add(t,s,g,pan)
ev(0.0,impact(1),.55); ev(0.0,uclick(1),.3)
for i in range(6): ev(.7+i*.16,lock(1),.22,pan=(i%2-.5)*.4)
ev(1.6,impact(1),.18)
ev(3.65,whoosh(.4,1),.32)
for i in range(4): ev(4.3+i*.55,blip(1,1200),.10)
ev(6.6,impact(1),.30)
ev(8.28,whoosh(.4,1),.28); ev(8.75,pop(1),.22); ev(10.6,pop(1),.18)
k=0
while 9.4+k*.5<11.8: ev(9.4+k*.5,tick(1),.07); k+=1
ev(12.2,whoosh(.6,1,up=False),.25)
for i in range(7): ev(12.45+i*.12,lp(noise(.08),1800)*np.exp(-X(.08)*50),.10)
for a in (14.9,15.95,17.4): ev(a,pop(1),.2); ev(a,impact(1),.1)
ev(19.42,impact(1),.65); ev(19.42,whoosh(.5,1),.35)
ev(20.45,nriser(.75,1),.18); ev(21.2,impact(1),.42); ev(21.62,blip(1,2000),.12)
ev(23.75,whoosh(.45,1),.32)
for a in (29.76,30.45,31.14,32.49,33.62,34.85,36.6,38.5,40.48): ev(a-.05,swish(1),.16)
for a in (29.95,33.8,35.1,36.8,38.65): ev(a,uclick(1),.28)
ev(30.55,confirm(1),.22); ev(31.35,blip(1,880),.16); ev(31.43,blip(1,880),.12)
ev(39.25,uclick(1),.32)
for i in range(5): ev(40.8+i*.07,blip(1,1400+i*180),.08)
for a in (44.85,45.75,46.95): ev(a,pop(1),.18); ev(a+.35,swish(1),.18)
ev(48.2,whoosh(.5,1),.32); ev(48.34,impact(1),.18)
ev(50.55,impact(1),.55); ev(50.55,whoosh(.3,1),.18); ev(51.25,blip(1,1500),.12)
ev(52.25,whoosh(.45,1),.26); ev(53.6,pop(1),.2); ev(55.55,impact(1),.3)
for i in range(6): ev(56.95+i*.12,lock(1),.18,pan=(i%2-.5)*.4)
ev(58.25,shatter(1),.38); ev(58.25,impact(1),.3)
ev(59.75,nriser(1.4,1),.14); ev(60.75,impact(1),.25)
ev(61.86,impact(1),.5); ev(61.9,blip(1,2000),.1)
for a in (63.9,64.95,66.15): ev(a,impact(1),.22); ev(a,blip(1,1300),.08)
ev(68.6,whoosh(.4,1),.28); ev(68.62,impact(1),.25)
for i in range(12): ev(69.5+i*.063,key(1),.12)
ev(70.3,pop(1),.22); ev(70.6,confirm(1),.18)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk   # peak -6 dBFS
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('sfx2.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok', N/sr)
