/* Safe, no-charge live billing security probes. Run manually with:
   node tests/billing-public-smoke.mjs
   Sends no credentials and cannot create checkout sessions. */
import assert from 'node:assert/strict';
const BASE='https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1';
const endpoints=['create-subscription-checkout','create-billing-portal'];
async function probe(endpoint,origin){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  return await fetch(BASE+'/'+endpoint,{
   method:'POST',
   headers:{'Content-Type':'application/json',Origin:origin},
   body:JSON.stringify({workspace_id:'00000000-0000-0000-0000-000000000000'}),
   signal:controller.signal
  });
 }finally{clearTimeout(timeout);}
}
for(const endpoint of endpoints){
 const permitted=await probe(endpoint,'https://loose-ends-os.vercel.app');
 assert.ok([401,403].includes(permitted.status),endpoint+' accepted an unauthenticated request or returned an unexpected status: '+permitted.status);
 const foreign=await probe(endpoint,'https://untrusted.example');
 assert.ok([400,401,403].includes(foreign.status),endpoint+' did not reject an untrusted browser origin: '+foreign.status);
 assert.notEqual(foreign.headers.get('access-control-allow-origin'),'https://untrusted.example',endpoint+' exposed CORS to an untrusted origin');
 console.log('PASS '+endpoint+': anonymous and foreign-origin requests rejected');
}
console.log('All no-charge billing HTTP smoke checks passed.');
