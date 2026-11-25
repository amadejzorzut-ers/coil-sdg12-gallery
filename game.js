"use strict";
/* ECO BUS SLOVENIA — an original canvas game for the SDG 12 gallery.
   Drive an electric bus from Piran to Bohinj, carry passengers and watch the CO2 meter.
   CO2 numbers are simple, rounded estimates (see the note in the game intro). */
(function(){
const root=document.getElementById('game-root');
if(!root)return;
const $=id=>document.getElementById(id);
const canvas=$('game-canvas');
const ctx=canvas.getContext('2d');
if(!ctx)return;

/* ---------- constants ---------- */
const W=960,H=540;
const KM_PX=250;            // 1 km of route = 250 px of world
const START_X=1100;         // world x of the first stop
const CAP=16;               // seats on the bus
const CAR_KG=0.17;          // kg CO2 per km for one passenger car (estimate)
const BUS_KG=0.25;          // kg CO2 per km for the whole electric bus (estimate, Slovenian power mix)
const DOOR_OFF=84;          // door position in front of the bus centre
const ZONE=115;             // how close the door must be to the bus-stop sign
const MAXV=520,ACC=240,BRK=640,DRAG=90;
const ROAD_TOP=408,ROAD_BOT=506,BUS_Y=498,CAR_Y=452,BUS_SX=330;
const CLEAN_TARGET=170;     // kg CO2 saved that makes the air fully clear

const STOPS=[
 {name:'Piran',km:0,kind:'coast',fact:'Piran is a medieval port town on Slovenia’s short Adriatic coast, only about 46 km long.'},
 {name:'Postojna',km:75,kind:'cave',fact:'Postojna Cave is more than 20 km long. Visitors ride into it on a little train.'},
 {name:'Ljubljana',km:128,kind:'city',fact:'Ljubljana was European Green Capital in 2016 and has a large car-free centre.'},
 {name:'Kranj',km:153,kind:'town',fact:'Kranj’s old town stands on a rock above the Sava and Kokra rivers, right below the Alps.'},
 {name:'Bled',km:181,kind:'lake',fact:'Lake Bled’s island church is reached by a traditional rowing boat called a pletna.'},
 {name:'Bohinj',km:208,kind:'alps',fact:'Bohinj lies inside Triglav National Park, Slovenia’s only national park.'}
];
STOPS.forEach(s=>{s.x=START_X+s.km*KM_PX});
const LAST=STOPS.length-1;
const ROUTE_LEN=STOPS[LAST].x+1500;
const WAIT_COUNT=[8,7,9,6,6,0];

const SHIRTS=['#ff7a59','#45c1ff','#ffd166','#a78bfa','#2dd4a7','#f472b6','#fb923c','#e5e7eb'];
const SKINS=['#f1c9a5','#d9a273','#a8744a','#7a4b2a','#f6d7b8'];
const HAIRS=['#2b1b10','#5a3a1e','#d6a84a','#111111','#8a8a8a'];

/* ---------- helpers ---------- */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const pick=a=>a[Math.floor(Math.random()*a.length)];
function rnd(n){const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s)}
function noise1(x){const i=Math.floor(x),f=x-i;return lerp(rnd(i),rnd(i+1),f*f*(3-2*f))}
function hex(c){const n=parseInt(c.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]}
function mix(a,b,t){const A=hex(a),B=hex(b);t=clamp(t,0,1);return 'rgb('+Math.round(A[0]+(B[0]-A[0])*t)+','+Math.round(A[1]+(B[1]-A[1])*t)+','+Math.round(A[2]+(B[2]-A[2])*t)+')'}
function rr(x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
function fmtTime(s){s=Math.floor(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function makePassenger(dest,origin){return{dest,origin,shirt:pick(SHIRTS),skin:pick(SKINS),hair:pick(HAIRS)}}

/* ---------- game state ---------- */
let G=null,visible=true,lastT=0,demoX=0,hudTimer=0,wheelAngle=0;
const input={gas:false,brake:false};
let best=0;
try{best=parseInt(localStorage.getItem('eco-bus-best-v1'),10)||0}catch(e){best=0}

function newGame(){
  const waiting=STOPS.map((s,i)=>{
    const list=[];
    for(let k=0;k<WAIT_COUNT[i];k++){
      const dest=i+1+Math.floor(Math.random()*(LAST-i));
      list.push(makePassenger(dest,i));
    }
    return list;
  });
  const tokens=[];
  for(let x=START_X+500;x<STOPS[LAST].x-300;x+=470+Math.random()*240){
    if(STOPS.some(s=>Math.abs(x-s.x)<420))continue;
    tokens.push({x,got:false,ph:Math.random()*6});
  }
  G={
    mode:'intro',busX:STOPS[0].x-DOOR_OFF-520,v:0,battery:100,t:0,score:0,delivered:0,tokensGot:0,
    carKg:0,busKg:0,onboard:[],waiting,
    doors:{busy:false,queue:[],timer:0,closeT:0,idx:-1},
    walkers:[],particles:[],cars:[],floaters:[],tokens,toast:null,
    clean:0,cleanShown:0,approached:new Set(),visited:new Set(),carTimer:1,endT:0,
    leftBehind:0,lowBatteryWarned:false
  };
}
newGame();

/* ---------- sound (tiny synth, only after the player starts) ---------- */
let actx=null,soundOn=true;
function ensureAudio(){
  if(actx||!soundOn)return;
  try{const A=window.AudioContext||window.webkitAudioContext;if(A)actx=new A()}catch(e){actx=null}
}
function beep(freq,dur,type,vol,delay){
  if(!actx||!soundOn)return;
  try{
    const t0=actx.currentTime+(delay||0),o=actx.createOscillator(),g=actx.createGain();
    o.type=type||'sine';o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(vol||0.08,t0+0.015);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g);g.connect(actx.destination);o.start(t0);o.stop(t0+dur+0.05);
  }catch(e){}
}
const sfx={
  ding(){beep(880,.25,'sine',.09);beep(1320,.3,'sine',.07,.12)},
  board(){beep(520,.09,'triangle',.07)},
  alight(){beep(700,.09,'triangle',.07);beep(900,.1,'triangle',.05,.06)},
  leaf(){beep(784,.08,'sine',.05);beep(1175,.12,'sine',.05,.06)},
  warn(){beep(220,.2,'square',.04)},
  win(){[523,659,784,1047].forEach((f,i)=>beep(f,.3,'sine',.08,i*.14))}
};

/* ---------- toast + live region ---------- */
const live=$('game-live');
function toast(text,time){
  G.toast={text,t:time||2.4};
  if(live)live.textContent=text;
}
function floater(x,y,text,color){G.floaters.push({x,y,text,color,t:1.3})}

/* ---------- stops / doors ---------- */
function nearestStop(){
  const dx=G.busX+DOOR_OFF;let best=0,bd=1e9;
  for(let i=0;i<STOPS.length;i++){const d=Math.abs(dx-STOPS[i].x);if(d<bd){bd=d;best=i}}
  return{i:best,d:bd};
}
function tryDoors(){
  if(!G||G.mode!=='playing'||G.doors.busy)return;
  if(G.v>18){toast('Stop the bus first!');return}
  const n=nearestStop();
  if(n.d>=ZONE){toast('Park the bus door next to the bus stop sign.');return}
  const i=n.i,q=[];
  let outs=0;
  for(const p of G.onboard)if(p.dest<=i){q.push({type:'out',p});outs++}
  let free=CAP-(G.onboard.length-outs);
  const wait=G.waiting[i];
  for(let k=0;k<wait.length&&free>0;k++){q.push({type:'in',p:wait[k]});free--}
  if(!q.length){
    toast(wait.length?'The bus is full! Passengers can’t get on.':'Nobody wants to get on or off here.');
    return;
  }
  G.v=0;
  G.doors={busy:true,queue:q,timer:0.2,closeT:-1,idx:i};
  G.visited.add(i);
  sfx.ding();
  toast('Doors open at '+STOPS[i].name);
}
function runDoors(dt){
  const d=G.doors;if(!d.busy)return;
  G.battery=Math.min(100,G.battery+12*dt);   // charging while the doors are open
  if(d.queue.length){
    d.timer-=dt;
    while(d.timer<=0&&d.queue.length){
      const a=d.queue.shift();d.timer+=0.32;
      const stop=STOPS[d.idx];
      if(a.type==='out'){
        const k=G.onboard.indexOf(a.p);if(k>=0)G.onboard.splice(k,1);
        G.delivered++;G.score+=100;
        G.walkers.push({kind:'out',p:a.p,x0:G.busX+DOOR_OFF,y0:476,x1:G.busX+DOOR_OFF+30+Math.random()*130,y1:412,t:0,dur:1.0});
        floater(G.busX+DOOR_OFF,380,'+100','#d8f277');sfx.alight();
      }else{
        const k=G.waiting[d.idx].indexOf(a.p);if(k>=0)G.waiting[d.idx].splice(k,1);
        G.onboard.push(a.p);
        G.walkers.push({kind:'in',p:a.p,x0:stop.x+(Math.random()*70-35),y0:412,x1:G.busX+DOOR_OFF,y1:476,t:0,dur:0.65});
        sfx.board();
      }
    }
    if(!d.queue.length)d.closeT=0.7;
  }else{
    d.closeT-=dt;
    if(d.closeT<=0){
      d.busy=false;
      const left=G.waiting[d.idx].length;
      sfx.ding();
      if(d.idx===LAST){G.endT=1.0;toast('End of the line — Bohinj!')}
      else if(left>0&&G.onboard.length>=CAP)toast('Bus full — '+left+' still waiting at '+STOPS[d.idx].name+'.');
      else toast('Doors closed. Next stop: '+STOPS[d.idx+1].name);
    }
  }
}

/* ---------- update ---------- */
function update(dt){
  const g=G;
  g.t+=dt;
  const doorsBusy=g.doors.busy;
  const noPower=g.battery<=0;
  const maxV=noPower?90:MAXV;
  const gas=input.gas&&!doorsBusy;
  const brake=input.brake;
  if(doorsBusy){g.v=0}
  else{
    if(gas)g.v+=ACC*(noPower?.35:1)*dt;
    if(brake)g.v-=BRK*dt;
    else if(!gas)g.v-=DRAG*dt;
    if(g.v>maxV)g.v=Math.max(maxV,g.v-320*dt);
    g.v=Math.max(0,g.v);
  }
  // do not drive off the end of the road
  const endLimit=STOPS[LAST].x-DOOR_OFF+520;
  const move=g.v*dt;
  g.busX=Math.min(g.busX+move,endLimit);
  if(g.busX>=endLimit)g.v=0;
  wheelAngle+=move/21;
  const dkm=move/KM_PX;
  // battery
  if(g.v>1||gas){g.battery-=(0.5+1.5*(gas?1:0)*(g.v/MAXV))*dt}
  if(brake&&g.v>50)g.battery+=0.004*g.v*dt;
  g.battery=clamp(g.battery,0,100);
  if(g.battery<22&&!g.lowBatteryWarned){g.lowBatteryWarned=true;toast('Battery low! Collect leaves or stop at a bus stop to recharge.',3);sfx.warn()}
  if(g.battery>50)g.lowBatteryWarned=false;
  // CO2 meter
  g.carKg+=g.onboard.length*dkm*CAR_KG;
  g.busKg+=dkm*BUS_KG;
  g.clean=clamp((g.carKg-g.busKg)/CLEAN_TARGET,0,1);
  g.cleanShown+=(g.clean-g.cleanShown)*Math.min(1,dt*1.5);
  // doors
  runDoors(dt);
  // leaf tokens
  for(const t of g.tokens){
    if(!t.got&&Math.abs(t.x-g.busX)<130){
      t.got=true;g.tokensGot++;g.score+=10;g.battery=Math.min(100,g.battery+4);
      floater(t.x,BUS_Y-120,'+10','#2dd4a7');sfx.leaf();
      for(let k=0;k<8;k++)g.particles.push({type:'leaf',x:t.x,y:BUS_Y-70,vx:(Math.random()-.5)*160,vy:-60-Math.random()*90,t:0,life:.8+Math.random()*.4,r:3+Math.random()*3});
    }
  }
  // approaching toasts
  for(let i=0;i<STOPS.length;i++){
    const ahead=STOPS[i].x-(g.busX+DOOR_OFF);
    if(ahead>0&&ahead<900&&!g.approached.has(i)){g.approached.add(i);if(g.mode==='playing'&&g.t>1)toast((i===LAST?'Final stop: ':'Approaching ')+STOPS[i].name+'. Park inside the green zone!',2.6)}
  }
  // end of game
  if(g.endT>0){g.endT-=dt;if(g.endT<=0)finish()}
  // ambience
  ambient(dt);
}
function ambient(dt){
  const g=G;
  // exhaust-free leaf sparkles from the bus
  if(g.v>40&&Math.random()<dt*g.v/60){
    g.particles.push({type:'spark',x:g.busX-135,y:BUS_Y-26-Math.random()*20,vx:-30-Math.random()*40,vy:-20-Math.random()*30,t:0,life:.9,r:2+Math.random()*2});
  }
  // opposite-lane cars with smoke
  g.carTimer-=dt;
  if(g.carTimer<=0){
    g.carTimer=1.6+Math.random()*3.2;
    const cx=g.busX-BUS_SX+W+160;
    if(!g.cars.some(c=>c.x>cx-380))g.cars.push({x:cx,speed:230+Math.random()*100,color:pick(['#c2410c','#64748b','#a16207','#7c3aed','#0f766e','#9f1239','#475569']),puff:0});
  }
  for(const c of g.cars){
    c.x-=c.speed*dt;
    c.puff-=dt;
    if(c.puff<=0){c.puff=.12;g.particles.push({type:'smoke',x:c.x+44,y:CAR_Y-20,vx:40+Math.random()*30,vy:-14-Math.random()*14,t:0,life:1.6,r:5+Math.random()*4})}
  }
  g.cars=g.cars.filter(c=>c.x>g.busX-BUS_SX-300);
  for(const p of g.particles){p.t+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.type==='leaf')p.vy+=160*dt}
  g.particles=g.particles.filter(p=>p.t<p.life);
  for(const w of g.walkers)w.t+=dt;
  g.walkers=g.walkers.filter(w=>w.t<w.dur+0.05);
  for(const f of g.floaters)f.t-=dt;
  g.floaters=g.floaters.filter(f=>f.t>0);
  if(g.toast){g.toast.t-=dt;if(g.toast.t<=0)g.toast=null}
}

/* ---------- finish ---------- */
function stars(saved,delivered){
  if(saved>=120&&delivered>=24)return 3;
  if(saved>=60&&delivered>=14)return 2;
  return 1;
}
function finish(){
  const g=G;g.mode='end';
  const saved=g.carKg-g.busKg;
  const timeBonus=Math.max(0,Math.round((420-g.t)*2));
  const total=g.score+Math.max(0,Math.round(saved*2))+timeBonus;
  const st=stars(saved,g.delivered);
  const isBest=total>best;
  if(isBest){best=total;try{localStorage.setItem('eco-bus-best-v1',String(best))}catch(e){}}
  $('end-score').textContent=total.toLocaleString('en');
  $('end-stars').textContent='★'.repeat(st)+'☆'.repeat(3-st);
  $('end-stars').setAttribute('aria-label',st+' out of 3 stars');
  $('end-delivered').textContent=g.delivered;
  $('end-time').textContent=fmtTime(g.t);
  $('end-car').textContent=g.carKg.toFixed(1)+' kg';
  $('end-bus').textContent=g.busKg.toFixed(1)+' kg';
  $('end-saved').textContent=saved.toFixed(1)+' kg';
  $('end-percent').textContent=g.carKg>1?Math.round(saved/g.carKg*100)+'%':'–';
  $('end-best').textContent=isBest?'New best score!':'Best score: '+best.toLocaleString('en');
  $('game-end').hidden=false;
  $('game-again').focus({preventScroll:true});
  sfx.win();
  if(live)live.textContent='Route complete. You scored '+total+' points and saved about '+saved.toFixed(0)+' kilograms of CO2.';
}

/* ---------- drawing: scenery ---------- */
function ridge(x,seed,amp){
  const r=1-Math.abs(noise1(x/230+seed)*2-1);
  return amp*(0.42*r+0.38*noise1(x/95+seed*3)+0.2*noise1(x/38+seed*7));
}
function drawSky(haze,camX){
  const g=ctx.createLinearGradient(0,0,0,390);
  g.addColorStop(0,mix('#3d97ee','#9b9a8c',haze*.75));
  g.addColorStop(.62,mix('#a5dcff','#cdc6ae',haze*.8));
  g.addColorStop(1,mix('#eaf8ff','#dcd2b2',haze*.8));
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  const sx=770,sy=112;
  const sg=ctx.createRadialGradient(sx,sy,10,sx,sy,170);
  sg.addColorStop(0,'rgba(255,244,190,.9)');sg.addColorStop(1,'rgba(255,244,190,0)');
  ctx.fillStyle=sg;ctx.fillRect(sx-180,sy-180,360,360);
  ctx.fillStyle=mix('#fff7c4','#ffb56d',haze*.8);
  ctx.beginPath();ctx.arc(sx,sy,34,0,6.283);ctx.fill();
  // clouds
  const span=7*270;
  for(let k=0;k<7;k++){
    let x=((k*270-camX*0.07)%span+span)%span-150;
    const y=50+rnd(k+3)*120,s=.8+rnd(k+9)*.7;
    ctx.fillStyle=mix('#ffffff','#bdb7a6',haze*.8);ctx.globalAlpha=.88;
    ctx.beginPath();ctx.arc(x,y,24*s,0,6.283);ctx.arc(x+26*s,y-10*s,30*s,0,6.283);ctx.arc(x+58*s,y,24*s,0,6.283);ctx.arc(x+28*s,y+8*s,24*s,0,6.283);ctx.fill();
    ctx.globalAlpha=1;
  }
}
function drawMountains(camX,haze,prog){
  // far Alps (snowy when high)
  const amp=30+170*smooth((prog-.12)/.75);
  const p=.1,base=345;
  ctx.beginPath();ctx.moveTo(-10,H);
  for(let sx=-10;sx<=W+10;sx+=6){ctx.lineTo(sx,base-ridge(sx+camX*p,2.1,amp))}
  ctx.lineTo(W+10,H);ctx.closePath();
  const g=ctx.createLinearGradient(0,base-200,0,base+10);
  g.addColorStop(0,'#ffffff');g.addColorStop(.38,'#f3f7fb');g.addColorStop(.52,mix('#8fa8c4','#a9a395',haze*.7));g.addColorStop(1,mix('#a9c0da','#bdb7a2',haze*.7));
  ctx.fillStyle=g;ctx.fill();
  // sea near the coast
  const sea=clamp(1-camX/8500,0,1);
  if(sea>0){
    ctx.globalAlpha=sea;
    const sg=ctx.createLinearGradient(0,310,0,372);
    sg.addColorStop(0,mix('#5db4e8','#9fb0a8',haze*.6));sg.addColorStop(1,mix('#2f86c4','#7a9a98',haze*.6));
    ctx.fillStyle=sg;ctx.fillRect(0,312,W,70);
    ctx.fillStyle='rgba(255,255,255,.5)';
    for(let k=0;k<26;k++){const x=((k*97-camX*.25)%(W+100)+W+100)%(W+100)-50;ctx.fillRect(x,322+rnd(k)*44,18+rnd(k+4)*26,1.6)}
    ctx.globalAlpha=1;
  }
  // mid hills
  const hAmp=34+20*smooth(prog);
  ctx.beginPath();ctx.moveTo(-10,H);
  for(let sx=-10;sx<=W+10;sx+=6){ctx.lineTo(sx,372-ridge(sx+camX*.28,6.3,hAmp))}
  ctx.lineTo(W+10,H);ctx.closePath();
  ctx.fillStyle=mix('#7fb890','#9aa08a',haze*.7);ctx.fill();
  // near hills with pine rows
  const p2=.55;
  ctx.beginPath();ctx.moveTo(-10,H);
  for(let sx=-10;sx<=W+10;sx+=6){ctx.lineTo(sx,392-ridge(sx+camX*p2,11.7,52))}
  ctx.lineTo(W+10,H);ctx.closePath();
  ctx.fillStyle=mix('#4a9a5c','#7f8a62',haze*.7);ctx.fill();
  const tc=mix('#2d7a4a','#6a7a4e',haze*.7);
  ctx.fillStyle=tc;
  const first=Math.floor((camX*p2-30)/26);
  for(let c=first;c<first+Math.ceil(W/26)+4;c++){
    if(rnd(c*3.7)>.62)continue;
    const wx=c*26+rnd(c)*10,sx=wx-camX*p2,y=392-ridge(wx,11.7,52);
    const h=16+rnd(c+5)*14;
    ctx.beginPath();ctx.moveTo(sx,y-h);ctx.lineTo(sx+8,y+2);ctx.lineTo(sx-8,y+2);ctx.closePath();ctx.fill();
  }
}

/* landmarks stand on the grass just behind the road (base y = 400) */
const LM_Y=400;
function house(x,w,h,wall,roof){
  ctx.fillStyle=wall;ctx.fillRect(x,LM_Y-h,w,h);
  ctx.fillStyle=roof;ctx.beginPath();ctx.moveTo(x-4,LM_Y-h);ctx.lineTo(x+w/2,LM_Y-h-w*.34);ctx.lineTo(x+w+4,LM_Y-h);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(40,50,70,.55)';
  for(let wx=x+8;wx<x+w-8;wx+=16){ctx.fillRect(wx,LM_Y-h+12,7,10);if(h>60)ctx.fillRect(wx,LM_Y-h+36,7,10)}
}
function lmPiran(x){
  const cols=['#f2d7b6','#e9b88a','#f6e3c3','#e4a57d','#f0cf9d'];
  for(let k=0;k<9;k++){
    const w=44+rnd(k+1)*26,h=46+rnd(k+8)*48;
    house(x-300+k*52,w,h,cols[k%5],'#c8553d');
  }
  // St George bell tower
  const tx=x+170;
  ctx.fillStyle='#f3e6c8';ctx.fillRect(tx,LM_Y-150,34,150);
  ctx.fillStyle='#d9c8a0';ctx.fillRect(tx+26,LM_Y-150,8,150);
  ctx.fillStyle='#c8553d';ctx.beginPath();ctx.moveTo(tx-4,LM_Y-150);ctx.lineTo(tx+17,LM_Y-196);ctx.lineTo(tx+38,LM_Y-150);ctx.closePath();ctx.fill();
  ctx.fillStyle='#3a4256';rr(tx+10,LM_Y-136,14,22,7);ctx.fill();rr(tx+10,LM_Y-98,14,22,7);ctx.fill();
  ctx.strokeStyle='#c8553d';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(tx+17,LM_Y-196);ctx.lineTo(tx+17,LM_Y-210);ctx.moveTo(tx+11,LM_Y-204);ctx.lineTo(tx+23,LM_Y-204);ctx.stroke();
  house(x+212,58,60,'#f6e3c3','#c8553d');
}
function lmPostojna(x){
  const g=ctx.createLinearGradient(0,LM_Y-170,0,LM_Y);
  g.addColorStop(0,'#a59f90');g.addColorStop(1,'#6f6a5e');
  ctx.fillStyle=g;
  ctx.beginPath();ctx.moveTo(x-260,LM_Y);ctx.bezierCurveTo(x-210,LM_Y-110,x-120,LM_Y-170,x,LM_Y-172);ctx.bezierCurveTo(x+130,LM_Y-170,x+210,LM_Y-100,x+270,LM_Y);ctx.closePath();ctx.fill();
  ctx.fillStyle='#4f8a4f';
  for(const bx of[-215,-175,-135,150,190,230]){ctx.beginPath();ctx.ellipse(x+bx,LM_Y-10,24+rnd(bx)*8,16,0,Math.PI,0);ctx.fill()}
  // cave mouth
  ctx.fillStyle='#14171c';ctx.beginPath();ctx.moveTo(x-62,LM_Y);ctx.bezierCurveTo(x-66,LM_Y-86,x-30,LM_Y-110,x,LM_Y-110);ctx.bezierCurveTo(x+30,LM_Y-110,x+66,LM_Y-86,x+62,LM_Y);ctx.closePath();ctx.fill();
  ctx.fillStyle='#d8d2c2';
  for(let k=0;k<7;k++){const sx=x-44+k*15,h=14+rnd(k+3)*26;ctx.beginPath();ctx.moveTo(sx-4,LM_Y-108+Math.abs(k-3)*7);ctx.lineTo(sx+4,LM_Y-108+Math.abs(k-3)*7);ctx.lineTo(sx,LM_Y-108+Math.abs(k-3)*7+h);ctx.closePath();ctx.fill()}
  ctx.fillStyle='rgba(255,210,120,.55)';ctx.beginPath();ctx.ellipse(x,LM_Y-8,38,10,0,0,6.283);ctx.fill();
  // wooden sign
  ctx.fillStyle='#6b4a2e';ctx.fillRect(x-300,LM_Y-48,5,48);ctx.fillRect(x-214,LM_Y-48,5,48);
  ctx.fillStyle='#8a6038';rr(x-306,LM_Y-68,104,30,6);ctx.fill();
  ctx.fillStyle='#fff3d6';ctx.font='700 13px Inter,Arial,sans-serif';ctx.textAlign='center';ctx.fillText('POSTOJNA CAVE',x-254,LM_Y-48);
}
function lmLjubljana(x){
  // castle hill
  ctx.fillStyle='#5aa860';ctx.beginPath();ctx.ellipse(x-130,LM_Y,190,98,0,Math.PI,0);ctx.fill();
  const cx=x-170,cy=LM_Y-92;
  ctx.fillStyle='#d9cdb4';ctx.fillRect(cx-62,cy-44,124,44);
  ctx.fillRect(cx-70,cy-70,26,70);ctx.fillRect(cx+44,cy-62,26,62);ctx.fillRect(cx-14,cy-82,28,50);
  ctx.fillStyle='#b84a3a';
  [[cx-70,cy-70,26],[cx+44,cy-62,26],[cx-14,cy-82,28]].forEach(t=>{ctx.beginPath();ctx.moveTo(t[0]-3,t[1]);ctx.lineTo(t[0]+t[2]/2,t[1]-24);ctx.lineTo(t[0]+t[2]+3,t[1]);ctx.closePath();ctx.fill()});
  ctx.fillStyle='rgba(40,50,70,.55)';for(let k=0;k<5;k++)ctx.fillRect(cx-48+k*22,cy-30,8,14);
  // pastel old-town houses
  const wall=['#f3b6b6','#f7e0a6','#bfe3c8','#b8d6f2','#f0c9e6','#f5d3a3'];
  for(let k=0;k<7;k++){const w=46+rnd(k+20)*20,h=56+rnd(k+30)*60;house(x+10+k*54,w,h,wall[k%6],k%2?'#8a4a3a':'#a55a46')}
  // triple bridge hint
  ctx.fillStyle='#e8dcc2';ctx.fillRect(x-20,LM_Y-8,64,8);
}
function lmKranj(x){
  const wall=['#f1d9b5','#e6c3a0','#f5e7c8'];
  for(let k=0;k<6;k++)house(x-250+k*50,44+rnd(k+40)*18,44+rnd(k+50)*40,wall[k%3],'#b4533b');
  // church with tall spire
  const cx=x+70;
  ctx.fillStyle='#f3ead3';ctx.fillRect(cx-70,LM_Y-70,92,70);
  ctx.fillStyle='#8b4a38';ctx.beginPath();ctx.moveTo(cx-74,LM_Y-70);ctx.lineTo(cx-24,LM_Y-102);ctx.lineTo(cx+26,LM_Y-70);ctx.closePath();ctx.fill();
  ctx.fillStyle='#f3ead3';ctx.fillRect(cx+22,LM_Y-136,34,136);
  ctx.fillStyle='#3d4a5e';ctx.beginPath();ctx.moveTo(cx+18,LM_Y-136);ctx.lineTo(cx+39,LM_Y-216);ctx.lineTo(cx+60,LM_Y-136);ctx.closePath();ctx.fill();
  ctx.fillStyle='#3a4256';rr(cx+32,LM_Y-124,14,24,7);ctx.fill();
  house(x+150,56,58,'#e6c3a0','#b4533b');
}
function lake(x,rx,ry,haze){
  const g=ctx.createLinearGradient(0,LM_Y-ry-6,0,LM_Y+6);
  g.addColorStop(0,mix('#5fc6d8','#8aa59a',haze*.5));g.addColorStop(1,mix('#2a8aa6','#5f8084',haze*.5));
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,LM_Y-ry+8,rx,ry,0,0,6.283);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=1.6;
  for(let k=0;k<8;k++){const lx=x-rx*.7+rnd(k+60)*rx*1.4,ly=LM_Y-ry+10+rnd(k+70)*ry*.9;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+22,ly);ctx.stroke()}
}
function lmBled(x,haze){
  // cliff + castle
  ctx.fillStyle='#8c887c';ctx.beginPath();ctx.moveTo(x-330,LM_Y-18);ctx.lineTo(x-292,LM_Y-120);ctx.lineTo(x-210,LM_Y-136);ctx.lineTo(x-170,LM_Y-18);ctx.closePath();ctx.fill();
  ctx.fillStyle='#e0d4ba';ctx.fillRect(x-282,LM_Y-166,62,32);ctx.fillRect(x-294,LM_Y-186,24,52);
  ctx.fillStyle='#b4533b';ctx.beginPath();ctx.moveTo(x-298,LM_Y-186);ctx.lineTo(x-282,LM_Y-208);ctx.lineTo(x-266,LM_Y-186);ctx.closePath();ctx.fill();
  lake(x+40,330,26,haze);
  // island + church
  ctx.fillStyle='#4f9a58';ctx.beginPath();ctx.ellipse(x+20,LM_Y-10,56,18,0,Math.PI,0);ctx.fill();
  ctx.fillStyle='#fbf4e4';ctx.fillRect(x+4,LM_Y-48,30,38);
  ctx.fillStyle='#c8553d';ctx.beginPath();ctx.moveTo(x+2,LM_Y-48);ctx.lineTo(x+19,LM_Y-92);ctx.lineTo(x+36,LM_Y-48);ctx.closePath();ctx.fill();
  ctx.fillStyle='#3a4256';rr(x+14,LM_Y-38,10,16,5);ctx.fill();
  // pletna boat
  ctx.fillStyle='#c0392b';ctx.beginPath();ctx.moveTo(x+110,LM_Y-8);ctx.lineTo(x+150,LM_Y-8);ctx.lineTo(x+142,LM_Y-1);ctx.lineTo(x+118,LM_Y-1);ctx.closePath();ctx.fill();
  house(x+200,58,52,'#f3e1c0','#b4533b');
}
function lmBohinj(x,haze){
  lake(x-60,380,30,haze);
  // hayrack (kozolec)
  const hx=x+210;
  ctx.fillStyle='#7a5232';ctx.fillRect(hx,LM_Y-84,5,84);ctx.fillRect(hx+86,LM_Y-84,5,84);ctx.fillRect(hx+43,LM_Y-84,5,84);
  ctx.strokeStyle='#9a6a3e';ctx.lineWidth=3;
  for(let k=0;k<5;k++){const yy=LM_Y-76+k*14;ctx.beginPath();ctx.moveTo(hx,yy);ctx.lineTo(hx+91,yy);ctx.stroke()}
  ctx.fillStyle='#8a4f33';ctx.beginPath();ctx.moveTo(hx-14,LM_Y-84);ctx.lineTo(hx+45,LM_Y-120);ctx.lineTo(hx+105,LM_Y-84);ctx.closePath();ctx.fill();
  // wooden church
  const cx=x-330;
  ctx.fillStyle='#f2ead6';ctx.fillRect(cx,LM_Y-54,52,54);
  ctx.fillStyle='#7b4a36';ctx.beginPath();ctx.moveTo(cx-4,LM_Y-54);ctx.lineTo(cx+26,LM_Y-84);ctx.lineTo(cx+56,LM_Y-54);ctx.closePath();ctx.fill();
  ctx.fillStyle='#f2ead6';ctx.fillRect(cx+54,LM_Y-98,20,98);
  ctx.fillStyle='#3d4a5e';ctx.beginPath();ctx.moveTo(cx+51,LM_Y-98);ctx.lineTo(cx+64,LM_Y-146);ctx.lineTo(cx+77,LM_Y-98);ctx.closePath();ctx.fill();
}
function drawLandmarks(camX,haze){
  for(const s of STOPS){
    const sx=s.x-camX;
    if(sx<-560||sx>W+560)continue;
    ctx.save();ctx.translate(sx,0);
    // use translated origin: draw functions take x=0
    if(s.kind==='coast')lmPiran(0);
    else if(s.kind==='cave')lmPostojna(0);
    else if(s.kind==='city')lmLjubljana(0);
    else if(s.kind==='town')lmKranj(0);
    else if(s.kind==='lake')lmBled(0,haze);
    else lmBohinj(0,haze);
    ctx.restore();
  }
  // small village churches between the stops
  const first=Math.floor((camX-200)/2300);
  for(let c=first;c<first+Math.ceil((W+500)/2300)+1;c++){
    const wx=c*2300+700+rnd(c+300)*900;
    if(STOPS.some(s=>Math.abs(s.x-wx)<750))continue;
    if(rnd(c+500)<.25)continue;
    const sx=wx-camX;if(sx<-120||sx>W+120)continue;
    ctx.save();ctx.translate(sx,0);
    house(-40,44,34,'#f1e4c6','#b4533b');house(8,32,52,'#f7efd8','#a8482f');
    ctx.fillStyle='#f7efd8';ctx.fillRect(34,LM_Y-92,16,92);
    ctx.fillStyle='#8b4a38';ctx.beginPath();ctx.moveTo(31,LM_Y-92);ctx.lineTo(42,LM_Y-130);ctx.lineTo(53,LM_Y-92);ctx.closePath();ctx.fill();
    ctx.restore();
  }
}
function tree(x,y,s,kind,clean){
  const trunk='#6b4a2e';
  if(kind===0){ // pine
    ctx.fillStyle=trunk;ctx.fillRect(x-3*s,y-14*s,6*s,14*s);
    ctx.fillStyle=mix('#4f6a42','#1f7a4a',clean);
    for(let k=0;k<3;k++){const w=(30-k*7)*s,yy=y-14*s-k*22*s;ctx.beginPath();ctx.moveTo(x,yy-34*s);ctx.lineTo(x+w,yy);ctx.lineTo(x-w,yy);ctx.closePath();ctx.fill()}
  }else{ // leafy tree
    ctx.fillStyle=trunk;ctx.fillRect(x-4*s,y-30*s,8*s,30*s);
    ctx.fillStyle=mix('#7d8a4a','#3fae5a',clean);
    ctx.beginPath();ctx.arc(x,y-48*s,26*s,0,6.283);ctx.arc(x-18*s,y-36*s,18*s,0,6.283);ctx.arc(x+18*s,y-38*s,19*s,0,6.283);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.arc(x-8*s,y-56*s,12*s,0,6.283);ctx.fill();
  }
}
function drawGround(camX,clean){
  const g=ctx.createLinearGradient(0,382,0,ROAD_TOP);
  g.addColorStop(0,mix('#6c8a4c','#4fae5c',clean));g.addColorStop(1,mix('#5f7d43','#3f9a50',clean));
  ctx.fillStyle=g;ctx.fillRect(0,382,W,ROAD_TOP-382+2);
}
function drawTrees(camX,clean){
  const first=Math.floor((camX-80)/96);
  for(let c=first;c<first+Math.ceil((W+200)/96)+2;c++){
    if(rnd(c*5.3)>.72)continue;
    const wx=c*96+rnd(c+11)*60;
    if(STOPS.some(s=>Math.abs(s.x-wx)<300))continue;
    const sx=wx-camX,y=398+rnd(c+21)*6,s=.75+rnd(c+31)*.55;
    tree(sx,y,s,rnd(c+41)>.5?0:1,clean);
  }
}
function drawLitter(camX,clean){
  const dirt=1-clean;if(dirt<.03)return;
  const first=Math.floor((camX-40)/70);
  for(let c=first;c<first+Math.ceil(W/70)+2;c++){
    if(rnd(c*9.1)>dirt*.55)continue;
    const wx=c*70+rnd(c+1)*50;
    if(STOPS.some(s=>Math.abs(s.x-wx)<130))continue;
    const sx=wx-camX,y=400+rnd(c+2)*7,k=Math.floor(rnd(c+3)*3);
    ctx.save();ctx.translate(sx,y);ctx.rotate(rnd(c+4)*3-1.5);
    if(k===0){ctx.fillStyle='#b8bcc2';ctx.fillRect(-4,-5,8,10);ctx.fillStyle='#e04b4b';ctx.fillRect(-4,-2,8,3)}
    else if(k===1){ctx.fillStyle='#d7efe0';ctx.fillRect(-2,-9,4,12);ctx.fillRect(-4,0,8,6)}
    else{ctx.fillStyle='#f2f2f2';ctx.beginPath();ctx.ellipse(0,0,8,5,0,0,6.283);ctx.fill()}
    ctx.restore();
  }
}
function drawPerson(x,footY,p,s,alpha){
  ctx.save();ctx.globalAlpha=alpha==null?1:alpha;ctx.translate(x,footY);ctx.scale(s,s);
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.ellipse(0,1,9,3,0,0,6.283);ctx.fill();
  ctx.fillStyle='#2b3140';ctx.fillRect(-5,-16,4,16);ctx.fillRect(1,-16,4,16);
  ctx.fillStyle=p.shirt;rr(-7,-34,14,20,5);ctx.fill();
  ctx.fillStyle=p.skin;ctx.beginPath();ctx.arc(0,-40,6.5,0,6.283);ctx.fill();
  ctx.fillStyle=p.hair;ctx.beginPath();ctx.arc(0,-42,6.8,Math.PI,0);ctx.fill();
  ctx.restore();
}
function drawStopProps(camX,t){
  for(let i=0;i<STOPS.length;i++){
    const s=STOPS[i],sx=s.x-camX;
    if(sx<-200||sx>W+200)continue;
    // shelter
    ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(sx+20,ROAD_TOP-6,96,6);
    ctx.fillStyle='#37424d';ctx.fillRect(sx+22,ROAD_TOP-70,4,66);ctx.fillRect(sx+110,ROAD_TOP-70,4,66);
    ctx.fillStyle='rgba(160,215,235,.28)';ctx.fillRect(sx+26,ROAD_TOP-66,84,60);
    ctx.fillStyle='#2dd4a7';rr(sx+16,ROAD_TOP-76,106,9,4);ctx.fill();
    // sign
    ctx.fillStyle='#37424d';ctx.fillRect(sx-2,ROAD_TOP-118,4,114);
    ctx.fillStyle='#2563eb';ctx.beginPath();ctx.arc(sx,ROAD_TOP-126,19,0,6.283);ctx.fill();
    ctx.fillStyle='#fff';rr(sx-11,ROAD_TOP-135,22,15,3);ctx.fill();
    ctx.fillStyle='#2563eb';ctx.fillRect(sx-8,ROAD_TOP-132,16,6);
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(sx-6,ROAD_TOP-118,2.6,0,6.283);ctx.arc(sx+6,ROAD_TOP-118,2.6,0,6.283);ctx.fill();
    // name board
    ctx.font='700 17px Inter,Arial,sans-serif';
    const tw=ctx.measureText(s.name).width+24;
    ctx.fillStyle='#0f2a22';rr(sx-tw/2,ROAD_TOP-174,tw,28,9);ctx.fill();
    ctx.strokeStyle='#d8f277';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(s.name,sx,ROAD_TOP-154);
    // waiting people
    const wait=G.waiting[i];
    for(let k=0;k<wait.length;k++){
      const px=sx+34+k*11+(k%2)*4,bob=Math.sin(t*2+k*1.7)*.7;
      drawPerson(px,ROAD_TOP-2+(k%2)*3+bob,wait[k],.78);
    }
  }
}
function drawRoad(camX,t){
  // curb + sidewalk
  ctx.fillStyle='#cfc7b2';ctx.fillRect(0,ROAD_TOP-8,W,10);
  const g=ctx.createLinearGradient(0,ROAD_TOP,0,ROAD_BOT);
  g.addColorStop(0,'#4d535d');g.addColorStop(1,'#353a42');
  ctx.fillStyle=g;ctx.fillRect(0,ROAD_TOP+2,W,ROAD_BOT-ROAD_TOP);
  ctx.fillStyle='rgba(255,255,255,.75)';
  ctx.fillRect(0,ROAD_TOP+8,W,2);ctx.fillRect(0,ROAD_BOT-8,W,2);
  ctx.fillStyle='rgba(255,236,150,.9)';
  const off=-((camX%90)+90)%90;
  for(let x=off-90;x<W+90;x+=90)ctx.fillRect(x,ROAD_TOP+48,46,3);
  // grass strip under the road
  const fg=ctx.createLinearGradient(0,ROAD_BOT,0,H);
  fg.addColorStop(0,'#3f8f4d');fg.addColorStop(1,'#2c6e3b');
  ctx.fillStyle=fg;ctx.fillRect(0,ROAD_BOT,W,H-ROAD_BOT);
  ctx.fillStyle='#1f3a2b';ctx.fillRect(0,ROAD_BOT,W,3);
}
function drawZone(camX,t){
  const i=nearestStop();
  const s=STOPS[i.i],cx=s.x-DOOR_OFF-camX;
  if(cx<-200||cx>W+200)return;
  const inside=i.d<ZONE&&G.v<18;
  const pulse=.5+.5*Math.sin(t*4);
  ctx.save();
  ctx.fillStyle=inside?'rgba(216,242,119,'+(.28+.12*pulse)+')':'rgba(45,212,167,.2)';
  ctx.beginPath();ctx.moveTo(cx-ZONE,ROAD_TOP+58);ctx.lineTo(cx+ZONE,ROAD_TOP+58);ctx.lineTo(cx+ZONE+14,ROAD_BOT-12);ctx.lineTo(cx-ZONE-14,ROAD_BOT-12);ctx.closePath();ctx.fill();
  ctx.strokeStyle=inside?'#d8f277':'#2dd4a7';ctx.lineWidth=3;ctx.setLineDash([12,9]);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=inside?'#d8f277':'rgba(255,255,255,.8)';ctx.font='800 15px Inter,Arial,sans-serif';ctx.textAlign='center';
  ctx.fillText(inside?'PRESS SPACE':'BUS STOP',cx,ROAD_BOT-24);
  ctx.restore();
}
function drawTokens(camX,t){
  for(const k of G.tokens){
    if(k.got)continue;
    const sx=k.x-camX;if(sx<-40||sx>W+40)continue;
    const y=BUS_Y-70+Math.sin(t*3+k.ph)*8;
    ctx.save();ctx.translate(sx,y);
    ctx.fillStyle='rgba(216,242,119,.22)';ctx.beginPath();ctx.arc(0,0,21,0,6.283);ctx.fill();
    ctx.rotate(-.6+Math.sin(t*2+k.ph)*.15);
    ctx.fillStyle='#2dd4a7';ctx.beginPath();ctx.moveTo(-11,6);ctx.quadraticCurveTo(-8,-14,12,-12);ctx.quadraticCurveTo(12,8,-11,6);ctx.fill();
    ctx.strokeStyle='#0f6b4f';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(-10,6);ctx.lineTo(8,-8);ctx.stroke();
    ctx.restore();
  }
}
function drawCar(sx,color){
  ctx.save();ctx.translate(sx,CAR_Y);
  ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(0,2,48,5,0,0,6.283);ctx.fill();
  ctx.fillStyle=color;rr(-46,-30,92,22,9);ctx.fill();
  rr(-24,-48,52,24,10);ctx.fill();
  ctx.fillStyle='#bfe3f2';rr(-19,-44,20,17,5);ctx.fill();rr(5,-44,19,17,5);ctx.fill();
  ctx.fillStyle='#fff3b0';ctx.fillRect(-46,-24,4,6);
  ctx.fillStyle='#d1342b';ctx.fillRect(42,-24,4,6);
  ctx.fillStyle='#16191f';ctx.beginPath();ctx.arc(-26,-8,9,0,6.283);ctx.arc(26,-8,9,0,6.283);ctx.fill();
  ctx.fillStyle='#aab2ba';ctx.beginPath();ctx.arc(-26,-8,4,0,6.283);ctx.arc(26,-8,4,0,6.283);ctx.fill();
  ctx.restore();
}
function drawBus(sx,doorsOpen,pass,t){
  const moving=clamp(G.v/MAXV,0,1);
  const bob=Math.sin(t*(8+moving*10))*moving*1.4;
  const tilt=(input.brake&&G.v>60?-0.012:0)+(input.gas&&G.v<MAXV*.7&&!G.doors.busy?0.01:0);
  ctx.fillStyle='rgba(0,0,0,.32)';ctx.beginPath();ctx.ellipse(sx,BUS_Y+2,150,9,0,0,6.283);ctx.fill();
  ctx.save();ctx.translate(sx,BUS_Y+bob);ctx.rotate(tilt);
  // body
  const bg=ctx.createLinearGradient(0,-124,0,-18);
  bg.addColorStop(0,'#46e08e');bg.addColorStop(.55,'#2fbf71');bg.addColorStop(1,'#1c8a52');
  ctx.fillStyle=bg;rr(-132,-122,264,104,18);ctx.fill();
  // roof + pantograph
  ctx.fillStyle='#ecfff4';rr(-126,-128,252,10,5);ctx.fill();
  ctx.fillStyle='#6b7280';rr(-50,-136,76,8,3);ctx.fill();
  ctx.strokeStyle='#4b5563';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-20,-136);ctx.lineTo(-4,-148);ctx.lineTo(14,-136);ctx.stroke();
  // lower band
  ctx.fillStyle='#15764a';ctx.fillRect(-132,-46,264,12);
  ctx.fillStyle='#d8f277';ctx.fillRect(-132,-36,264,3);
  // text + leaf logo (between the windows and the wheel band)
  ctx.save();ctx.translate(-110,-57);ctx.rotate(-.6);ctx.fillStyle='#d8f277';ctx.beginPath();ctx.moveTo(-7,4);ctx.quadraticCurveTo(-5,-9,9,-8);ctx.quadraticCurveTo(9,5,-7,4);ctx.fill();ctx.restore();
  ctx.fillStyle='#f4fff8';ctx.font='800 15px Inter,Arial,sans-serif';ctx.textAlign='left';ctx.fillText('ECO BUS',-98,-52);
    // windows
  for(let i=0;i<5;i++){
    const wx=-120+i*38;
    const wg=ctx.createLinearGradient(wx,-110,wx+30,-62);
    wg.addColorStop(0,'#27495a');wg.addColorStop(1,'#14303d');
    ctx.fillStyle=wg;rr(wx,-110,30,46,6);ctx.fill();
  }
  // passengers (heads in the windows)
  for(let k=0;k<pass.length&&k<16;k++){
    const p=pass[k];
    let hx,hy=-82+((k%3)===1?-3:0);
    if(k<15){const win=Math.floor(k/3),slot=k%3;hx=-120+win*38+6+slot*9.5}
    else{hx=84;hy=-78}
    ctx.fillStyle=p.shirt;rr(hx-5,-70,10,8,3);ctx.fill();
    ctx.fillStyle=p.skin;ctx.beginPath();ctx.arc(hx,hy+4,5.2,0,6.283);ctx.fill();
    ctx.fillStyle=p.hair;ctx.beginPath();ctx.arc(hx,hy+2.5,5.4,Math.PI,0);ctx.fill();
  }
  // window shine
  ctx.fillStyle='rgba(255,255,255,.12)';
  for(let i=0;i<5;i++){const wx=-120+i*38;ctx.beginPath();ctx.moveTo(wx+2,-108);ctx.lineTo(wx+14,-108);ctx.lineTo(wx+2,-76);ctx.closePath();ctx.fill()}
  // door
  ctx.fillStyle='#145c3a';rr(64,-112,40,94,5);ctx.fill();
  if(doorsOpen){
    ctx.fillStyle='#0b2a1d';rr(67,-108,34,88,4);ctx.fill();
    ctx.fillStyle='rgba(255,230,150,.35)';rr(69,-106,30,84,4);ctx.fill();
    ctx.fillStyle='#1c8a52';ctx.fillRect(67,-108,7,88);
    ctx.fillStyle='#2b6b8a';ctx.fillRect(67,-104,7,40);
  }else{
    ctx.fillStyle='#1f9d5a';rr(67,-108,16.5,88,3);ctx.fill();rr(84.5,-108,16.5,88,3);ctx.fill();
    ctx.fillStyle='#27495a';rr(70,-104,11,42,3);ctx.fill();rr(87,-104,11,42,3);ctx.fill();
  }
  // front windshield + driver
  ctx.fillStyle='#1b3e50';rr(108,-112,20,56,7);ctx.fill();
  ctx.fillStyle='#e8b98f';ctx.beginPath();ctx.arc(117,-86,5.5,0,6.283);ctx.fill();
  ctx.fillStyle='#2b6cb0';rr(112,-80,10,10,3);ctx.fill();
  // lights + bumpers
  ctx.fillStyle='#fff7c2';ctx.beginPath();ctx.ellipse(130,-40,4,6,0,0,6.283);ctx.fill();
  ctx.fillStyle='#ff4d4d';ctx.fillRect(-133,-60,4,12);
  ctx.fillStyle='#10201a';ctx.fillRect(-134,-22,268,6);
  // wheels
  for(const wx of[-82,80]){
    ctx.fillStyle='#10201a';ctx.beginPath();ctx.arc(wx,-18,27,Math.PI,0);ctx.fill();
    ctx.save();ctx.translate(wx,-18);ctx.fillStyle='#17171a';ctx.beginPath();ctx.arc(0,0,22,0,6.283);ctx.fill();
    ctx.fillStyle='#dfe6e2';ctx.beginPath();ctx.arc(0,0,12,0,6.283);ctx.fill();
    ctx.rotate(wheelAngle);ctx.strokeStyle='#6b7a74';ctx.lineWidth=3;
    for(let k=0;k<4;k++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(-11,0);ctx.lineTo(11,0);ctx.stroke()}
    ctx.restore();
  }
  ctx.restore();
}
function drawParticles(camX){
  for(const p of G.particles){
    const sx=p.x-camX,a=1-p.t/p.life;
    if(p.type==='smoke'){ctx.fillStyle='rgba(95,95,100,'+(a*.55)+')';ctx.beginPath();ctx.arc(sx,p.y,p.r*(1+p.t*1.4),0,6.283);ctx.fill()}
    else if(p.type==='spark'){ctx.fillStyle='rgba(216,242,119,'+(a*.8)+')';ctx.beginPath();ctx.arc(sx,p.y,p.r*a+.6,0,6.283);ctx.fill()}
    else{ctx.fillStyle='rgba(45,212,167,'+a+')';ctx.beginPath();ctx.ellipse(sx,p.y,p.r*1.6,p.r,p.t*6,0,6.283);ctx.fill()}
  }
}
function drawWalkers(camX){
  for(const w of G.walkers){
    const k=clamp(w.t/w.dur,0,1),e=smooth(k);
    const x=lerp(w.x0,w.x1,e)-camX,y=lerp(w.y0,w.y1,e);
    const alpha=w.kind==='in'?(k>.7?1-(k-.7)/.3:1):(k<.15?k/.15:(k>.7?1-(k-.7)/.3:1));
    drawPerson(x,y+Math.abs(Math.sin(k*14))*-2,w.p,.9-(.1*(y<430?1:0)),clamp(alpha,0,1));
  }
}
function drawForeground(camX){
  const first=Math.floor((camX*1.2-30)/38);
  for(let c=first;c<first+Math.ceil(W/38)+4;c++){
    if(rnd(c*2.3)>.75)continue;
    const wx=c*38+rnd(c)*20;
    const x=wx-camX*1.2;
    const y=ROAD_BOT+8+rnd(c+3)*24,h=10+rnd(c+9)*14;
    ctx.strokeStyle=rnd(c+4)>.5?'#245a33':'#2f7a43';ctx.lineWidth=2.4;
    ctx.beginPath();ctx.moveTo(x-5,y+4);ctx.lineTo(x-7,y-h);ctx.moveTo(x,y+4);ctx.lineTo(x,y-h-5);ctx.moveTo(x+5,y+4);ctx.lineTo(x+8,y-h);ctx.stroke();
    if(rnd(c+12)>.7){ctx.fillStyle=pick2(c);ctx.beginPath();ctx.arc(x,y-h-6,3.2,0,6.283);ctx.fill()}
  }
}
function pick2(c){return['#ffffff','#ffd166','#ff7a59','#f9a8d4'][Math.floor(rnd(c+77)*4)]}
function drawOverlays(haze){
  // smog overlay on the whole picture when the air is dirty
  if(haze>.02){
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'rgba(150,140,115,'+(haze*.3)+')');g.addColorStop(.75,'rgba(165,150,120,'+(haze*.2)+')');g.addColorStop(1,'rgba(120,110,90,'+(haze*.1)+')');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  }
  // soft vignette
  const v=ctx.createRadialGradient(W/2,H/2,H*.45,W/2,H/2,H*.95);
  v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.35)');
  ctx.fillStyle=v;ctx.fillRect(0,0,W,H);
}
function drawTexts(camX){
  ctx.textAlign='center';
  for(const f of G.floaters){
    const a=clamp(f.t/.5,0,1),y=f.y-(1.3-f.t)*40;
    ctx.globalAlpha=a;ctx.fillStyle='#0b1b14';ctx.font='800 24px Inter,Arial,sans-serif';ctx.fillText(f.text,f.x-camX+1,y+2);
    ctx.fillStyle=f.color;ctx.fillText(f.text,f.x-camX,y);ctx.globalAlpha=1;
  }
  if(G.toast){
    const a=clamp(Math.min(G.toast.t,.4)/.4,0,1);
    ctx.font='700 22px Inter,Arial,sans-serif';
    const tw=Math.min(W-40,ctx.measureText(G.toast.text).width+44);
    ctx.globalAlpha=a;ctx.fillStyle='rgba(8,24,18,.88)';rr(W/2-tw/2,18,tw,48,24);ctx.fill();
    ctx.strokeStyle='rgba(216,242,119,.8)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#fff';ctx.fillText(G.toast.text,W/2,49,W-70);ctx.globalAlpha=1;
  }
}

