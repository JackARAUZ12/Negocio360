import json
from sfxlib import *
S=json.load(open('pv_events.json'))['S']
def tapc(g=1):
    x=X(.03); return g*(np.sin(2*np.pi*1500*x)*np.exp(-x*260)+.5*hp(noise(.03),4000)*np.exp(-x*300))
def keyc(g=1):
    x=X(.025); return g*(hp(noise(.025),2500)*np.exp(-x*320)+.4*np.sin(2*np.pi*2400*x)*np.exp(-x*400))
def swipe(g=1):
    n=noise(.3); x=X(.3); return g*lp(hp(n,800),np.linspace(5000,1500,len(n)))*np.sin(np.pi*x/.3)**2
def blip(g=1,f=1600):
    x=X(.09); return g*np.sin(2*np.pi*f*x)*np.exp(-x*45)*np.minimum(1,x/.002)
def send(g=1):
    n=noise(.25); x=X(.25); return g*lp(hp(n,1500),np.linspace(2000,9000,len(n)))*np.sin(np.pi*x/.25)**2
def notif(g=1):
    out=np.zeros(int(.4*sr)); a=blip(1,1318); b=blip(1,1760); out[:len(a)]+=a; o=int(.11*sr); out[o:o+len(b)]+=b; return g*out
for t in S['tap']: add(t,tapc(1),.35)
for t in S['key']: add(t,keyc(1),.30,pan=.1)
for t in S['swipe']: add(t,swipe(1),.30)
for t in S['open']: add(t,swipe(1),.22); add(t+.05,blip(1,880),.08)
for t in S['send']: add(t,send(1),.30)
for t in S['notif']: add(t,notif(1),.22)
for t in S['ding']: add(t,coin(1,0),.14); add(t+.1,coin(1,4),.12)
pk=max(np.abs(L).max(),np.abs(R).max()); L*=.5/pk; R*=.5/pk
d=(np.stack([L,R],1)*32767).astype(np.int16)
w=wave.open('sfxpov.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(d.tobytes()); w.close(); print('ok')
