// JLR Christmas Quiz – live host-controlled quiz. No dependencies; needs Node 16+.
// Run:  HOST_KEY=mysecret node server.js     (default key: xmas)
// Players:  http://<address>/           Host (you):  http://<address>/host?key=mysecret
// Projector (leaderboard + QR, no answers):  http://<address>/board
const http = require('http');
const crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const HOST_KEY = process.env.HOST_KEY || 'xmas';

const Q = [
 {q:"Jaguar began life in 1922 as the Swallow Sidecar Company. What did it originally make?",o:["Bicycle frames","Motorcycle sidecars","Baby prams","Aircraft parts"],a:1,f:"William Lyons and William Walmsley started out making sidecars in Blackpool."},
 {q:"SS Cars renamed itself 'Jaguar' in 1945. Why drop 'SS'?",o:["A trademark dispute with Rolls-Royce","A merger with Daimler","A new marketing slogan","The initials had unfortunate wartime associations"],a:3,f:"After WWII, 'SS' was no longer a name anyone wanted on a car."},
 {q:"At which motor show was the first Land Rover unveiled in April 1948?",o:["Paris","Amsterdam","Geneva","London"],a:1,f:"The Series I debuted in Amsterdam, aimed at farmers and export markets."},
 {q:"Which vehicle inspired the original Land Rover design?",o:["Austin Champ","Citroën 2CV","Willys Jeep","Fordson tractor"],a:2,f:"Rover's Maurice Wilks used a war-surplus Willys Jeep on his Welsh farm."},
 {q:"The first Land Rovers came in a very limited colour range. What colour were they?",o:["Bright red","Sky blue","Black","Light green"],a:3,f:"Commonly told story: leftover aircraft cockpit paint, so green it was."},
 {q:"The Jaguar E-Type was unveiled in 1961 at which Swiss city's motor show?",o:["Geneva","Zurich","Basel","Bern"],a:0,f:"Enzo Ferrari reportedly called it the most beautiful car ever made."},
 {q:"How many overall Le Mans 24 Hours wins has Jaguar achieved?",o:["3","5","7","9"],a:2,f:"Five in the 1950s (1951-57) plus 1988 and 1990."},
 {q:"In 1971 a Range Rover was displayed in which famous museum as an 'exhibit of industrial design'?",o:["MoMA, New York","The Louvre, Paris","V&A, London","Science Museum, London"],a:1,f:"The original Range Rover launched in 1970 and was treated as a design icon."},
 {q:"Which Land Rover launched in 1989 as a family-friendly seven-seater?",o:["Freelander","Evoque","Discovery","Velar"],a:2,f:"It took Land Rover beyond the farm and the Range Rover's price point."},
 {q:"Which carmaker bought Jaguar in 1989 (and Land Rover in 2000)?",o:["Ford","BMW","General Motors","Toyota"],a:0,f:"Ford owned both brands until 2008."},
 {q:"In 2008 Tata Motors bought Jaguar and Land Rover from Ford. Roughly how much did it pay?",o:["$500 million","$1.2 billion","$2.3 billion","$6 billion"],a:2,f:"Roughly $2.3bn. The two brands were merged into one company, JLR, in 2013."},
 {q:"Which Jaguar did TV detective Inspector Morse drive?",o:["E-Type","XJ6","XK120","Mark 2"],a:3,f:"A burgundy 1960 Mark 2 was Morse's trademark."},
 {q:"Which British monarch was famously a keen Land Rover driver, owning many over her life?",o:["Queen Victoria","King Charles II","Queen Elizabeth II","King Edward VII"],a:2,f:"Queen Elizabeth II drove Land Rovers around her estates for decades."},
 {q:"Which celebrity was a design consultant on the 2011 Range Rover Evoque?",o:["Kate Moss","Victoria Beckham","Lewis Hamilton","Naomi Campbell"],a:1,f:"Victoria Beckham worked on the Evoque, including a special edition."},
 {q:"Which West Midlands town has been home to Land Rover production since 1948?",o:["Halewood","Castle Bromwich","Solihull","Wolverhampton"],a:2,f:"Solihull is the historic home of Land Rover and Range Rover."}
];
const L = 'ABCD';
const BASE = 100, BONUS = 50, BONUS_MS = 20000;

