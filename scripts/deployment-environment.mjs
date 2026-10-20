// The ONE place Journal's per-environment deployment targets live.
//
// LAB is approved and live; keep it untouched. Callum approved Journal's
// Pages project mdbase-journal and staging/production domains on 2026-10-20.
// `configured` records the approved hosting target, NOT a deployment receipt
// or permission to publish production. Staging may publish only qualified
// environment-bound bytes; production still needs separate Callum GO and a
// protected publisher. Connect origins are the exact per-environment values
// the authenticated SDK release trust must carry; CP/log authority comes
// from that trust, never from these deployment labels.
const target=(origin,connectOrigin,project,branch,configured)=>Object.freeze({origin,connectOrigin,project,branch,configured});
export const JOURNAL_DEPLOYMENT_TARGETS=Object.freeze({
  lab:target("https://lab.mdbase-journal-lab.pages.dev","https://connect-lab.mdbase.dev","mdbase-journal-lab","lab",true),
  staging:target("https://staging.mdbase-journal.pages.dev","https://connect-staging.mdbase.dev","mdbase-journal","staging",true),
  // Pages production channel `main` is NOT the Git source branch or a merge.
  production:target("https://journal.mdbase.dev","https://connect.mdbase.dev","mdbase-journal","main",true),
});
/** Exact installation origins for every named environment, for the manifest builder. */
export function journalInstallationOrigins(targets=JOURNAL_DEPLOYMENT_TARGETS) {
  return Object.freeze({
    lab:Object.freeze({"app-runtime":Object.freeze([targets.lab.origin])}),
    staging:Object.freeze({"app-runtime":Object.freeze([targets.staging.origin])}),
    production:Object.freeze({"app-runtime":Object.freeze([targets.production.origin])}),
  });
}
/** Resolve the deployment target named by literal MDBASE_ENV. Unknown
 * environments and any unconfigured target refuse. Production resolution
 * alone is never deployment approval. */
export function journalDeploymentFor(environment,targets=JOURNAL_DEPLOYMENT_TARGETS) {
  const name=environment?.MDBASE_ENV;
  if(!Object.hasOwn(targets,name))throw new Error("Journal deployment requires literal MDBASE_ENV of lab, staging or production.");
  const chosen=targets[name];
  if(!chosen.configured)throw new Error(`Journal ${name} deployment target is not configured/approved yet; refusing to deploy.`);
  return Object.freeze({origin:chosen.origin,connectOrigin:chosen.connectOrigin,project:chosen.project,branch:chosen.branch});
}
export function journalLabDeploymentFor(environment) {
  if(environment.MDBASE_ENV!=="lab")throw new Error("Journal deploy:lab requires literal MDBASE_ENV=lab.");
  return journalDeploymentFor(environment);
}
