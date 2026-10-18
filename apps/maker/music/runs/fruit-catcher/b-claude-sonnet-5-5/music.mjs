
import {writeFileSync} from "node:fs";
const SR=44100,BPM=140,spb=60/BPM,bars=16,len=Math.round(bars*4*spb*SR);
const L=new Float32Array(len),R=new Float32Array(len);
let seed=1;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647-0.5;
const hz=m=>440*2**((m-69)/12);
function add(t,d,f,type,vol,pan,a=0.005,rel=0.1,vib=0){
 const s=Math.floor(t*SR),n=Math.floor((d+rel)*SR);let ph=0;
 for(let i=0;i<n;i++){const j=(s+i)%len,tt=i/SR;
  let env=Math.min(1,tt/a)*(tt<d?1:Math.max(0,1-(tt-d)/rel));
  ph+=hz(f)*(1+vib*Math.sin(tt*40))/SR*(1);ph%=1;
  let v=type==0?(ph<0.25?1:-1):type==1?(ph<0.5?1:-1):type==2?4*Math.abs(ph-0.5)-1:2*ph-1;
  v*=env*vol;L[j]+=v*(1-pan)*0.5*2*0.5;R[j]+=v*(1+pan)*0.5*2*0.5;}}
function drum(t,kind,vol){
 const s=Math.floor(t*SR),n=Math.floor((kind=='h'?0.05:kind=='s'?0.15:0.18)*SR);let ph=0;
 for(let i=0;i<n;i++){const j=(s+i)%len,tt=i/SR;let v;
  if(kind=='k'){ph+=(130*Math.exp(-tt*25)+45)/SR;v=Math.sin(ph*6.283)*Math.exp(-tt*14);}
  else if(kind=='s')v=rnd()*2*Math.exp(-tt*25)+Math.sin(tt*1800)*Math.exp(-tt*30)*0.3;
  else v=rnd()*2*Math.exp(-tt*80)*0.6;
  L[j]+=v*vol;R[j]+=v*vol;}}
// C G Am F | C G F G  ; chord roots and thirds
const prog=[[0,4,7],[7,11,14],[9,12,16],[5,9,12],[0,4,7],[7,11,14],[5,9,12],[7,11,14]];
const roots=[48,43,45,41,48,43,41,43];
const mel=[[0,2,4,7,4,2,4,0],[2,4,7,9,7,4,2,4],[4,7,9,12,9,7,4,2],[5,7,9,12,9,7,5,4]];
const maj=[0,2,4,5,7,9,11];
const sc=d=>60+12*Math.floor(d/7)+maj[((d%7)+7)%7];
for(let b=0;b<bars;b++){
 const c=b%8,ch=prog[c],T=b*4*spb,sec=b<2?0:b<8?1:b<12?2:3;
 for(let e=0;e<8;e++){const t=T+e*spb/2;
  // bass bouncy octaves
  add(t,spb*0.4,roots[c]-12+(e%2?12:0),2,0.35,0,0.003,0.05);
  // arpeggio
  if(b>=2)add(t,spb*0.25,60+ch[e%3]+12,0,0.1,e%2?0.4:-0.4,0.003,0.06);
  // melody
  if(b>=2){const base=sec==2?[4,6,8,11,8,6,4,2]:mel[(b>>1)%4];
   const dg=sec==2?base[e]:base[e]+ (b%2?1:0);
   add(t,spb*0.45,sc(dg)+(sec==3?12:0)-0*1,1,0.16,0,0.004,0.12,0.004);}
  else if(e%2==0)add(t,spb*0.8,72+ch[(e/2)%3],2,0.18,0,0.01,0.2,0.003);
  if(e%2==0&&b>=1)drum(t,'h',0.12);else if(b>=1)drum(t,'h',0.07);
 }
 for(let q=0;q<4;q++){const t=T+q*spb;
  if(q%2==0)drum(t,'k',0.7);if(q%2==1&&b>=1)drum(t,'s',0.3);}
 if(b==0)for(let q=0;q<4;q++)drum(T+q*spb,'h',0.1);
 // pad
 for(const n of ch)add(T,4*spb*0.95,n+60-12,2,0.04,0,0.05,0.4);
}
let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(L[i]),Math.abs(R[i]));
const out=Buffer.alloc(len*4);
for(let i=0;i<len;i++){out.writeInt16LE(Math.round(Math.tanh(L[i]/pk*1.1)*30000),i*4);out.writeInt16LE(Math.round(Math.tanh(R[i]/pk*1.1)*30000),i*4+2);}
const h=Buffer.alloc(44);h.write("RIFF");h.writeUInt32LE(36+out.length,4);h.write("WAVEfmt ",8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(2,22);h.writeUInt32LE(SR,24);h.writeUInt32LE(SR*4,28);h.writeUInt16LE(4,32);h.writeUInt16LE(16,34);h.write("data",36);h.writeUInt32LE(out.length,40);
writeFileSync("music.wav",Buffer.concat([h,out]));
