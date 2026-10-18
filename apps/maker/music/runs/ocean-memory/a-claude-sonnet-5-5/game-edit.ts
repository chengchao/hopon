hopon.title="Ocean Pairs";hopon.hint="Flip cards, match all pairs";
const C=4,R=5,S=4.2;
const flipS=new Sound([0.4,0,500,0,0.02,0.05,1]);
const ok=new Sound([0.5,0,900,0.01,0.05,0.1,0,1,0,0,300]);
const win=new Sound([1,0,520,0.05,0.3,0.4,0,1,0,0,260,0.08]);
let cards:number[]=[],up:boolean[]=[],done:boolean[]=[],sel:number[]=[],wait=0,pairs=0;
const cp=(i:number)=>vec2((i%C-(C-1)/2)*S,((R-1)/2-Math.floor(i/C))*S-0.5);
function gameInit(){setCameraPos(vec2(0,0));const a:number[]=[];for(let i=0;i<10;i++)a.push(i,i);
for(let i=a.length-1;i>0;i--){const j=randInt(i+1);[a[i],a[j]]=[a[j],a[i]];}
cards=a;up=a.map(()=>false);done=a.map(()=>false);sel=[];wait=0;pairs=0;}
function gameUpdate(){setCameraScale(mainCanvasSize.x/20);
if(wait>0){wait-=timeDelta;if(wait<=0){const[a,b]=sel;if(cards[a]==cards[b]){done[a]=done[b]=true;pairs++;hopon.addScore(10);ok.play();
if(pairs==10){win.play();hopon.gameOver(true);}}else{up[a]=up[b]=false;}sel=[];}return;}
if(!mouseWasPressed(0))return;
for(let i=0;i<20;i++)if(!up[i]&&isOverlapping(mousePos,vec2(0),cp(i),vec2(S-0.4))){up[i]=true;sel.push(i);flipS.play();if(sel.length==2)wait=0.7;break;}}
function fish(p:Vector2,k:number){const h=k*0.1+0.02,c=hsl(h,0.8,0.6),d=hsl(h+0.5,0.7,0.5);
switch(k){
case 0:drawEllipse(p,vec2(2,1.2),ORANGE);drawPoly([vec2(0.8,0),vec2(1.5,0.6),vec2(1.5,-0.6)],ORANGE,0,undefined,p);drawRect(p,vec2(0.2,1),WHITE);break;
case 1:drawEllipse(p,vec2(2.4,1.4),BLUE);drawPoly([vec2(-1,0),vec2(-1.7,0.5),vec2(-1.7,-0.5)],BLUE,0,undefined,p);drawLine(p.add(vec2(-.8,.1)),p.add(vec2(1,.5)),0.1,WHITE);break;
case 2:drawEllipse(p,vec2(2.6,1.2),GRAY);drawPoly([vec2(-0.5,0.5),vec2(0,1.4),vec2(0.4,0.5)],GRAY,0,undefined,p);drawPoly([vec2(1.2,0),vec2(1.9,0.5),vec2(1.9,-0.5)],GRAY,0,undefined,p);break;
case 3:drawCircle(p,1.6,RED);for(let i=0;i<5;i++){const a=i*1.256;drawLine(p,p.add(vec2(Math.cos(a),Math.sin(a)).scale(1.4)),0.4,RED);}break;
case 4:drawCircle(p.add(vec2(0,0.4)),1.6,PURPLE);for(let i=-1;i<2;i++)drawLine(p.add(vec2(i*.5,0)),p.add(vec2(i*.6,-1.4)),0.25,PURPLE);break;
case 5:drawCircle(p,1.8,hsl(0.15,0.8,0.6));for(let i=0;i<6;i++)drawCircle(p.add(vec2(Math.cos(i*1.05),Math.sin(i*1.05)).scale(0.8)),0.3,ORANGE);break;
case 6:drawEllipse(p,vec2(2.2,1.6),GREEN);drawCircle(p.add(vec2(1.1,0.4)),0.8,GREEN);drawEllipse(p.add(vec2(-.6,-.8)),vec2(1,.4),GREEN);break;
case 7:drawPoly([vec2(0,1.2),vec2(.4,.4),vec2(1.2,.3),vec2(.6,-.3),vec2(.8,-1.1),vec2(0,-.6),vec2(-.8,-1.1),vec2(-.6,-.3),vec2(-1.2,.3),vec2(-.4,.4)],YELLOW,0,undefined,p);break;
case 8:drawEllipse(p,vec2(3,1),CYAN);drawPoly([vec2(1,0),vec2(1.8,.6),vec2(1.8,-.6)],CYAN,0,undefined,p);drawCircle(p.add(vec2(-.9,.15)),.2,BLACK);break;
default:drawCircle(p,1.8,hsl(0.9,0.5,0.8));drawCircle(p.add(vec2(0,0.2)),0.8,hsl(0.9,0.6,0.6));}
if(k<8)drawCircle(p.add(vec2(k==3||k==4||k==5?0:-0.6,0.2)),0.25,BLACK);}
function gameRender(){drawRectGradient(cameraPos,vec2(100),hsl(0.55,0.8,0.5),hsl(0.62,0.8,0.2));
for(let i=0;i<20;i++){const p=cp(i);const s=vec2(S-0.4);
if(done[i])drawRect(p,s,hsl(0.4,0.5,0.7,0.5));
else if(up[i]){drawRect(p,s,hsl(0.55,0.3,0.92));fish(p,cards[i]);}
else{drawRect(p,s,hsl(0.6,0.6,0.35));drawCircle(p,1.4,hsl(0.55,0.6,0.5));drawText("?",p,2,WHITE);}
if(done[i])fish(p,cards[i]);}}
const MAR=[0.6,0,440,0.01,0.02,0.7,0,1.5,0,0,0,0,0,0,0,0,0.1,0.5,0.1,0,0.3];
const PADI=[0.35,0,110,0.8,1,1.2,0,1,0,0,0,0,0,0,0,0,0.3,0.7,0,0.1];
const SBASS=[0.7,0,55,0.1,0.6,0.6,0];
const row=(n:number,m:Record<number,number>)=>{const a:number[]=new Array(n).fill(0);for(const k in m)a[+k]=m[k];return a;};
hopon.music=[[MAR,PADI,SBASS],[
[[0,0.4,...row(32,{0:24,5:23,12:19,20:18,26:12})],
 [1,-0.4,...row(32,{0:12,16:13})],[2,0,...row(32,{0:0,16:0})]],
[[0,-0.4,...row(32,{0:27,6:24,10:23,18:20,24:18})],
 [1,0.4,...row(32,{0:8,16:7})],[2,0,...row(32,{0:-1,2:8,16:7})]],
[[0,0.4,...row(32,{4:31,10:30,20:24,28:23})],
 [1,-0.4,...row(32,{0:12,16:10})],[2,0,...row(32,{0:0,16:2})]]
],[0,1,0,2,1,0,2,1],64];
