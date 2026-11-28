import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import type {MdbaseApplicationConnection, MdbaseSetupPlan} from "@mdbase-dev/sdk";
import {JournalDrafts} from "../src/drafts.js";
import {
  backupFolderFor,
  backupPathFor,
  bundledSetupDefinitions,
  inspectSetupConflicts,
  restoreSetupDefinitions,
  setupConflictGuidanceText,
} from "../src/setup-conflicts.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, memoryStorage} from "./support.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const CONTRACT_TARGET = "_contracts/journal.entry.md";
const HAND_EDITED_CONTRACT = "---\nkind: mdbase.contract\nid: journal.entry\nversion: 0.1.0\n---\n\n# My hand-edited contract notes\n";

async function until<T>(find: () => T | undefined, attempts = 150): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const found = find();
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for setup conflict UI");
}

function dom() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  const menu = window.document.getElementById("menu") as HTMLDialogElement;
  menu.showModal = () => menu.setAttribute("open", "");
  menu.close = () => {menu.removeAttribute("open"); menu.dispatchEvent(new window.Event("close"));};
  return {
    window,
    page,
    menu,
    write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));},
    click(id: string) {window.document.getElementById(id)!.click();},
  };
}

function nonAdoptablePlan(target = CONTRACT_TARGET): MdbaseSetupPlan {
  return {
    status: "conflict",
    canApply: false,
    digest: "sha256:" + "a".repeat(64),
    summary: "Some items can't be set up automatically. Resolve them, then try again.",
    changes: [],
    conflicts: [{
      target,
      message: "The shared format for this app's notes was changed after this app set it up, so it can't be updated automatically.",
    }],
    adoptable: {},
    packs: [{id: "journal.entry", version: "0.1.1", status: "conflict", installedVersion: "0.1.1"}],
    staged: [],
    records: [],
    refusal: {
      code: "setup_conflict",
      message: "Some items can't be set up automatically. Resolve them, then try again.",
    },
  };
}

function needsSetupSnapshot(ready: Awaited<ReturnType<typeof applicationFixture>>["ready"]) {
  const facet = {checking: false, assessment: {status: "setup_required" as const, problem: {code: "setup_conflict"}}, problem: null};
  return {
    ...ready,
    status: "setup_required" as const,
    signIn: {
      requestId: "fixture-request",
      installationId: "fixture-installation",
      deviceId: "fixture-device",
      appId: "dev.mdbase.journal",
      kind: "app-runtime" as const,
      verificationUri: "https://fixture.example/verify",
      state: "paired" as const,
      accountId: "fixture-account",
      collectionIds: [ready.selectedCollectionId!],
      createCollections: false,
      requestedCreateCollections: false,
    },
    readiness: {
      checking: false,
      assessment: {status: "setup_required" as const, problem: {code: "setup_conflict"}},
      problem: null,
      facets: {...ready.readiness.facets, configuration: facet},
    },
  };
}

test("the collection panel footer stays in the scrollable Settings sheet during setup conflict", async () => {
  const f = await applicationFixture();
  const h = dom();
  const {document} = h.window;
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../public/journal.css", import.meta.url), "utf8");
  document.head.append(style);
  f.fixture.controls.setSetupPlan(nonAdoptablePlan());
  f.fixture.controls.publishSnapshot({...needsSetupSnapshot(f.ready), links: {account: "https://fixture.example/account", manageAccess: "https://fixture.example/access"}});
  const view = mountJournal(document, new JournalDrafts(memoryStorage()), f.mdbase);
  try {
    h.click("status-button");
    const panelFooter = await until(() => h.menu.querySelector("#collection-panel footer") ?? undefined);
    assert.equal(h.menu.open, true);
    assert.match(panelFooter.textContent!, /Choose a different collection/);
    assert.equal(panelFooter.querySelector("a")?.textContent, "Manage access");
    assert.equal(h.window.getComputedStyle(document.querySelector("body > footer")!).position, "fixed");
    assert.notEqual(h.window.getComputedStyle(panelFooter).position, "fixed");
    assert.equal(h.window.getComputedStyle(h.menu).overflowY, "auto");
  } finally {view.dispose(); h.window.close(); await f.fixture.close();}
});

