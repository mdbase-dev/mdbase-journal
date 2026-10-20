// The ONE place Journal's per-environment deployment targets live.
//
// LAB is approved and live; keep it untouched. Staging and production are
// PROPOSED ONLY (nx-uiopen's release plan, pending Callum's approval): no
// Pages project (proposed: mdbase-journal) or domain (proposed:
// staging.mdbase-journal.pages.dev / journal.mdbase.dev) is allocated yet.
// They stay `configured: false` and every resolver refuses them until the
// targets are approved and flipped here. Connect origins are the exact
// per-environment values the authenticated SDK release trust must carry;
// the app itself never hardcodes them (CP/log origins come from that trust).
const target=(origin,connectOrigin,project,branch,configured)=>Object.freeze({origin,connectOrigin,project,branch,configured});
export const JOURNAL_DEPLOYMENT_TARGETS=Object.freeze({
  lab:target("https://lab.mdbase-journal-lab.pages.dev","https://connect-lab.mdbase.dev","mdbase-journal-lab","lab",true),
  // PROPOSED, pending Callum's approval — do not deploy.
  staging:target("https://staging.mdbase-journal.pages.dev","https://connect-staging.mdbase.dev","mdbase-journal","staging",false),
  // PROPOSED, pending Callum's approval — do not deploy.
  production:target("https://journal.mdbase.dev","https://connect.mdbase.dev","mdbase-journal","main",false),
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
 * environments refuse; staging/production refuse until configured above. */
export function journalDeploymentFor(environment,targets=JOURNAL_DEPLOYMENT_TARGETS) {
  const name=environment?.MDBASE_ENV;
  if(!Object.hasOwn(targets,name))throw new Error("Journal deployment requires literal MDBASE_ENV of lab, staging or production.");
  const chosen=targets[name];
  if(!chosen.configured)throw new Error(`Journal ${name} deployment target is PROPOSED but not configured/approved yet; refusing to deploy.`);
  return Object.freeze({origin:chosen.origin,connectOrigin:chosen.connectOrigin,project:chosen.project,branch:chosen.branch});
}
export function journalLabDeploymentFor(environment) {
  if(environment.MDBASE_ENV!=="lab")throw new Error("Journal deploy:lab requires literal MDBASE_ENV=lab.");
  return journalDeploymentFor(environment);
}
