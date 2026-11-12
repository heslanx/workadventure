const fs=require("fs");
const norm=p=>p.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9.]+)$/,"$1");
function load(ph){const m=new Map();for(const l of fs.readFileSync(ph+"/play-dist-js-css-wasm-sizes.txt","utf8").trim().split("\n")){const [raw,gz,...r]=l.split(" ");const p=r.join(" ");if(/iframe_api\.js(\.map)?$/.test(p))continue;const k=norm(p);const e=m.get(k)||{raw:0,gz:0,n:0};e.raw+=+raw;e.gz+=+gz;e.n++;m.set(k,e);}return m;}
function all(ph){const t={};let tot=0,n=0;for(const l of fs.readFileSync(ph+"/play-dist-files.txt","utf8").trim().split("\n")){const i=l.indexOf(" ");const s=+l.slice(0,i),p=l.slice(i+1);if(/iframe_api\.js(\.map)?$/.test(p))continue;const ext=(p.match(/\.([a-z0-9]+)$/i)||[,"(none)"])[1];t[ext]=(t[ext]||0)+s;tot+=s;n++;}return {t,tot,n};}
const b=load("base"),h=load("head");
const sum=(m,re)=>{let raw=0,gz=0,n=0;for(const [k,v] of m){if(re.test(k)){raw+=v.raw;gz+=v.gz;n+=v.n;}}return {raw,gz,n};};
const pct=(a,c)=>((c-a)/a*100).toFixed(2)+"%";
console.log("# dist/public/iframe_api.js and its .map are excluded from every head figure. They are written to play/public by \"npm run build-iframe-api\", which this lane ran after the base build, so only the head \"vite build\" copied them into dist. They are not an effect of the Svelte upgrade.");
console.log("## totals by type (files, raw bytes, gzip -9 bytes)");
for(const [name,re] of [["js",/\.js$/],["css",/\.css$/],["wasm",/\.wasm$/]]){const x=sum(b,re),y=sum(h,re);console.log(`${name}: base n=${x.n} raw=${x.raw} gz=${x.gz} | head n=${y.n} raw=${y.raw} gz=${y.gz} | raw ${pct(x.raw,y.raw)} gz ${pct(x.gz,y.gz)}`);}
const ab=all("base"),ah=all("head");
console.log(`all dist files: base n=${ab.n} bytes=${ab.tot} | head n=${ah.n} bytes=${ah.tot} | ${pct(ab.tot,ah.tot)}`);
for(const e of ["map","js","css","wasm"]) console.log(`  .${e}: base ${ab.t[e]} head ${ah.t[e]} delta ${ah.t[e]-ab.t[e]} (${pct(ab.t[e],ah.t[e])})`);
console.log("## names only in base:",[...b.keys()].filter(k=>!h.has(k)).join(", ")||"(none)");
console.log("## names only in head:",[...h.keys()].filter(k=>!b.has(k)).map(k=>`${k} raw=${h.get(k).raw} gz=${h.get(k).gz}`).join(", ")||"(none)");
console.log("## 12 largest head JS/CSS chunks: name | base raw/gz | head raw/gz | delta raw / gz");
const top=[...h.entries()].filter(([k])=>/\.(js|css)$/.test(k)).sort((x,y)=>y[1].raw-x[1].raw).slice(0,12);
for(const [k,v] of top){const x=b.get(k)||{raw:0,gz:0};console.log(`${k.replace("dist/public/","")} | ${x.raw}/${x.gz} | ${v.raw}/${v.gz} | ${v.raw-x.raw} / ${v.gz-x.gz}`);}
console.log("## 8 largest absolute raw deltas");
const d=[...new Set([...b.keys(),...h.keys()])].map(k=>[k,(h.get(k)||{raw:0}).raw-(b.get(k)||{raw:0}).raw,(h.get(k)||{gz:0}).gz-(b.get(k)||{gz:0}).gz]).sort((x,y)=>Math.abs(y[1])-Math.abs(x[1])).slice(0,8);
for(const [k,r,g] of d) console.log(`${k.replace("dist/public/","")} raw ${r>=0?"+":""}${r} gz ${g>=0?"+":""}${g}`);
