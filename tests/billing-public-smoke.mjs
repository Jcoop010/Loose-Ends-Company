/* Read-only smoke checks for public billing endpoints.
   No credentials, Stripe session creation, or charges. Run: node tests/billing-public-smoke.mjs */
import assert from 'node:assert/strict';
const BASE='https://uehfvpnnoitgybsmdgef.supabase.co/functions/v1';
const endpoints=['create-subscription-checkout','create-billing-portal'];
for(const endpoint of endpoints){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const res=await fetch(BASE+'/'+endpoint,{
   method:'POST',headers:{'Content-Type':'application/json','Origin':'https://loose-ends-os.vercel.app'},
   body:JSON.stringify({workspace_id:'00000000-0000-0000-0000-000000000000'}),
   signal:controller.signal
  });
  assert.ok([401,403].includes(res.status),endpoint+' should deny unauthenticated requests, got '+res.status);
  console.log('PASS '+endpoint+': unauthenticated request rejected ('+res.status+')');
 }finally{clearTimeout(timeout);}
}
console.log('Read-only public billing smoke checks passed.');
