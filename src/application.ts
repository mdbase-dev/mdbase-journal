import {createMdbase, type Mdbase, type MdbaseApplicationDeclaration, type MdbaseApplicationConnection} from "@mdbase-dev/sdk";
import manifest from "../public/.well-known/mdbase-app.json";
export interface JournalApplicationInputs {
  readonly registeredApplicationId: string;
  readonly environment: MdbaseApplicationDeclaration["environment"];
  readonly origin: string;
}
/** Build inputs. The ID defaults to the manifest's own; sign-in self-registration
 * supplies the registered one. The manifest homepage is the build origin. */
export function createJournalApplication(inputs: JournalApplicationInputs): Mdbase {
  if (!inputs.registeredApplicationId.trim() || !["lab", "production"].includes(inputs.environment) || !inputs.origin) throw new Error("Journal needs its registered application build inputs before connecting.");
  return createMdbase({id: inputs.registeredApplicationId, name: manifest.name,
    environment: inputs.environment, origin: inputs.origin, manifest});
}
/** The ready phase's connection, fenced to its own collection and generation.
 * No URL parser, shadow selection or records-client wrapper. */
export function journalConnection(mdbase: Pick<Mdbase, "getSnapshot">): MdbaseApplicationConnection | null {
  const phase = mdbase.getSnapshot().phase;
  if (phase.kind !== "ready") return null;
  const connection = phase.connection;
  if (connection.id !== phase.collectionId || connection.records.collection !== connection.id || connection.records.hello.collection !== connection.id ||
      connection.files !== connection.records.files || !connection.isCurrent()) return null;
  return connection;
}