let S = fresh();
function fresh(){ return {phase:'lobby', q:-1, openedAt:0, players:new Map()}; }
const clients = new Set();

function board(){
  const arr=[...S.players.entries()].map(([id,p])=>({id,name:p.name,score:p.score}));
  arr.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  let rank=0,prev=null,i=0;
  arr.forEach(p=>{i++; if(p.score!==prev){rank=i;prev=p.score} p.rank=rank});
  return arr;
}
function counts(){
  const c=[0,0,0,0];
  S.players.forEach(p=>{const a=p.answers[S.q]; if(a) c[a.c]++});
  return c;
}
function viewFor(c){
  const b=board(), base={phase:S.phase,q:S.q,total:Q.length,nPlayers:S.players.size};
  if(c.role==='host'||c.role==='board'){
    base.board=b.map(({name,score,rank})=>({name,score,rank}));
    base.answered=[...S.players.values()].filter(p=>p.answers[S.q]).length;
    if(c.role==='host'){
      base.counts=counts();
      const cur=Q[S.q]; if(cur) base.cur={text:cur.q,options:cur.o,correct:cur.a,fact:cur.f};
      const nx=Q[S.q+1]; if(nx) base.next={text:nx.q,options:nx.o};
    }
    if(c.role==='board' && S.phase==='reveal'){ const cur=Q[S.q]; base.reveal={letter:L[cur.a],text:cur.o[cur.a]}; }
    return base;
  }
  const p=S.players.get(c.id);
  if(!p) return {...base,unknown:true};
  const me=b.find(x=>x.id===c.id);
  base.you={name:p.name,score:p.score,rank:me.rank};
  const a=p.answers[S.q];
  if(S.phase==='question'){ base.you.chosen=a?a.c:null; base.options=Q[S.q].o; }
  if(S.phase==='reveal'){
    const cur=Q[S.q]; base.correct=cur.a; base.fact=cur.f;
    base.you.chosen=a?a.c:null; base.you.pts=a?a.pts:0;
  }
  return base;
}
function push(){ clients.forEach(c=>c.res.write('data: '+JSON.stringify(viewFor(c))+'\n\n')); }

