import 'dotenv/config';
const KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const CUTOFF = Date.now() - 90*864e5;
const seen = new Set(); const hits = [];
async function search(q){
  const r = await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':KEY,'X-Goog-FieldMask':'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus'},
    body:JSON.stringify({textQuery:q,maxResultCount:20})});
  return (await r.json()).places||[];
}
async function detail(id){
  const r = await fetch(`https://places.googleapis.com/v1/places/${id}?fields=id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,rating,userRatingCount,businessStatus,googleMapsUri,reviews`,{headers:{'X-Goog-Api-Key':KEY}});
  return r.json();
}
for (const q of process.argv.slice(2)){
  for (const p of await search(q)){
    if(seen.has(p.id)) continue; seen.add(p.id);
    if(p.businessStatus!=='OPERATIONAL') continue;
    if((p.userRatingCount||0) < 5) continue;
    const w = p.websiteUri||'';
    // keep: no site, or weak platform site
    const weak = !w || /facebook|instagram|weebly|wix|squareup|linktr|godaddysites|business\.site|square\.site|carrd|wordpress\.com|blogspot/i.test(w);
    if(!weak) continue;
    const d = await detail(p.id);
    const last = Math.max(0,...(d.reviews||[]).map(v=>Date.parse(v.publishTime)||0));
    if(last >= CUTOFF){
      hits.push({name:d.displayName?.text,id:p.id,phone:d.nationalPhoneNumber,site:w||'NOSITE',
        r:d.rating,n:d.userRatingCount,last:new Date(last).toISOString().slice(0,10),addr:d.formattedAddress});
    }
  }
}
hits.sort((a,b)=>b.last.localeCompare(a.last));
console.log(`\n=== ${hits.length} ACTIVE weak/no-site candidates (review within 90d)\n`);
hits.forEach(h=>console.log([h.last,h.name,h.phone||'NOPHONE',h.r+'★x'+h.n,h.site.slice(0,42),h.addr,h.id].join(' | ')));
