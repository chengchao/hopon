
import {writeFileSync} from "node:fs";
const SR=44100,BPM=100,beat=60/BPM,bars=16,spb=4;
const total=Math.round(bars*spb*beat*SR);
const L=new Float32Array(total),R=new Float32Array(total);
const f=n=>440*2**((n-69)/12);
// chords per bar (4 bars each repeat): Am F C G
const chords=[[57,60,64],[53,57,60],[48,55,64],[55,59,62]];
const roots=[33,29,36,31];
let seed=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647-.5;
function add(t0,dur,fr,vol,pan,type,rel,att){
 const n=Math.floor((dur+rel)*SR),s0=Math.floor(t0*SR);let ph=0,ph2=0;
 for(let i=0;i<n;i++){const t=i/SR;
  let e=Math.min(1,t/att)*(t<dur?1:Math.exp(-(t-dur)*5/rel));
  ph+=fr/SR;ph2+=fr*1.006/SR;
  let v;
  if(type=="saw")v=((ph%1)*2-1+((ph2%1)*2-1))*.5;
  else if(type=="sine")v=Math.sin(6.283*ph);
  else v=Math.sin(6.283*ph)+.3*Math.sin(12.566*ph);
  v*=e*vol;const k=(s0+i)%total;
  L[k]+=v*(1-pan)/1;R[k]+=v*(1+pan)/1;}
}
function drum(t0,kind){
 const s0=Math.floor(t0*SR),len=Math.floor((kind=="k"?.3:kind=="h"?.05:.2)*SR);let ph=0;
 for(let i=0;i<len;i++){const t=i/SR;let v;
  if(kind=="k"){ph+=(45+90*Math.exp(-t*30))/SR;v=Math.sin(6.283*ph)*Math.exp(-t*10)*.5;}
  else if(kind=="h")v=rnd()*Math.exp(-t*90)*.12;
  else v=rnd()*Math.exp(-t*20)*.2;
  const k=(s0+i)%total;L[k]+=v;R[k]+=v;}
}
for(let b=0;b<bars;b++){
 const c=chords[b%4],t=b*4*beat,sec=b<4?0:b<8?1:b<12?2:1;
 for(const n of c)add(t,4*beat,f(n),.06,(n%3-1)*.4,"saw",1.5,.8);
 if(sec>0)for(let i=0;i<8;i++)add(t+i*beat/2,beat/2,f(roots[b%4]+12),.14,0,"sine",.15,.01);
 else add(t,4*beat,f(roots[b%4]),.15,0,"sine",.5,.3);
 if(sec>=1)for(let i=0;i<4;i++){drum(t+i*beat,i%2?"s":"k");if(i%2==0)drum(t+i*beat,"k");}
 if(sec>=1)for(let i=0;i<8;i++)drum(t+i*beat/2+beat/4*0,"h");
 if(sec>=1){const sc=[0,3,7,10,12,7,5,3];
  for(let i=0;i<8;i++)if((i+b)%3!=2||sec==2){const n=c[i%3]+12+(sec==2?12:0)+(i>4?0:0);
   add(t+i*beat/2,beat*.4,f(n),.07,i%2?.5:-.5,"pl",.5,.005);}}
}
// delay/echo wrapped
const d=Math.round(beat*.75*SR);
for(let p=0;p<3;p++){const l=L.slice(),r=R.slice();
 for(let i=0;i<total;i++){L[i]+=r[(i-d+total)%total]*.3;R[i]+=l[(i-d+total)%total]*.3;}}
let m=0;for(let i=0;i<total;i++)m=Math.max(m,Math.abs(L[i]),Math.abs(R[i]));
const out=Buffer.alloc(44+total*4);
out.write("RIFF",0);out.writeUInt32LE(36+total*4,4);out.write("WAVEfmt ",8);out.writeUInt32LE(16,16);
out.writeUInt16LE(1,20);out.writeUInt16LE(2,22);out.writeUInt32LE(SR,24);out.writeUInt32LE(SR*4,28);
out.writeUInt16LE(4,32);out.writeUInt16LE(16,34);out.write("data",36);out.writeUInt32LE(total*4,40);
for(let i=0;i<total;i++){out.writeInt16LE(Math.round(L[i]/m*.85*32767),44+i*4);out.writeInt16LE(Math.round(R[i]/m*.85*32767),46+i*4);}
writeFileSync("music.wav",out);console.log("duration",total/SR);