function json(res,code,obj){ res.writeHead(code,{'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); }
function body(req){ return new Promise(r=>{let d='';req.on('data',x=>{d+=x;if(d.length>1e5)req.destroy()});req.on('end',()=>{try{r(JSON.parse(d||'{}'))}catch(e){r({})}})}) }

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x'); const path=u.pathname;
  const isHost=u.searchParams.get('key')===HOST_KEY;
  if(req.method==='GET'){
    if(path==='/') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(PLAYER); }
    if(path==='/host'){ if(!isHost){res.writeHead(403);return res.end('Forbidden – add ?key=YOURKEY')} res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(HOST); }
    if(path==='/board'){ res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); return res.end(BOARD); }
    if(path==='/events'){
      const role=u.searchParams.get('role')||'player';
      if(role==='host'&&!isHost){res.writeHead(403);return res.end()}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const c={res,role,id:u.searchParams.get('id')}; clients.add(c);
      res.write('retry: 1500\n'+'data: '+JSON.stringify(viewFor(c))+'\n\n');
      const ka=setInterval(()=>res.write(': ka\n\n'),20000);
      req.on('close',()=>{clients.delete(c);clearInterval(ka)});
      return;
    }
    res.writeHead(404); return res.end('Not found');
  }
  if(req.method==='POST'){
    const b=await body(req);
    if(path==='/join'){
      let name=String(b.name||'').trim().slice(0,24); if(!name) return json(res,400,{error:'name'});
      if(b.id && S.players.has(b.id)){ return json(res,200,{id:b.id}); }
      const names=new Set([...S.players.values()].map(p=>p.name.toLowerCase()));
      let n=name,i=2; while(names.has(n.toLowerCase())) n=name+' '+(i++);
      const id=crypto.randomBytes(8).toString('hex');
      S.players.set(id,{name:n,score:0,answers:{}}); push(); return json(res,200,{id,name:n});
    }
    if(path==='/answer'){
      const p=S.players.get(b.id);
      if(!p||S.phase!=='question'||p.answers[S.q]) return json(res,409,{});
      const c=+b.choice; if(!(c>=0&&c<=3)) return json(res,400,{});
      const el=Date.now()-S.openedAt;
      const pts=c===Q[S.q].a ? BASE+Math.round(BONUS*Math.max(0,1-el/BONUS_MS)) : 0;
      p.answers[S.q]={c,pts}; push(); return json(res,200,{ok:true});
    }
    if(path==='/host'){
      if(!isHost) return json(res,403,{});
      const a=b.action;
      if(a==='next' && (S.phase==='lobby'||S.phase==='reveal') ){
        if(S.q+1>=Q.length){ S.phase='end'; }
        else { S.q++; S.phase='question'; S.openedAt=Date.now(); }
      } else if(a==='reveal' && S.phase==='question'){
        S.players.forEach(p=>{const x=p.answers[S.q]; if(x) p.score+=x.pts});
        S.phase='reveal';
      } else if(a==='reset'){ S=fresh(); }
      push(); return json(res,200,{ok:true});
    }
  }
  res.writeHead(404); res.end();
});
server.listen(PORT,()=>console.log('Quiz running on port '+PORT+'\n  Players: /\n  Host:    /host?key='+HOST_KEY+'\n  Board:   /board'));

// ---------- Pages ----------
const CSS = `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b3d2e;color:#fff;min-height:100vh}
h1{margin:0;font-size:22px}.wrap{max-width:560px;margin:0 auto;padding:20px}.card{background:#fff;color:#1c1c1c;border-radius:14px;padding:16px;margin:12px 0}
input{width:100%;padding:14px;font-size:18px;border:2px solid #ddd;border-radius:10px}button{font-family:inherit}
.btn{width:100%;padding:16px;font-size:18px;font-weight:700;border:0;border-radius:12px;background:#b3202a;color:#fff;margin-top:10px}
.gold{color:#c9a24b}.center{text-align:center}.small{font-size:14px;opacity:.8}`;

