
import {writeFileSync} from "node:fs";
const SR=44100,BPM=152,beat=60/BPM,bars=16,len=Math.round(bars*4*beat*SR);
const L=new Float32Array(len),R=new Float32Array(len);
const f=n=>440*2**((n-69)/12);
function add(t,d,n,type,vol,pan=0,rel=0.1){
 const s=Math.floor(t*SR),N=Math.floor((d+rel)*SR),fr=f(n);let ph=0;
 for(let i=0;i<N;i++){
  ph+=fr/SR;const p=ph%1;
  let v=type=='sq'?(p<.5?1:-1):type=='tri'?4*Math.abs(p-.5)-1:type=='saw'?2*p-1:Math.sin(6.283*p);
  const tt=i/SR;let e=Math.min(1,tt/.006)*(tt<d?1:Math.exp(-(tt-d)/rel*4))*Math.exp(-tt*(type=='sq'?3:1.5));
  const o=v*e*vol,j=(s+i)%len;
  L[j]+=o*(1-pan)/2*1.4;R[j]+=o*(1+pan)/2*1.4;}
}
function noise(t,d,vol,hp,pan=0){
 const s=Math.floor(t*SR),N=Math.floor(d*SR);let last=0;
 for(let i=0;i<N;i++){const w=Math.random()*2-1;const h=w-last;last=w*(hp?.5:.95);
  const o=(hp?h:w)*vol*Math.exp(-i/N*6),j=(s+i)%len;L[j]+=o*(1-pan)/2;R[j]+=o*(1+pan)/2;}
}
function kick(t){const s=Math.floor(t*SR),N=Math.floor(.15*SR);let ph=0;
 for(let i=0;i<N;i++){ph+=(45+90*Math.exp(-i/SR*40))/SR;const o=Math.sin(6.283*ph)*Math.exp(-i/SR*20)*.5,j=(s+i)%len;L[j]+=o;R[j]+=o;}}
// progression per bar (root midi, major?) C C G C F C G C ; B: Am D G C ...
const A=[[48,55],[48,55],[43,50],[48,55],[53,60],[48,55],[43,50],[48,55]];
const B=[[45,52],[50,57],[43,50],[48,55],[45,52],[50,57],[43,50],[48,55]];
const prog=[...A,...B].map(x=>x);
const maj=[0,4,7],
 mel=[
 [76,72,67,72,76,79,76,72],[74,77,74,71,67,71,74,77],
 [72,76,79,84,79,76,72,67],[71,74,77,74,71,67,71,74]];
// bar chord tones
const chords=[[60,64,67],[60,64,67],[59,62,67],[60,64,67],[60,65,69],[60,64,67],[59,62,67],[60,64,67],
 [57,60,64],[57,62,66],[59,62,67],[60,64,67],[57,60,64],[57,62,66],[59,62,67],[60,64,67]];
const scaleC=[60,62,64,65,67,69,71,72,74,76,77,79,81,84];
for(let b=0;b<bars;b++){
 const t0=b*4*beat,[r,fi]=prog[b],ch=chords[b],sec=b<4?0:b<8?1:b<12?2:3;
 for(let k=0;k<4;k++){
  const t=t0+k*beat;
  if(k%2==0){add(t,beat*.4,k==2&&b%2?fi:r,'tri',.5,-.1,.05);kick(t);}
  else{ch.forEach((n,i)=>add(t,beat*.3,n,'sq',.06,.3-i*.05,.04));noise(t,.12,.18,1,.1);}
 }
 if(b<4&&b<2){}// intro lighter lead
 // melody: eighth notes, 8 per bar... 4 beats=8 eighths
 const m=mel[b%4];
 for(let i=0;i<8;i++){
  if(sec==0&&b<2&&i%2)continue;
  let n=m[i];const ch2=chords[b];
  if(sec>=2){n=m[(i+b)%8]+(sec==3?0:-0);}
  if(b>=8&&b<12)n=ch[(i*2+b)%3]+12+(i%3==2?2:0)-(i>5?12:0);
  add(t0+i*beat/2,beat*.4,n,sec==1?'saw':'sq',sec==1?.07:.09,-.3,.06);
  if(sec>=1)add(t0+i*beat/2,beat*.4,n-12,'sin',.05,.2,.05);
 }
}
// delay
const dl=Math.floor(beat*.75*SR);
for(let i=0;i<len;i++){const j=(i+dl)%len;}
const L2=new Float32Array(L),R2=new Float32Array(R);
for(let i=0;i<len;i++){const j=(i+dl)%len;L2[j]+=R[i]*.2;R2[j]+=L[i]*.2;}
let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(L2[i]),Math.abs(R2[i]));
const g=.85/pk,buf=Buffer.alloc(44+len*4);
buf.write("RIFF",0);buf.writeUInt32LE(36+len*4,4);buf.write("WAVEfmt ",8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(SR,24);buf.writeUInt32LE(SR*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write("data",36);buf.writeUInt32LE(len*4,40);
for(let i=0;i<len;i++){buf.writeInt16LE(Math.round(Math.tanh(L2[i]*g)*32000),44+i*4);buf.writeInt16LE(Math.round(Math.tanh(R2[i]*g)*32000),46+i*4);}
writeFileSync("music.wav",buf);console.log("duration",len/SR);