/* ---------- render ---------- */
function render(){
  ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
  const intro=G.mode==='intro';
  const camX=intro?demoX:G.busX-BUS_SX;
  const prog=clamp(camX/ROUTE_LEN,0,1);
  const haze=intro?0.35:1-G.cleanShown;
  const t=G.t||0,tt=performance.now()/1000;
  ctx.clearRect(0,0,W,H);
  drawSky(haze,camX);
  drawMountains(camX,haze,prog);
  drawGround(camX,1-haze);
  drawLandmarks(camX,haze);
  drawTrees(camX,1-haze);
  drawLitter(camX,1-haze);
  drawStopProps(camX,tt);
  drawRoad(camX,tt);
  if(!intro)drawZone(camX,tt);
  drawTokens(camX,tt);
  for(const c of G.cars)drawCar(c.x-camX,c.color);
  drawBus(intro?BUS_SX:BUS_SX,G.doors.busy,intro?[]:G.onboard,tt);
  drawWalkers(camX);
  drawParticles(camX);
  drawForeground(camX);
  drawOverlays(haze);
  drawTexts(camX);
}

/* ---------- HUD (DOM) ---------- */
const el={
  speed:$('hud-speed'),batt:$('hud-batt'),battBar:$('hud-batt-bar'),seats:$('hud-seats'),time:$('hud-time'),score:$('hud-score'),
  next:$('hud-next'),
  car:$('co2-car'),bus:$('co2-bus'),saved:$('co2-saved'),carBar:$('co2-car-bar'),busBar:$('co2-bus-bar'),pct:$('co2-pct'),
  clean:$('clean-pct'),cleanBar:$('clean-bar'),
  prog:$('route-progress'),stops:$('route-stops'),fact:$('route-fact'),board:$('board-info')
};
let stopChips=[];
function buildRoute(){
  el.stops.replaceChildren();
  stopChips=STOPS.map((s,i)=>{
    const li=document.createElement('li');
    const name=document.createElement('strong');name.textContent=s.name;
    const km=document.createElement('span');km.className='km';km.textContent=s.km+' km';
    const w=document.createElement('span');w.className='wait';
    li.append(name,km,w);el.stops.append(li);
    return{li,w};
  });
}
function updateHud(){
  const g=G;
  el.speed.textContent=Math.round(g.v/6.5);
  const b=Math.round(g.battery);
  el.batt.textContent=b+'%';el.battBar.style.width=b+'%';
  el.battBar.parentElement.dataset.low=b<25?'1':'0';
  el.seats.textContent=g.onboard.length+' / '+CAP;
  el.time.textContent=fmtTime(g.t);
  el.score.textContent=g.score.toLocaleString('en');
  const saved=g.carKg-g.busKg;
  el.car.textContent=g.carKg.toFixed(1);
  el.bus.textContent=g.busKg.toFixed(1);
  el.saved.textContent=(saved>=0?'':'−')+Math.abs(saved).toFixed(1);
  el.saved.dataset.neg=saved<0?'1':'0';
  const mx=Math.max(g.carKg,g.busKg,1);
  el.carBar.style.width=(g.carKg/mx*100)+'%';
  el.busBar.style.width=(g.busKg/mx*100)+'%';
  el.pct.textContent=g.carKg>0.5?Math.round(saved/g.carKg*100)+'%':'–';
  el.clean.textContent=Math.round(g.cleanShown*100)+'%';
  el.cleanBar.style.width=(g.cleanShown*100)+'%';
  // next stop
  const doorX=g.busX+DOOR_OFF;
  let ni=STOPS.findIndex(s=>s.x>doorX+ZONE*.5);
  if(g.doors.busy)ni=Math.min(g.doors.idx+1,LAST);
  if(ni<0)ni=LAST;
  const dist=Math.max(0,STOPS[ni].x-doorX);
  el.next.textContent=STOPS[ni].name+' · '+(dist/KM_PX).toFixed(1)+' km';
  root.dataset.dist=String(Math.round(STOPS[ni].x-DOOR_OFF-g.busX));
  root.dataset.v=String(Math.round(g.v));
  root.dataset.mode=g.mode;
  const first=STOPS[0].x-DOOR_OFF,last=STOPS[LAST].x-DOOR_OFF;
  el.prog.style.setProperty('--p',(clamp((g.busX-first)/(last-first),0,1)*100).toFixed(1)+'%');
  const near=nearestStop();
  stopChips.forEach((c,i)=>{
    c.li.classList.toggle('done',g.visited.has(i));
    c.li.classList.toggle('next',i===ni);
    c.w.textContent=i===LAST?'end of line':(g.waiting[i].length?g.waiting[i].length+' waiting':'nobody waiting');
  });
  const showIdx=near.d<700?near.i:ni;
  el.fact.textContent=STOPS[showIdx].name+': '+STOPS[showIdx].fact;
  // who is on board / waiting
  const counts={};
  for(const p of g.onboard)counts[p.dest]=(counts[p.dest]||0)+1;
  const parts=Object.keys(counts).map(k=>counts[k]+' → '+STOPS[k].name);
  let txt='On board: '+(parts.length?parts.join(', '):'nobody yet');
  if(near.d<ZONE+300&&near.i<LAST){
    const wc={};for(const p of g.waiting[near.i])wc[p.dest]=(wc[p.dest]||0)+1;
    const wp=Object.keys(wc).map(k=>wc[k]+' → '+STOPS[k].name);
    txt+='  |  Waiting at '+STOPS[near.i].name+': '+(wp.length?wp.join(', '):'nobody');
  }
  el.board.textContent=txt;
}

