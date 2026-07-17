import 'dotenv/config';
const KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
for (const id of process.argv.slice(2)) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${id}?fields=id,displayName,formattedAddress,nationalPhoneNumber,websiteUri,rating,userRatingCount,businessStatus,googleMapsUri,regularOpeningHours,reviews,editorialSummary,primaryTypeDisplayName`, {headers:{'X-Goog-Api-Key':KEY}});
  const j = await r.json();
  console.log('\n===== '+(j.displayName?.text||id));
  console.log('phone:',j.nationalPhoneNumber,'| site:',j.websiteUri,'|',j.rating+'★x'+j.userRatingCount,'|',j.businessStatus);
  console.log('maps:',j.googleMapsUri,'| placeId:',j.id);
  console.log('type:',j.primaryTypeDisplayName?.text,'| summary:',j.editorialSummary?.text||'-');
  console.log('hours:',(j.regularOpeningHours?.weekdayDescriptions||[]).join(' / '));
  (j.reviews||[]).forEach(v=>console.log('  ['+(v.publishTime||'').slice(0,10)+'] '+v.rating+'★ '+(v.authorAttribution?.displayName)+': '+(v.text?.text||'').replace(/\s+/g,' ').slice(0,240)));
}