const PLAYER = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>JLR Quiz</title><style>${CSS}
.opts{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.opt{display:flex;align-items:center;gap:14px;text-align:left;min-height:84px;padding:12px 16px;font-size:19px;font-weight:600;border:0;border-radius:16px;color:#fff;width:100%}
.opt b{font-size:40px;font-weight:800;min-width:40px;text-align:center}
.o0{background:#b3202a}.o1{background:#1c5fa8}.o2{background:#c9892b}.o3{background:#2a8a4a}
.opt.dim{opacity:.25}.opt.pick{outline:6px solid #fff}.opt.right{outline:6px solid #fff;box-shadow:0 0 0 12px #2fd36a}
.big{font-size:56px;font-weight:800}</style></head><body><div class="wrap" id="app"></div>
<script>
const app=document.getElementById('app');let id=null,name='',view=null;
try{id=localStorage.getItem('jlr_id');name=localStorage.getItem('jlr_name')||''}catch(e){}
function joinForm(){app.innerHTML='<div class="center"><h1>🎄 JLR Christmas Quiz</h1><p class="small">Enter your name or team name</p></div><input id="n" maxlength="24" placeholder="Name" value="'+name.replace(/"/g,'')+'"><button class="btn" id="j">Join</button>';
 document.getElementById('j').onclick=async()=>{const v=document.getElementById('n').value.trim();if(!v)return;
  const r=await fetch('/join',{method:'POST',body:JSON.stringify({name:v})});const d=await r.json();id=d.id;name=d.name;try{localStorage.setItem('jlr_id',id);localStorage.setItem('jlr_name',name)}catch(e){}connect()}}
let es;function connect(){if(es)es.close();es=new EventSource('/events?role=player&id='+id);es.onmessage=e=>{view=JSON.parse(e.data);render()}}
async function pick(c){if(view.you.chosen!=null)return;view.you.chosen=c;render();await fetch('/answer',{method:'POST',body:JSON.stringify({id,choice:c})})}
function head(){return '<div class="small center">'+view.you.name+' · '+view.you.score+' pts · rank '+view.you.rank+'/'+view.nPlayers+'</div>'}
function render(){
 if(view.unknown){id=null;try{localStorage.removeItem('jlr_id')}catch(e){}return joinForm()}
 const ph=view.phase;let h=head();
 if(ph==='lobby')h+='<div class="center card"><h1>You are in! 🎉</h1><p>Waiting for the host to start…</p></div>';
 else if(ph==='question'){const ch=view.you.chosen;h+='<div class="center"><h1>Question '+(view.q+1)+' of '+view.total+'</h1><p class="small">'+(ch==null?'Pick your answer':'Locked in – waiting for the reveal…')+'</p></div><div class="opts">'+
  [0,1,2,3].map(i=>'<button class="opt o'+i+(ch!=null&&ch!==i?' dim':'')+(ch===i?' pick':'')+'" '+(ch!=null?'disabled':'')+' onclick="pick('+i+')"><b>'+'ABCD'[i]+'</b><span>'+view.options[i]+'</span></button>').join('')+'</div>'}
 else if(ph==='reveal'){const ch=view.you.chosen,ok=ch===view.correct;
  h+='<div class="center card"><div class="big">'+(ch==null?'⏱️':ok?'✅':'❌')+'</div><h1>'+(ch==null?'No answer':ok?'Correct! +'+view.you.pts:'Not this time')+'</h1><p>Answer: <b>'+'ABCD'[view.correct]+'</b></p><p class="small">'+view.fact+'</p></div><div class="center"><p>Score <b>'+view.you.score+'</b> · Rank <b>'+view.you.rank+'</b> of '+view.nPlayers+'</p></div>'}
 else if(ph==='end')h+='<div class="center card"><h1>Game over!</h1><div class="big">#'+view.you.rank+'</div><p>'+view.you.score+' points</p></div>';
 app.innerHTML=h}
if(id)connect();else joinForm();
</script></body></html>`;

const QR = `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>`;

const HOST = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quiz Host</title><style>${CSS}
.wrap{max-width:900px}.grid{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
.opt{padding:10px 12px;border-radius:8px;background:#eee;margin:6px 0;display:flex;justify-content:space-between}.opt.ok{background:#b9eccb;font-weight:700}
.q{font-size:22px;font-weight:700}table{width:100%;border-collapse:collapse}td{padding:5px 4px;border-bottom:1px solid #eee}td:last-child{text-align:right;font-weight:700}
.row{display:flex;gap:10px}.row .btn{flex:1}.sec{background:#555}</style></head><body><div class="wrap">
<h1>🎙️ Host console <span class="gold" id="st"></span></h1><div class="grid"><div id="main"></div><div><div class="card"><b>Leaderboard</b><table id="lb"></table></div><div class="card center" id="qr"><div class="small" style="color:#333">Join link</div><div id="qrbox" style="display:inline-block;margin:8px"></div><div class="small" style="color:#333;word-break:break-all" id="url"></div></div></div></div></div>${QR}
<script>
const key=new URLSearchParams(location.search).get('key');
const joinUrl=location.origin+'/';document.getElementById('url').textContent=joinUrl;
try{new QRCode(document.getElementById('qrbox'),{text:joinUrl,width:160,height:160})}catch(e){}
const act=a=>fetch('/host?key='+encodeURIComponent(key),{method:'POST',body:JSON.stringify({action:a})});
const es=new EventSource('/events?role=host&key='+encodeURIComponent(key));
es.onmessage=e=>{const v=JSON.parse(e.data);
 document.getElementById('st').textContent=v.q>=0&&v.phase!=='end'?'– Q'+(v.q+1)+'/'+v.total:'';
 document.getElementById('lb').innerHTML=v.board.slice(0,15).map(p=>'<tr><td>'+p.rank+'</td><td>'+p.name+'</td><td>'+p.score+'</td></tr>').join('')||'<tr><td class="small">No players yet</td></tr>';
 let h='';const L='ABCD';
 if(v.phase==='lobby'){h='<div class="card"><h1>Lobby</h1><p><b>'+v.nPlayers+'</b> players joined.</p>'+(v.next?'<p class="small">First question: '+v.next.text+'</p>':'')+'<button class="btn" onclick="act(\\'next\\')">Start quiz → Question 1</button></div>'}
 else if(v.phase==='question'||v.phase==='reveal'){const c=v.cur;
  h='<div class="card"><div class="q">'+(v.q+1)+'. '+c.text+'</div>'+c.options.map((o,i)=>'<div class="opt'+(v.phase==='reveal'&&i===c.correct?' ok':'')+'"><span>'+L[i]+'. '+o+(i===c.correct?' ✔':'')+'</span><span>'+v.counts[i]+'</span></div>').join('')+
  '<p class="small">Answered: '+v.answered+' / '+v.nPlayers+'</p>'+(v.phase==='reveal'?'<p>💡 '+c.fact+'</p>':'')+'</div>';
  if(v.phase==='question')h+='<button class="btn" onclick="act(\\'reveal\\')">Close answers &amp; reveal</button>';
  else h+='<button class="btn" onclick="act(\\'next\\')">'+(v.q+1>=v.total?'Finish – final results':'Next question → '+(v.q+2))+'</button>'+(v.next?'<div class="card"><b>Coming up:</b> '+v.next.text+'</div>':'');}
 else if(v.phase==='end'){h='<div class="card"><h1>🏆 Final results</h1><p>See the leaderboard →</p></div>'}
 h+='<button class="btn sec" onclick="if(confirm(\\'Reset the whole game and remove all players?\\'))act(\\'reset\\')">Reset game</button>';
 document.getElementById('main').innerHTML=h}
</script></body></html>`;

const BOARD = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leaderboard</title><style>${CSS}
.wrap{max-width:1000px}h1{font-size:44px}table{width:100%;font-size:32px;border-collapse:collapse}td{padding:8px 12px;border-bottom:1px solid #ffffff22}td:first-child{width:70px;color:#c9a24b;font-weight:800}td:last-child{text-align:right;font-weight:800}
.row{display:flex;gap:30px;align-items:flex-start}#qrbox{background:#fff;padding:12px;border-radius:12px}.ans{font-size:36px;color:#7be39d;margin:10px 0}</style></head><body><div class="wrap">
<h1>🎄 JLR Christmas Quiz</h1><div class="row"><div style="flex:1"><div class="ans" id="ans"></div><table id="lb"></table></div><div class="center"><div id="qrbox"></div><div class="small" id="url" style="margin-top:8px"></div></div></div></div>${QR}
<script>
const joinUrl=location.origin+'/';document.getElementById('url').textContent='Scan to join';
try{new QRCode(document.getElementById('qrbox'),{text:joinUrl,width:200,height:200})}catch(e){}
const es=new EventSource('/events?role=board');
es.onmessage=e=>{const v=JSON.parse(e.data);
 document.getElementById('ans').textContent=v.reveal?'Answer: '+v.reveal.letter+' – '+v.reveal.text:(v.phase==='end'?'🏆 Final results':'');
 document.getElementById('lb').innerHTML=v.board.slice(0,10).map(p=>'<tr><td>'+p.rank+'</td><td>'+p.name+'</td><td>'+p.score+'</td></tr>').join('')}
</script></body></html>`;
