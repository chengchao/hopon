
hopon.title="Neon Snake";hopon.hint="Swipe to turn";
const GW=18,GH=24;
const eat=new Sound([0.5,0,900,0.01,0.05,0.1,0,1,0,0,300]);
const crash=new Sound([1,0.1,120,0.02,0.2,0.4,4,2,-5]);
let snake:Vector2[]=[],dir=vec2(1,0),nd=vec2(1,0),food=vec2(0,0),tick=0,sp=0.14,start:Vector2|null=null;
function place(){for(let i=0;i<200;i++){food=vec2(randInt(GW),randInt(GH));if(!snake.some(s=>s.x==food.x&&s.y==food.y))return;}}
function gameInit(){setCameraPos(vec2(0,0));snake=[vec2(9,12),vec2(8,12),vec2(7,12)];dir=vec2(1,0);nd=vec2(1,0);tick=0;sp=0.14;start=null;place();}
function turn(d:Vector2){if(d.x!==-dir.x||d.y!==-dir.y)nd=d;}
function gameUpdate(){
setCameraScale(mainCanvasSize.x/20);
if(mouseWasPressed(0))start=mousePosScreen.copy();
if(start&&mouseIsDown(0)){const d=mousePosScreen.subtract(start);if(d.length()>25){
turn(Math.abs(d.x)>Math.abs(d.y)?vec2(Math.sign(d.x),0):vec2(0,-Math.sign(d.y)));start=mousePosScreen.copy();}}
if(keyWasPressed("ArrowLeft"))turn(vec2(-1,0));if(keyWasPressed("ArrowRight"))turn(vec2(1,0));
if(keyWasPressed("ArrowUp"))turn(vec2(0,1));if(keyWasPressed("ArrowDown"))turn(vec2(0,-1));
tick+=timeDelta;if(tick<sp)return;tick=0;
dir=nd;const h=snake[0].add(dir);
const ate=h.x==food.x&&h.y==food.y;
const body=ate?snake:snake.slice(0,-1);
if(h.x<0||h.y<0||h.x>=GW||h.y>=GH||body.some(s=>s.x==h.x&&s.y==h.y)){
crash.play();new ParticleEmitter(cell(snake[0]),0,1,0.2,60,3.14,undefined,MAGENTA,CYAN);hopon.gameOver();return;}
snake.unshift(h);
if(ate){hopon.addScore(1);eat.play();sp=Math.max(0.06,sp-0.003);place();}else snake.pop();}
function cell(c:Vector2){return vec2(c.x-GW/2+0.5,c.y-GH/2+0.5);}
function gameRender(){
drawRect(cameraPos,vec2(100),hsl(0.75,0.6,0.05));
drawRect(vec2(0,0),vec2(GW+0.3,GH+0.3),hsl(0.85,1,0.5));
drawRect(vec2(0,0),vec2(GW,GH),hsl(0.72,0.6,0.07));
for(let x=0;x<=GW;x++)drawLine(vec2(x-GW/2,-GH/2),vec2(x-GW/2,GH/2),0.02,hsl(0.7,0.5,0.15));
for(let y=0;y<=GH;y++)drawLine(vec2(-GW/2,y-GH/2),vec2(GW/2,y-GH/2),0.02,hsl(0.7,0.5,0.15));
const p=1+0.2*Math.sin(time*8);
drawCircle(cell(food),1.5*p,hsl(0.15,1,0.5,0.25));
drawCircle(cell(food),0.7*p,hsl(0.15,1,0.6));
snake.forEach((s,i)=>{const c=hsl((0.5+i*0.02)%1,1,0.55);
drawRect(cell(s),vec2(1.3),hsl((0.5+i*0.02)%1,1,0.5,0.2));
drawRect(cell(s),vec2(i==0?0.95:0.8),c);});
}

const KICK=[1,0,60,0,0.04,0.2,1,2,-4];
const HAT=[0.2,0,4000,0,0,0.03,4,1,0,0,0,0,0,0,0,0,0,1,0.01];
const BASS=[0.8,0,55,0.005,0.1,0.1,2,0.6];
const ARP=[0.3,0,220,0.005,0.08,0.12,2,1,0,0,0,0,0,0,0,0,0.1];
const LEAD=[0.3,0,440,0.01,0.15,0.2,5,1,0,0,0,0,0,0,0,0,0.1];
const K=[0,0,12,,,,12,,,,12,,,,12,,,,12,,,,12,,,,12,,,,12,,,,];
const H=[1,0.3,,,12,,,,12,,,,12,,,,12,,,,12,,,,12,,,,12,,,,12,,12];
const bl=(a:number,b:number)=>[2,-0.2,a,,a,,a,a,,a,a,,a,,a,,a,,a,,a,a,,a,a,,a,,a,,b,,b];
const ar=(a:number,b:number,c:number)=>[3,0.3,a,b,c,b,a,b,c,b,a,b,c,b,a,b,c,b,a,b,c,b,a,b,c,b,a,b,c,b,a,b,c,b];
hopon.music=[[KICK,HAT,BASS,ARP,LEAD],[
[K,H,bl(12,12),ar(24,27,31)],
[K,H,bl(8,8),ar(20,24,27)],
[K,H,bl(10,10),ar(22,26,29)],
[K,H,bl(7,7),ar(19,22,26)],
[K,H,bl(12,12),ar(24,27,31),[4,-0.3,36,,,,34,,,,31,,,,34,,,,36,,,,,,31,,,,29,,,,,,]],
[K,H,bl(8,8),ar(20,24,27),[4,-0.3,31,,,,32,,,,36,,,,32,,,,31,,,,,,27,,,,,,,,,,]],
[K,H,bl(10,10),ar(22,26,29),[4,-0.3,34,,,,36,,,,34,,,,31,,,,29,,,,31,,,,34,,,,,,]],
[K,H,bl(7,7),ar(19,22,26),[4,-0.3,31,,,,29,,,,26,,,,29,,,,31,,,,,,,,,,,,,,]],
],[0,1,2,3,0,1,2,3,4,5,6,7],128];
