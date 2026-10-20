import assert from "node:assert/strict";
import {test} from "node:test";
import {createJournalApplication, journalApplicationDeclaration, type JournalApplicationInputs} from "../src/application.js";
test("native declaration selects lab, staging and production from explicit build inputs", () => {
  for (const environment of ["lab", "staging", "production"] as const) {
    const declaration = journalApplicationDeclaration({registeredApplicationId: "build-fixture-only", environment, origin: "https://journal.fixture"});
    assert.equal(declaration.environment, environment);
    assert.equal(declaration.id, "build-fixture-only");
    assert.equal(declaration.origin, "https://journal.fixture");
  }
});
test("native declaration refuses unknown environments and missing inputs before any SDK owner starts", () => {
  const unknown = "qa" as JournalApplicationInputs["environment"];
  assert.throws(() => journalApplicationDeclaration({registeredApplicationId: "x", environment: unknown, origin: "https://journal.fixture"}), /registered application/);
  assert.throws(() => createJournalApplication({registeredApplicationId: "x", environment: unknown, origin: "https://journal.fixture"}), /registered application/);
  assert.throws(() => createJournalApplication({registeredApplicationId: " ", environment: "staging", origin: "https://journal.fixture"}), /registered application/);
  assert.throws(() => createJournalApplication({registeredApplicationId: "x", environment: "production", origin: ""}), /registered application/);
});
