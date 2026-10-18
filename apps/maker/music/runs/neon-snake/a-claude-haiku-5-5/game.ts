
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


const S_KICK=[1,0,60,0,0.04,0.2,1,2,-4];
const S_HAT=[0.25,0,4000,0,0,0.03,4,1,0,0,0,0,0,0,0,0,0,1,0.01];
const S_SNARE=[0.5,0,200,0,0.05,0.15,4,1,0,0,0,0,0,1.5];
const S_BASS=[0.8,0,55,0.005,0.08,0.1,2,0.6];
const S_LEAD=[0.35,0,440,0.01,0.1,0.12,2,1,0,0,0,0,0,0,0,0,0.15];
const S_N=32, S_ROOTS=[12,8,15,10];
const S_kick=Array.from({length:S_N},(_,i)=>i%4==0?12:undefined);
const S_hat=Array.from({length:S_N},(_,i)=>i%2==1?12:undefined);
const S_snare=Array.from({length:S_N},(_,i)=>i%8==4?12:undefined);
const S_bass=Array.from({length:S_N},(_,i)=>i%2==0?S_ROOTS[Math.floor(i/8)]:-1);
const S_lead=(add:number)=>Array.from({length:S_N},(_,i)=>{const r=S_ROOTS[Math.floor(i/8)];const t=[r,r+3,r+7,r+12];return t[i%4]+add;});
hopon.music=[
 [S_KICK,S_HAT,S_SNARE,S_BASS,S_LEAD],
 [
  [[0,0,...S_kick],[1,0.3,...S_hat],[2,0,...S_bass]],
  [[0,0,...S_kick],[1,0.3,...S_hat],[3,-0.2,...S_bass],[4,0.2,...S_lead(0)]],
  [[0,0,...S_kick],[1,0.3,...S_hat],[3,-0.2,...S_bass],[4,0.2,...S_lead(12)]],
  [[0,0,...S_kick],[1,0.3,...S_hat],[2,0,...S_snare],[3,-0.2,...S_bass],[4,0.2,...S_lead(0)]]
 ],
 [0,1,2,3,1,2,3,1],
 124
];
