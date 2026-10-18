hopon.title="Gnome Whack";hopon.hint="Tap gnomes before they duck! 30s";
const hitS=new Sound([0.5,0,900,0.01,0.05,0.1,0,1,0,0,300]);
const missS=new Sound([0.4,0.1,150,0.01,0.1,0.2,4,1,-3]);
const COLS=3,ROWS=4;
let up:number[]=[],life:number[]=[],pop:number[]=[],whack:number[]=[],left=30,nextSpawn=0;
const hc=(i:number)=>vec2((i%COLS-1)*6,(Math.floor(i/COLS)-1.5)*5.5-0.5);
function gameInit(){setCameraPos(vec2(0,0));const n=COLS*ROWS;up=Array(n).fill(0);life=Array(n).fill(0);pop=Array(n).fill(0);whack=Array(n).fill(0);left=30;nextSpawn=0.5;}
function gameUpdate(){setCameraScale(mainCanvasSize.x/20);
left-=timeDelta;if(left<=0){left=0;hopon.gameOver();return;}
const el=30-left;nextSpawn-=timeDelta;
if(nextSpawn<=0){nextSpawn=Math.max(0.3,0.8-el*0.015);const f=up.map((u,i)=>u?-1:i).filter(i=>i>=0);if(f.length){const i=f[randInt(f.length)];up[i]=1;life[i]=Math.max(0.6,1.4-el*0.025)+rand(0,0.3);}}
for(let i=0;i<up.length;i++){
if(up[i]){life[i]-=timeDelta;pop[i]=Math.min(1,pop[i]+timeDelta*8);if(life[i]<=0)up[i]=0;}
else pop[i]=Math.max(0,pop[i]-timeDelta*8);
if(whack[i]>0)whack[i]-=timeDelta;}
if(mouseWasPressed(0)){for(let i=0;i<up.length;i++){if(up[i]&&pop[i]>0.4&&isOverlapping(mousePos,vec2(0),hc(i).add(vec2(0,1)),vec2(4.6,4.6))){up[i]=0;whack[i]=0.25;hopon.addScore(1);hitS.play();new ParticleEmitter(hc(i).add(vec2(0,1.5)),0,1,0.1,30,3.14,undefined,YELLOW,ORANGE);return;}}missS.play();}}
function gameRender(){drawRectGradient(cameraPos,vec2(100),hsl(0.55,0.6,0.75),hsl(0.3,0.6,0.5));
for(let i=0;i<up.length;i++){const p=hc(i);
drawEllipse(p,vec2(4.4,1.6),hsl(0.08,0.5,0.15));
const h=pop[i];
if(h>0){const g=p.add(vec2(0,-0.2+h*1.8));
drawRect(g.add(vec2(0,-0.3)),vec2(2,2),hsl(0.6,0.7,0.45));
drawCircle(g.add(vec2(0,0.9)),1.7,hsl(0.07,0.5,0.8));
drawRect(g.add(vec2(0,0.2)),vec2(1.6,1.1),WHITE);
drawPoly([vec2(-1,1.6),vec2(1,1.6),vec2(0,3.9)],RED,0,undefined,g);
drawCircle(g.add(vec2(-0.4,1)),0.25,BLACK);drawCircle(g.add(vec2(0.4,1)),0.25,BLACK);
if(whack[i]>0)drawText("BONK",g.add(vec2(0,3)),1,YELLOW,0.1,BLACK);}
drawEllipse(p.add(vec2(0,-0.5)),vec2(4.6,1.4),hsl(0.08,0.5,0.25));}}
function gameRenderPost(){drawTextScreen("⏱ "+Math.ceil(left),vec2(mainCanvasSize.x-60,30),28,left<6?RED:WHITE,3,BLACK);}

const P_BASS=[0.8,0,55,0.005,0.1,0.12,2,0.6];
const P_CHORD=[0.35,0,220,0.005,0.04,0.08,2,1];
const P_LEAD=[0.4,0,440,0.01,0.1,0.12,0,1,0,0,0,0,0,0,0,0,0.05];
const P_HAT=[0.2,0,5000,0,0,0.03,4,1,0,0,0,0,0,0,0,0,0,1,0.01];
const mk=(roots:number[],ch:number[][],mel:number[][])=>{
const b:number[]=[],c1:number[]=[],c2:number[]=[],l:number[]=[],h:number[]=[];
roots.forEach((r,bar)=>{for(let i=0;i<16;i++){
b.push(i%8==0?(i==8?r-5+ (r==15?0:0):r):i%8==4?-0:0);
c1.push(i%8==4?ch[bar][0]:0);c2.push(i%8==4?ch[bar][1]:0);
l.push(mel[bar][i]||0);h.push(i%2==0?(i%4==0?12:12.5):0);}});
return [[0,0,...b],[1,-0.4,...c1],[1,0.4,...c2],[2,0.3,...l],[3,0.5,...h]];};
const C=[19,22],G=[14,17],F=[20,24];
const m1=[15,0,17,0,19,0,22,0,19,0,17,0,15,0,19,0];
const m2=[17,0,19,0,22,0,24,0,22,0,19,0,17,0,14,0];
const m3=[24,0,22,0,20,0,19,0,17,0,19,0,20,0,22,0];
hopon.music=[[P_BASS,P_CHORD,P_LEAD,P_HAT],[
mk([15,15,10,15],[C,C,G,C],[m1,m1,m2,m1]),
mk([20,15,10,15],[F,C,G,C],[m3,m1,m2,[22,0,19,0,15,0,19,0,22,0,24,0,22,0,0,0]])
],[0,1,0,1,0,1,0,1],168];
