
import {writeFileSync} from "node:fs";
const SR=44100,BPM=140,spb=60/BPM,bars=16,beats=bars*4;
const N=Math.round(beats*spb*SR);
const L=new Float32Array(N),R=new Float32Array(N);
const f=m=>440*2**((m-69)/12);
function add(t,d,fn,gl,gr,tail=0.3){const s=Math.floor(t*SR),n=Math.floor((d+tail)*SR);
for(let i=0;i<n;i++){const k=(s+i)%N,v=fn(i/SR,d);L[k]+=v*gl;R[k]+=v*gr;}}
let seed=1;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/2**31-1;
const saw=p=>2*(p%1)-1;
function env(t,d,a,r){return Math.min(t/a,1)*(t<d?1:Math.exp(-(t-d)/r*5));}
const prog=[57,53,48,55]; // Am F C G roots
const chords=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]];
function bass(t,m,d){add(t,d,(x,dd)=>{const fr=f(m-12);return (saw(x*fr)*0.6+Math.sin(6.283*x*fr)*0.4)*env(x,dd,.005,.08)*0.3},.7,.7,.05);}
function lead(t,m,d,p){add(t,d,(x,dd)=>{const fr=f(m);return (saw(x*fr*1.004)+saw(x*fr*0.996))*0.5*env(x,dd,.01,.2)*0.12},.5+.3*p,.8-.3*p,.5);}
function pad(t,c,d){for(const m of c)add(t,d,(x,dd)=>{const fr=f(m);return (saw(x*fr*1.006)+saw(x*fr*.994))*0.5*env(x,dd,.4,.6)*0.04},.8,.8,.8);}
function kick(t){add(t,.2,(x)=>Math.sin(6.283*(50*x+ 12*(1-Math.exp(-x*30))*0+ 90*(1-Math.exp(-x*25))/25*0+0))*0, 0,0,0);
add(t,.3,(x)=>Math.sin(6.283*(45*x+ (110/30)*(1-Math.exp(-30*x))))*Math.exp(-x*12)*0.9,.8,.8,0);}
function snare(t){add(t,.2,(x)=>(rnd()*0.5+Math.sin(6.283*190*x)*0.4)*Math.exp(-x*20)*0.5,.7,.7,0);}
function hat(t,o){add(t,.05,(x)=>rnd()*Math.exp(-x*(o?30:90))*0.18,.6,.8,0);}
for(let b=0;b<bars;b++){
 const sec=b<2?0:b<8?1:b<12?2:3; const c=b%4, t0=b*4*spb;
 const ch=chords[c];
 if(sec>0||b>=0)pad(t0,ch,4*spb);
 if(sec>=1||b>=1)for(let i=0;i<8;i++)bass(t0+i*spb/2,prog[c]+(i%4==3?12:0),spb*.45);
 const drums=b>=1;
 if(drums)for(let i=0;i<4;i++){const t=t0+i*spb;kick(t);if(i%2)snare(t);hat(t+spb/2,1);if(sec>=1){hat(t,0);hat(t+spb/4,0);hat(t+spb*.75,0);}}
 if(sec>=1){const arp=[0,1,2,1,0,1,2,1];for(let i=0;i<8;i++)if(sec!=1||b%2||i%2==0)lead(t0+i*spb/2,ch[arp[i]]+12,spb*.4,i/8);}
 if(sec>=2){const mel=[[0,7,5,4],[5,4,0,-1],[7,9,7,4],[2,4,2,0]][c];
  for(let i=0;i<4;i++)if(mel[i]>=0)lead(t0+i*spb,69+mel[i]+(sec==3?12:0),spb*.9,.5);}
}
// simple delay
const dl=Math.floor(spb*.75*SR);
for(let i=0;i<N;i++){for(let k=1;k<=3;k++){const j=(i-dl*k+N*4)%N;L[i]+=R[j]*0.15/k;R[i]+=L[j]*0.15/k;}}
let pk=0;for(let i=0;i<N;i++)pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));
const g=0.9/pk,buf=Buffer.alloc(44+N*4);
buf.write("RIFF",0);buf.writeUInt32LE(36+N*4,4);buf.write("WAVEfmt ",8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(SR,24);buf.writeUInt32LE(SR*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write("data",36);buf.writeUInt32LE(N*4,40);
for(let i=0;i<N;i++){buf.writeInt16LE(Math.round(Math.tanh(L[i]*g)*32000),44+i*4);buf.writeInt16LE(Math.round(Math.tanh(R[i]*g)*32000),46+i*4);}
writeFileSync("music.wav",buf);console.log("dur",N/SR);