/* ---------- loop ---------- */
function frame(ts){
  const dt=Math.min(0.05,(ts-lastT)/1000||0);lastT=ts;
  if(visible){
    if(G.mode==='playing')update(dt);
    else if(G.mode==='intro'){demoX=(demoX+70*dt)%(ROUTE_LEN*.6);wheelAngle+=70*dt/21}
    render();
    hudTimer-=dt;
    if(hudTimer<=0){hudTimer=0.1;updateHud()}
  }
  requestAnimationFrame(frame);
}

/* ---------- controls ---------- */
function setPlaying(){
  G.mode='playing';
  $('game-intro').hidden=true;$('game-pause').hidden=true;$('game-end').hidden=true;
  root.classList.add('is-playing');
}
function startGame(){
  ensureAudio();
  if(actx&&actx.state==='suspended')actx.resume();
  newGame();buildRoute();setPlaying();
  toast('Drive to the green bus stop zone in Piran!',3.2);
  updateHud();
}
function pauseGame(){
  if(!G||G.mode!=='playing')return;
  G.mode='paused';input.gas=false;input.brake=false;
  $('game-pause').hidden=false;$('game-resume').focus({preventScroll:true});
  root.classList.remove('is-playing');
}
function resumeGame(){
  if(G.mode!=='paused')return;
  G.mode='playing';$('game-pause').hidden=true;root.classList.add('is-playing');
}
const KEYS={ArrowRight:'gas',ArrowUp:'gas',d:'gas',D:'gas',w:'gas',W:'gas',ArrowLeft:'brake',ArrowDown:'brake',a:'brake',A:'brake',s:'brake',S:'brake'};
window.addEventListener('keydown',e=>{
  if(!G||e.ctrlKey||e.metaKey||e.altKey)return;
  const active=G.mode==='playing'||G.mode==='paused';
  if(!active)return;
  const k=KEYS[e.key];
  if(k||e.key===' '||e.key==='Spacebar'||e.key==='p'||e.key==='P'||e.key==='Escape'){
    if(visible||G.mode==='paused')e.preventDefault();
  }
  if(e.target&&(e.target.tagName==='BUTTON')&&(e.key===' '||e.key==='Enter')&&G.mode==='paused')return;
  if(k){input[k]=true;return}
  if(e.key===' '||e.key==='Spacebar'){if(!e.repeat)tryDoors()}
  else if(e.key==='p'||e.key==='P'||e.key==='Escape'){if(G.mode==='playing')pauseGame();else resumeGame()}
});
window.addEventListener('keyup',e=>{const k=KEYS[e.key];if(k)input[k]=false});
window.addEventListener('blur',()=>{input.gas=false;input.brake=false;if(G&&G.mode==='playing')pauseGame()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G&&G.mode==='playing')pauseGame()});