test("backupPathFor produces safe non-record, non-resource backup paths", () => {
  const date = new Date("2026-11-27T08:30:15Z");
  const path = backupPathFor(CONTRACT_TARGET, date, "journal-setup-backups", "abc123");
  assert.equal(path, "journal-setup-backups/contracts-journal.entry-20261127-083015-abc123.bak.txt");
  assert.equal(path.endsWith(".md"), false);
  assert.equal(path.startsWith("_contracts/"), false);
  assert.equal(path.startsWith("_types/"), false);
});

test("inspectSetupConflicts ignores adoptable conflicts and classifies non-adoptable conflicts by grant", async () => {
  const f = await applicationFixture();
  try {
    const adoptablePlan: MdbaseSetupPlan = {
      ...nonAdoptablePlan("_types/journal-entry.md"),
      conflicts: [{target: "_types/journal-entry.md", message: "Differs.", adoptable: {digest: "sha256:" + "b".repeat(64)}}],
      adoptable: {"_types/journal-entry.md": "sha256:" + "b".repeat(64)},
    };
    assert.equal(inspectSetupConflicts(adoptablePlan, f.connection.id, f.connection), null);

    const forbiddenPlan: MdbaseSetupPlan = {
      ...nonAdoptablePlan(),
      refusal: {code: "setup_forbidden", message: "No permission"},
    };
    assert.equal(inspectSetupConflicts(forbiddenPlan, f.connection.id, f.connection), null);

    const restorable = inspectSetupConflicts(nonAdoptablePlan(), f.connection.id, f.connection);
    assert(restorable);
    assert.equal(restorable.canRestoreWithBackup, true);
    assert.equal(restorable.unavailableReason, null);
    assert.equal(restorable.backupFolder, "journal-setup-backups");
    assert.deepEqual(restorable.restorable.map(item => item.target), [CONTRACT_TARGET]);

    const noManageConnection: MdbaseApplicationConnection = {
      ...f.connection,
      records: {
        ...f.connection.records,
        hello: {...f.connection.records.hello, grant: {...f.connection.records.hello.grant, capabilities: ["collection.read", "records.create", "records.edit"]}},
      } as unknown as MdbaseApplicationConnection["records"],
    };
    const noManage = inspectSetupConflicts(nonAdoptablePlan(), f.connection.id, noManageConnection);
    assert(noManage);
    assert.equal(noManage.canRestoreWithBackup, false);
    assert.equal(noManage.unavailableReason, "no_permission");
    assert.match(setupConflictGuidanceText(noManage), /doesn't have permission/i);
    assert.match(setupConflictGuidanceText(noManage), /_contracts\/journal\.entry\.md/);

    const readOnlyFilesConnection: MdbaseApplicationConnection = {
      ...f.connection,
      files: {grant: {actions: ["list", "read"], scope: {kind: "collection" as const}}} as unknown as MdbaseApplicationConnection["files"],
    };
    assert.equal(backupFolderFor(readOnlyFilesConnection), null);
    const noBackup = inspectSetupConflicts(nonAdoptablePlan(), f.connection.id, readOnlyFilesConnection);
    assert(noBackup);
    assert.equal(noBackup.canRestoreWithBackup, false);
    assert.equal(noBackup.unavailableReason, "no_backup");
    assert.match(setupConflictGuidanceText(noBackup), /won't overwrite your edits/i);

    const scopedFilesConnection: MdbaseApplicationConnection = {
      ...f.connection,
      files: {grant: {actions: ["list", "read", "add"], scope: {kind: "selected_folders" as const, folders: ["notes"]}}} as unknown as MdbaseApplicationConnection["files"],
    };
    assert.equal(backupFolderFor(scopedFilesConnection), "notes/journal-setup-backups");

    const settingConflict = inspectSetupConflicts(nonAdoptablePlan("record extensions"), f.connection.id, f.connection);
    assert(settingConflict);
    assert.equal(settingConflict.canRestoreWithBackup, false);
    assert.equal(settingConflict.unavailableReason, "manual_only");
    assert.match(setupConflictGuidanceText(settingConflict), /record extensions/);
  } finally {
    f.close();
  }
});

test("restoreSetupDefinitions backs up the hand-edited file, restores Journal's canonical definition, and re-assesses", async () => {
  const f = await applicationFixture();
  const h = dom();
  const canonical = bundledSetupDefinitions().get(CONTRACT_TARGET)!.document;
  try {
    await (await f.records.resources.put(CONTRACT_TARGET, HAND_EDITED_CONTRACT)).confirmed;
    f.fixture.controls.setSetupPlan(nonAdoptablePlan());
    f.fixture.controls.publishSnapshot(needsSetupSnapshot(f.ready));

    let assessCalls = 0;
    const mdbase = {
      ...f.mdbase,
      assess: async () => {
        assessCalls++;
        f.fixture.controls.publishSnapshot(f.ready);
        return f.ready.readiness;
      },
    };
    const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), mdbase);
    try {
      h.click("menu-button");
      const recovery = await until(() => {
        const section = h.window.document.getElementById("setup-conflict-recovery")!;
        return !section.hidden ? section : undefined;
      });
      assert.match(h.window.document.getElementById("status")!.textContent!, /Resolve Journal setup conflict in Writing/);
      assert.match(recovery.textContent!, /_contracts\/journal\.entry\.md/);
      assert.match(recovery.textContent!, /To resolve by hand/);

      const restoreButton = h.window.document.getElementById("restore-setup-definition") as HTMLButtonElement;
      const switchButton = h.window.document.getElementById("switch-setup-collection") as HTMLButtonElement;
      const cancelButton = h.window.document.getElementById("cancel-setup-conflict") as HTMLButtonElement;
      assert.equal(restoreButton.hidden, false);
      assert.equal(switchButton.hidden, false);
      assert.equal(cancelButton.hidden, false);

      restoreButton.click();

      const notice = await until(() => {
        const element = h.window.document.getElementById("setup-conflict-notice")!;
        return !element.hidden && element.textContent?.includes("Restored") ? element.textContent : undefined;
      });
      assert.equal(assessCalls, 1);
      assert.equal(h.window.document.getElementById("setup-conflict-recovery")!.hidden, true);
      assert.match(notice, /Restored _contracts\/journal\.entry\.md/);
      const backupMatch = notice.match(/journal-setup-backups\/[^\s]+\.bak\.txt/);
      assert(backupMatch, `Expected backup path in confirmation notice: ${notice}`);

      const restoredResource = await f.records.resources.get(CONTRACT_TARGET);
      assert.equal(restoredResource.text, canonical);

      const backupBytes = await f.records.files.download({path: backupMatch[0]!});
      assert.equal(new TextDecoder().decode(backupBytes), HAND_EDITED_CONTRACT);
    } finally {
      view.dispose();
    }
  } finally {
    h.window.close();
    f.close();
  }
});

