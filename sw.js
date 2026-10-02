const V='frank-v3';
const FILES=['./','index.html','riots.html','image/monster.avif','image/raft.avif','font/terminal-font.ttf','lang/dialogue.txt','audio/talk.aac','gif/explode.gif',
'image/frank_normal.avif','image/frank_talk1.avif','image/frank_talk2.avif','image/frank_taunt.avif','image/frank_sans.avif',
'image/heart.avif','image/rock.avif','image/fight.avif','image/heal.avif',
'image/text_box.avif','image/choice_box.avif','image/choice_box2.avif','image/slider.avif','audio/anza.aac','audio/BIG_SHOT.aac','audio/BIG_SHOT_loop.aac','audio/BIGSHOT.aac','audio/BIGSHOT_loop.aac'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(FILES.map(f=>c.add(f).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
function store(r,res){if(res&&res.status===200&&new URL(r.url).origin===location.origin){const c=res.clone();caches.open(V).then(ch=>ch.put(r,c)).catch(()=>{});}return res;}
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET')return;
 if(new URL(r.url).pathname.indexOf('/lang/')>=0){e.respondWith(fetch(r).then(res=>store(r,res)).catch(()=>caches.match(r,{ignoreSearch:true})));return;}
 if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>store(r,res)).catch(()=>caches.match(r,{ignoreSearch:true}).then(h=>h||caches.match('./'))));return;}
 e.respondWith(caches.match(r,{ignoreSearch:true}).then(async hit=>{
  if(!hit)return fetch(r).then(res=>store(r,res));
  const rg=r.headers.get('range');if(!rg)return hit;
  const m=/bytes=(\d*)-(\d*)/.exec(rg);if(!m)return hit;
  const b=await hit.arrayBuffer(),s=m[1]?+m[1]:0,en=m[2]?Math.min(+m[2],b.byteLength-1):b.byteLength-1;
  return new Response(b.slice(s,en+1),{status:206,headers:{'Content-Type':hit.headers.get('Content-Type')||'audio/aac','Content-Range':'bytes '+s+'-'+en+'/'+b.byteLength,'Content-Length':String(en-s+1)}});
 }));
});
