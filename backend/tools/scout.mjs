import 'dotenv/config';
const KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const queries = process.argv.slice(2);
for (const q of queries) {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':KEY,
      'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri'},
    body: JSON.stringify({textQuery:q, maxResultCount:20})
  });
  const j = await r.json();
  console.log('\n===== ' + q);
  (j.places||[]).forEach(p=>{
    console.log([p.id, p.displayName?.text, p.nationalPhoneNumber||'NOPHONE', (p.rating||'-')+'★x'+(p.userRatingCount||0), p.websiteUri||'NOSITE', p.formattedAddress, p.businessStatus].join(' | '));
  });
  if(j.error) console.log('ERR', JSON.stringify(j.error).slice(0,200));
}
