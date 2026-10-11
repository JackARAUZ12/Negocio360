import numpy as np, wave
rng=np.random.default_rng(7)
import os
sr=44100; DUR=float(os.environ["DUR"]); DROP=float(os.environ["DROP"]); BPM=float(os.environ["BPM"]); B=60/BPM; S16=B/4
N=int(sr*DUR); L=np.zeros(N); R=np.zeros(N)
nf=lambda m:440*2**((m-69)/12)
X=lambda d:np.arange(int(d*sr))/sr
def add(at,sig,g=1.0,pan=0.0,bus=None):
    a=int(at*sr)
    if a>=N or a<0 and a+len(sig)<=0: return
    if a<0: sig=sig[-a:]; a=0
    b=min(N,a+len(sig)); s=sig[:b-a]*g
    (bus or (L,R))[0][a:b]+=s*(1-pan)/1 if pan>0 else s
    (bus or (L,R))[1][a:b]+=s*(1+pan)/1 if pan<0 else s
def noise(d): return rng.standard_normal(int(d*sr))
def lp(sig,cut):  # one-pole lowpass, cut can be array
    cut=np.broadcast_to(cut,sig.shape); a=1-np.exp(-2*np.pi*cut/sr); y=np.zeros_like(sig); z=0.0
    for i in range(len(sig)): z+=a[i]*(sig[i]-z); y[i]=z
    return y
def hp(sig,cut): return sig-lp(sig,cut)
# ---------- instruments
def kick(g=1):
    x=X(.45); f=42+190*np.exp(-x*38); return g*np.tanh(2.2*np.exp(-x*6)*np.sin(2*np.pi*np.cumsum(f)/sr))
def clap(g=1):
    x=X(.3); n=noise(.3); env=np.exp(-x*22)
    for o in (.0,.011,.022): env+=np.where(x>=o,np.exp(-(x-o)*140),0)*.8
    return g*hp(n,900)*env*.5
def hat(g=1,d=.05):
    x=X(d); return g*hp(noise(d),7000)*np.exp(-x*(3/d))
def cowbell(m,g=1,d=.35):
    x=X(d); f=nf(m); s=np.sign(np.sin(2*np.pi*f*x))+np.sign(np.sin(2*np.pi*f*1.4836*x))
    env=np.exp(-x*9)*(1-np.exp(-x*900)); return g*np.tanh(1.5*s*env)*.5
def b808(m,d,g=1,glide_from=None):
    x=X(d); f=np.full_like(x,nf(m))
    if glide_from is not None: f=nf(m)+(nf(glide_from)-nf(m))*np.exp(-x*18)
    env=np.minimum(1,x/.005)*np.exp(-x*1.2)*np.minimum(1,(d-x)/.03)
    return g*np.tanh(2.5*np.sin(2*np.pi*np.cumsum(f)/sr))*env
def boom(g=1,d=2.0):
    x=X(d); f=30+90*np.exp(-x*6); return g*(np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*1.8)+lp(noise(d),400)*np.exp(-x*5)*1.5)
def thud(g=1):
    x=X(.18); f=70+120*np.exp(-x*40); return g*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-x*25)+g*.3*lp(noise(.18),1500)*np.exp(-x*40)
def stamp(g=1):
    x=X(.35); return g*(np.tanh(3*np.sin(2*np.pi*np.cumsum(55+200*np.exp(-x*50))/sr))*np.exp(-x*14)+.6*lp(noise(.35),2500)*np.exp(-x*30))
def coin(g=1,p=0):
    x=X(.12); f=2600*2**(p/12); return g*(np.sin(2*np.pi*f*x)+.5*np.sin(2*np.pi*f*1.5*x))*np.exp(-x*35)
def kaching(g=1):
    x=X(.9); s=sum(np.sin(2*np.pi*f*x)*np.exp(-x*k) for f,k in ((2093,5),(2637,6),(3136,7),(4186,8)))
    return g*(s/3+.4*hp(noise(.9),5000)*np.exp(-x*20))
def tick(g=1):
    x=X(.03); return g*np.sin(2*np.pi*3200*x)*np.exp(-x*250)
def whoosh(d=.45,g=1,up=True):
    n=noise(d); x=X(d); c=np.linspace(400,6000,len(n)) if up else np.linspace(6000,400,len(n))
    return g*lp(n,c)*np.sin(np.pi*x/d)**2
def glitchn(d=.08,g=1):
    n=noise(d); n=np.round(n*3)/3; x=X(d); return g*n*np.sign(np.sin(2*np.pi*rng.uniform(80,400)*x))*.5
def riser(d,g=1):
    x=X(d); k=x/d; f=150+3000*k**2.2; return g*k**2*(np.sin(2*np.pi*np.cumsum(f)/sr)*.5+lp(noise(d),300+9000*k)*.8)
def revcym(d,g=1):
    x=X(d); return g*(hp(noise(d),4000)*(x/d)**3)
def ding(g=1):
    x=X(1.0); return g*(np.sin(2*np.pi*1318.5*x)*np.exp(-x*4)+np.sin(2*np.pi*1975.5*x)*np.exp(-x*5)*.6)
def sparkle(g=1):
    out=np.zeros(int(1.2*sr))
    for i,m in enumerate([84,88,91,96,100]):
        c=coin(1,m-84); a=int(i*.06*sr); out[a:a+len(c)]+=c
    return g*out