function holdButton(id,key){
  const b=$(id);if(!b)return;
  const on=e=>{e.preventDefault();input[key]=true;b.classList.add('down');try{b.setPointerCapture(e.pointerId)}catch(x){}};
  const off=()=>{input[key]=false;b.classList.remove('down')};
  b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointercancel',off);b.addEventListener('lostpointercapture',off);
  b.addEventListener('contextmenu',e=>e.preventDefault());
}
holdButton('touch-gas','gas');holdButton('touch-brake','brake');
$('touch-doors').addEventListener('click',()=>tryDoors());
$('game-start').addEventListener('click',startGame);
$('game-again').addEventListener('click',startGame);
$('game-resume').addEventListener('click',resumeGame);
$('game-pause-btn').addEventListener('click',()=>{if(G.mode==='playing')pauseGame();else if(G.mode==='paused')resumeGame()});
$('game-sound').addEventListener('click',e=>{
  soundOn=!soundOn;e.currentTarget.setAttribute('aria-pressed',String(soundOn));
  e.currentTarget.textContent=soundOn?'🔊 Sound on':'🔇 Sound off';
  if(soundOn){ensureAudio();if(actx&&actx.state==='suspended')actx.resume()}
});

/* ---------- visibility + sizing ---------- */
function resize(){
  const r=canvas.getBoundingClientRect();
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.width*dpr*H/W));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
}
window.addEventListener('resize',resize);
if('ResizeObserver' in window)new ResizeObserver(resize).observe(canvas);
if('IntersectionObserver' in window){
  new IntersectionObserver(es=>{
    visible=es[0].isIntersecting;
    if(!visible&&G&&G.mode==='playing'){pauseGame()}
  },{threshold:.15}).observe($('game-stage'));
}
buildRoute();resize();updateHud();
$('game-best').textContent=best?'Best score: '+best.toLocaleString('en'):'';
requestAnimationFrame(frame);
})();