test("restoreSetupDefinitions never overwrites the hand-edited file if saving its backup fails", async () => {
  const f = await applicationFixture();
  const h = dom();
  try {
    await (await f.records.resources.put(CONTRACT_TARGET, HAND_EDITED_CONTRACT)).confirmed;
    f.fixture.controls.setSetupPlan(nonAdoptablePlan());
    f.fixture.controls.publishSnapshot(needsSetupSnapshot(f.ready));

    const upload = mock.method(f.records.files, "upload", async () => {throw new Error("storage full");});
    const put = mock.method(f.records.resources, "put");
    const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.mdbase);
    try {
      await until(() => !h.window.document.getElementById("setup-conflict-recovery")!.hidden || undefined);
      h.click("restore-setup-definition");
      const feedback = await until(() => {
        const element = h.window.document.getElementById("setup-conflict-feedback")!;
        return !element.hidden && element.textContent ? element.textContent : undefined;
      });
      assert.match(feedback, /Could not save a backup copy/);
      assert.match(feedback, /left your file unchanged/);
      assert.equal(put.mock.callCount(), 0);
      assert.equal((await f.records.resources.get(CONTRACT_TARGET)).text, HAND_EDITED_CONTRACT);
    } finally {
      upload.mock.restore();
      put.mock.restore();
      view.dispose();
    }
  } finally {
    h.window.close();
    f.close();
  }
});

