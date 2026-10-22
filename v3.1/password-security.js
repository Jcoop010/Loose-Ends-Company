/* Free signup password screening. The full password and full SHA-1 hash never leave the browser for breach lookup. */
(function(){
'use strict';
async function check(password){
 if(typeof password!=='string'||password.length<12)throw Error('Use at least 12 characters for your password.');
 if(password.length>1024)throw Error('Password is too long.');
 if(!globalThis.crypto||!crypto.subtle)throw Error('Secure browser required for password screening.');
 const bytes=new TextEncoder().encode(password),hash=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes));
 const hex=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase(),prefix=hex.slice(0,5),suffix=hex.slice(5);
 let response;try{response=await fetch('https://api.pwnedpasswords.com/range/'+prefix,{headers:{'Add-Padding':'true'},cache:'no-store',signal:AbortSignal.timeout(8000)});}catch(e){throw Error('Password safety check is unavailable. Please retry before creating your account.');}
 if(!response.ok)throw Error('Password safety check is unavailable. Please retry before creating your account.');
 const data=await response.text();
 if(data.split(/\r?\n/).some(line=>{const parts=line.split(':');return parts[0]?.trim().toUpperCase()===suffix&&Number(parts[1])>0;}))throw Error('This password appears in known breaches. Choose a unique password.');
 return true;
}
window.LEPasswordSecurity={check:check};
})();