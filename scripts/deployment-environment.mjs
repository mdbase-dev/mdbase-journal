export function journalLabDeploymentFor(environment) {
  if(environment.MDBASE_ENV!=="lab")throw new Error("Journal deploy:lab requires literal MDBASE_ENV=lab.");
  return Object.freeze({origin:"https://lab.mdbase-journal-lab.pages.dev",connectOrigin:"https://connect-lab.mdbase.dev",project:"mdbase-journal-lab",branch:"lab"});
}
