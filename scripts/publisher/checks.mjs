export function assertInventoryCoverage(inventory,sdkTrust) {
 if(!inventory.length||new Set(inventory.map(r=>r.path)).size!==inventory.length)throw Error('Journal publisher refusal: invalid full inventory');
 for(const r of inventory)if(!r.path||r.path.split('/').some(p=>!p||p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<0||r.bytes>25*1024*1024)throw Error('Journal publisher refusal: invalid Pages asset');
 for(const path of ['index.html','404.html','.well-known/mdbase-app.json','sdk/application/sdk.js','mdbase-shell-sw.js','mdbase-shell-runtime.js','mdbase-shell-register.js','_headers','_redirects'])if(!inventory.some(r=>r.path===path))throw Error('Journal publisher refusal: missing required static publication asset');
 if(sdkTrust) {
  for(const [name,pin] of Object.entries(sdkTrust.nativeAssets))if(!inventory.some(r=>r.path==='sdk/native/'+name&&r.sha256===pin.sha256&&r.bytes===pin.bytes))throw Error('Journal publisher refusal: missing exact native SDK original');
  if(!inventory.some(r=>r.path==='sdk/application/packaged-trust.js'&&r.sha256===sdkTrust.trustModuleSha256))throw Error('Journal publisher refusal: missing exact trust module');
 }
}
export function assertBuiltTarget({target,manifest}) {
 const origin={staging:'https://staging.mdbase-journal.pages.dev',production:'https://journal.mdbase.dev'}[target];
 if(!origin||manifest.id!=='dev.mdbase.journal'||manifest.homepage!==origin+'/'||manifest.redirect_uris?.length!==1||manifest.redirect_uris[0]!==origin+'/auth/mdbase/callback'||manifest.installation_origins?.[target]?.['app-runtime']?.length!==1||manifest.installation_origins[target]['app-runtime'][0]!==origin)throw Error('Journal publisher refusal: invalid exact Journal target manifest');
}
