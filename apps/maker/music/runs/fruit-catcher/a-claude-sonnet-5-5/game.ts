hopon.title="Fruit Catcher";hopon.hint="Drag to move the basket";
const W=20,P=0.25;
const ding=new Sound([0.5,0,900,0.01,0.05,0.1,0,1,0,0,300]);
const boom=new Sound([1,0.1,120,0.02,0.2,0.4,4,2,-5]);
let BX=0,BY=0;function px(x:number,y:number,w:number,h:number,c:Color){drawRect(vec2(BX+(x+w/2)*P,BY+(y+h/2)*P),vec2(w*P,h*P),c);}
class Basket extends EngineObject{
 constructor(){super(vec2(0,-11),vec2(3.5,2),undefined,0,CLEAR_WHITE);this.gravityScale=0;}
 update(){
  if(mouseIsDown(0))this.pos.x=lerp(this.pos.x,mousePos.x,0.4);
  this.pos.x+=(keyIsDown("ArrowRight")?0.3:0)-(keyIsDown("ArrowLeft")?0.3:0);
  this.pos.x=clamp(this.pos.x,-8.5,8.5);
 }
 render(){BX=this.pos.x-1.75;BY=this.pos.y-1;const x=0,y=0;const b=rgb(0.6,0.35,0.15),d=rgb(0.4,0.22,0.08);
  px(x,y,14,8,b);px(-1,6,16,2,rgb(0.8,0.55,0.3));px(2,1,1,5,d);px(6,1,1,5,d);px(10,1,1,5,d);px(0,3,14,1,d);}
}
class Item extends EngineObject{
 bomb:boolean;
 constructor(bomb:boolean){super(vec2(rand(-8.5,8.5),15),vec2(1.5,1.5),undefined,0,WHITE);this.bomb=bomb;this.gravityScale=0;this.velocity=vec2(0,-0.07-rand(0.05)-Math.min(time*0.001,0.1));}
 update(){super.update();
  if(Math.abs(this.pos.x-bk.pos.x)<2.1&&Math.abs(this.pos.y-bk.pos.y)<1.5){
   this.destroy();
   if(this.bomb){boom.play();new ParticleEmitter(this.pos,0,1,0.2,80,3.14,undefined,YELLOW,RED);hopon.gameOver();}
   else{ding.play();hopon.addScore(1);}
  } else if(this.pos.y<-14){this.destroy();if(!this.bomb){miss++;if(miss>=3)hopon.gameOver();}}
 }
 render(){BX=this.pos.x-1.5;BY=this.pos.y-1.5;const x=0,y=0;
  if(this.bomb){px(x+1,y,4,6,BLACK);px(x,y+1,6,4,BLACK);px(x+1,y+3,1,1,GRAY);px(x+3,y+6,1,1,rgb(.6,.4,.2));px(x+4,y+7,1,1,ORANGE);}
  else{const r=rgb(0.9,0.1,0.1);px(x+1,y,4,6,r);px(x,y+1,6,4,r);px(x+1,y+4,1,1,rgb(1,.6,.6));px(x+3,y+6,1,2,rgb(.4,.25,.1));px(x+4,y+6,2,1,rgb(.2,.7,.2));}}
}
let bk:Basket,nx=0,miss=0;
function gameInit(){setCameraPos(vec2(0,0));bk=new Basket();nx=0;miss=0;}
function gameUpdate(){setCameraScale(mainCanvasSize.x/W);
 if(time>nx){nx=time+Math.max(0.4,1-time*0.01);new Item(randBool(0.3));}}
function gameRender(){drawRectGradient(cameraPos,vec2(100),rgb(.4,.7,1),rgb(.8,.93,1));
 drawRect(vec2(0,-13.5),vec2(30,3),rgb(.3,.6,.2));}
function gameRenderPost(){drawTextScreen("Misses "+miss+"/3",vec2(mainCanvasSize.x-70,25),16,WHITE,3,BLACK);}

const mk=(n:number,m:Record<number,number>)=>{const a:number[]=new Array(n).fill(0);for(const k in m)a[+k]=m[k];return a;};
const KICK=[0.9,0,60,0,0.04,0.2,1,2,-4];
const HAT=[0.2,0,4000,0,0,0.03,4,1,0,0,0,0,0,0,0,0,0,1,0.01];
const BASS=[0.7,0,55,0.005,0.08,0.1,2,0.6];
const LEAD=[0.35,0,440,0.01,0.1,0.15,0,1,0,0,0,0,0,0,0,0,0.05];
const ARP=[0.2,0,220,0.005,0.04,0.1,2,1];
const drum=(p:number)=>[0,0,mk(32,{0:12,4:12,8:12,12:12,16:12,20:12,24:12,28:12})].slice(2);
const kick=mk(32,{0:12,4:12,8:12,12:12,16:12,20:12,24:12,28:12});
const hat=mk(32,{2:12,6:12,10:12,14:12,18:12,22:12,26:12,30:12});
const bassl=(a:number,b:number)=>mk(32,{0:a,3:a,6:a,8:a,11:a,14:a,16:b,19:b,22:b,24:b,27:b,30:b});
const arp=(a:number[],b:number[])=>{const o:Record<number,number>={};for(let i=0;i<16;i++){o[i*2]=a[i%a.length];}return mk(32,o);};
const arpl=(c1:number[],c2:number[])=>{const o:Record<number,number>={};for(let i=0;i<8;i++){o[i*2]=c1[i%c1.length];o[16+i*2]=c2[i%c2.length];}return mk(32,o);};
const CC=[15,19,22,27],AM=[12,15,19,24],FF=[8,12,15,20],GG=[10,14,17,22];
const pat=(b1:number,b2:number,c1:number[],c2:number[],lead:Record<number,number>)=>[
 [0,0,...kick],[1,0.3,...hat],[2,-0.2,...bassl(b1,b2)],[4,-0.3,...arpl(c1,c2)],[3,0.2,...mk(32,lead)]];
hopon.music=[[KICK,HAT,BASS,LEAD,ARP],[
 pat(15,12,CC,AM,{}),
 pat(15,12,CC,AM,{0:24,2:26,4:27,8:26,12:24,16:22,18:24,20:22,24:19,28:22}),
 pat(8,10,FF,GG,{0:20,2:22,4:24,8:22,12:20,16:22,18:24,20:26,24:26,28:24}),
 pat(8,10,FF,GG,{0:27,4:26,6:24,8:22,12:24,16:26,18:27,20:29,24:31,30:24}),
],[0,1,2,3,0,1,2,1],128];
