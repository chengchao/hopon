
import {writeFileSync} from "node:fs";
const SR=44100,BPM=76,beat=60/BPM,bars=12,total=bars*4*beat;
const N=Math.round(total*SR);
const L=new Float32Array(N),R=new Float32Array(N);
const f=m=>440*2**((m-69)/12);
function add(t,dur,m,vol,pan,type){
  const fr=f(m),s=Math.floor(t*SR),len=Math.floor((dur)*SR);
  for(let i=0;i<len;i++){
    const x=i/SR;let v;
    if(type=="mar"){v=(Math.sin(2*Math.PI*fr*x)+0.3*Math.sin(2*Math.PI*fr*4*x)*Math.exp(-x*30))*Math.exp(-x*5);}
    else {const a=Math.min(1,x/1.5),r=Math.min(1,(len-i)/(SR*1.5));v=(Math.sin(2*Math.PI*fr*x)+0.5*Math.sin(2*Math.PI*fr*1.012*x+0.8*Math.sin(2*Math.PI*0.2*x)))*a*r*0.5;}
    const j=(s+i)%N;L[j]+=v*vol*(1-pan)/2*1.4;R[j]+=v*vol*(1+pan)/2*1.4;
  }
}
const chords=[[57,60,64],[58,62,65],[54,57,60],[52,56,59]];
for(let b=0;b<bars;b++){
  const c=chords[b%4],t0=b*4*beat;
  if(b%2==0){add(t0,8*beat,c[0]-12,0.25,0,"pad");add(t0,8*beat,c[1],0.12,-0.4,"pad");add(t0,8*beat,c[2],0.12,0.4,"pad");}
  if(b>=2){
    const pat=[0,2,1,2,0,1,2,1];
    for(let k=0;k<8;k++){ if(b>=4&&b<12||k%2==0){
      const m=c[pat[k]]+12+(b>=8&&k==7?12:0);
      add(t0+k*beat/2,2.5,m,0.3,Math.sin(k+b)*0.6,"mar");}}
  }
  if(b>=6&&b<14)add(t0+2.5*beat,3,c[2]+25,0.15,0.7,"mar");
}
// echo/reverb
const D=[[0.29,0.35],[0.43,0.3],[0.61,0.22]];
const oL=Float32Array.from(L),oR=Float32Array.from(R);
for(const [d,g] of D){const o=Math.floor(d*SR);for(let i=0;i<N;i++){const j=(i+o)%N;oL[j]+=R[i]*g*0.6;oR[j]+=L[i]*g*0.6;}}
let pk=0;for(let i=0;i<N;i++)pk=Math.max(pk,Math.abs(oL[i]),Math.abs(oR[i]));
const buf=Buffer.alloc(44+N*4);
buf.write("RIFF",0);buf.writeUInt32LE(36+N*4,4);buf.write("WAVEfmt ",8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(SR,24);buf.writeUInt32LE(SR*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write("data",36);buf.writeUInt32LE(N*4,40);
for(let i=0;i<N;i++){buf.writeInt16LE(Math.round(oL[i]/pk*26000),44+i*4);buf.writeInt16LE(Math.round(oR[i]/pk*26000),46+i*4);}
writeFileSync("music.wav",buf);