test("restoreSetupDefinitions refuses blind overwrite when the definition changes concurrently", async () => {
  const f = await applicationFixture();
  try {
    await (await f.records.resources.put(CONTRACT_TARGET, HAND_EDITED_CONTRACT)).confirmed;
    const originalUpload = f.records.files.upload.bind(f.records.files);
    const concurrentContent = `${HAND_EDITED_CONTRACT}\nAdded concurrently.\n`;
    let raced = false;
    const upload = mock.method(f.records.files, "upload", async (...args: Parameters<typeof originalUpload>) => {
      const write = await originalUpload(...args);
      if (!raced) {
        raced = true;
        await (await f.records.resources.put(CONTRACT_TARGET, concurrentContent)).confirmed;
      }
      return write;
    });
    try {
      await assert.rejects(
        restoreSetupDefinitions(f.mdbase, f.connection.id, [CONTRACT_TARGET], {
          now: () => new Date("2026-11-27T08:30:15Z"),
          suffix: () => "race01",
        }),
        /changed while restoring.*backup copy was saved to journal-setup-backups\/contracts-journal\.entry-20261127-083015-race01\.bak\.txt/,
      );
      assert.equal((await f.records.resources.get(CONTRACT_TARGET)).text, concurrentContent);
    } finally {
      upload.mock.restore();
    }
  } finally {
    f.close();
  }
});

test("switch collection and cancel actions work without losing local writing", async () => {
  const f = await applicationFixture();
  const h = dom();
  const drafts = new JournalDrafts(memoryStorage());
  try {
    f.fixture.controls.setSetupPlan(nonAdoptablePlan());
    f.fixture.controls.publishSnapshot(needsSetupSnapshot(f.ready));

    const view = mountJournal(h.window.document, drafts, f.mdbase);
    try {
      h.write("Notes written while setup is blocked");
      const original = view.currentDraft();
      h.click("menu-button");
      assert.equal(h.menu.open, true);

      await until(() => !h.window.document.getElementById("setup-conflict-recovery")!.hidden || undefined);
      h.click("cancel-setup-conflict");
      assert.equal(h.menu.open, false);
      assert.equal(view.currentDraft().body, "Notes written while setup is blocked");

      h.click("menu-button");
      h.click("switch-setup-collection");
      await until(() => f.fixture.controls.observedActions().some(call => call.action === "chooseAnother") || undefined);
      // Switching collections starts a fresh page while preserving the original note pinned to its collection.
      assert.equal(drafts.get(original.id)?.body, "Notes written while setup is blocked");
      assert.equal(drafts.get(original.id)?.targetCollectionId, f.connection.id);
    } finally {
      view.dispose();
    }
  } finally {
    h.window.close();
    f.close();
  }
});

test("without definitions.manage, restore is hidden while plain manual guidance, switch, and cancel remain", async () => {
  const f = await applicationFixture();
  const h = dom();
  try {
    f.fixture.controls.setSetupPlan(nonAdoptablePlan());
    f.fixture.controls.publishSnapshot(needsSetupSnapshot(f.ready));
    const readOnlyConnection: MdbaseApplicationConnection = {
      ...f.connection,
      records: {
        ...f.connection.records,
        hello: {...f.connection.records.hello, grant: {...f.connection.records.hello.grant, capabilities: ["collection.read", "records.create", "records.edit"]}},
      } as unknown as MdbaseApplicationConnection["records"],
    };
    const mdbase = {
      ...f.mdbase,
      connection: (id: string) => id === f.connection.id ? readOnlyConnection : null,
    };
    const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), mdbase);
    try {
      await until(() => !h.window.document.getElementById("setup-conflict-recovery")!.hidden || undefined);
      assert.equal(h.window.document.getElementById("restore-setup-definition")!.hidden, true);
      assert.equal(h.window.document.getElementById("switch-setup-collection")!.hidden, false);
      assert.equal(h.window.document.getElementById("cancel-setup-conflict")!.hidden, false);
      assert.match(h.window.document.getElementById("setup-conflict-guidance")!.textContent!, /doesn't have permission/);
      assert.match(h.window.document.getElementById("setup-conflict-guidance")!.textContent!, /To resolve by hand/);
    } finally {
      view.dispose();
    }
  } finally {
    h.window.close();
    f.close();
  }
});
