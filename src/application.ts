import {MdbaseConnect, type MdbaseApplicationDeclaration, type MdbaseApplicationEntry, type MdbaseApplicationConnection} from "@mdbase-dev/sdk";
import manifest from "../public/.well-known/mdbase-app.json";
export interface JournalApplicationInputs {
  readonly registeredApplicationId: string;
  readonly environment: MdbaseApplicationDeclaration["environment"];
  readonly origin: string;
}
/** Explicit build inputs. The manifest's logical ID and historical deployment
 * origin are never substitutes for a registered native application binding. */
export function createJournalApplication(inputs: JournalApplicationInputs): MdbaseApplicationEntry {
  if (!inputs.registeredApplicationId.trim() || !["lab", "production"].includes(inputs.environment) || !inputs.origin) throw new Error("Journal needs its registered application build inputs before connecting.");
  return new MdbaseConnect({id: inputs.registeredApplicationId, name: manifest.name,
    environment: inputs.environment, origin: inputs.origin, manifest});
}
/** No URL parser, shadow selection or records-client wrapper. SDK snapshot and
 * the original connection jointly fence every data-layer acquisition. */
export function journalConnection(entry: MdbaseApplicationEntry): MdbaseApplicationConnection | null {
  const snapshot = entry.application().getSnapshot();
  const id = snapshot.selectedCollectionId;
  if (!id || snapshot.selection.state !== "usable" || snapshot.selection.usable?.collectionId !== id ||
      snapshot.selection.requested.collectionId !== id || !snapshot.selection.requested.approved || snapshot.status !== "ready" || snapshot.readiness.checking || snapshot.readiness.problem !== null ||
      snapshot.readiness.assessment?.status !== "ready" || snapshot.readiness.assessment.problem !== null) return null;
  const connection = entry.connection(id);
  if (!connection || connection.id !== id || connection.records.collection !== id || connection.records.hello.collection !== id ||
      connection.files !== connection.records.files || !connection.isCurrent()) return null;
  return connection;
}
