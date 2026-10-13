import assert from "node:assert/strict";
import {test} from "node:test";
import {connectionNotice} from "../src/connection-notice.js";
const ready = {phase: {kind: "ready"}} as const;
const sync = (health: string | null, live: boolean | null = true) => ({kind: "synced", health, live}) as never;
void test("status never reads as saving or saved while offline, reconnecting or holding changes", () => {
  assert.equal(connectionNotice({...ready, sync: sync(null)} as never), null);
  assert.equal(connectionNotice({...ready, sync: sync(null)} as never, false), "offline");
  assert.equal(connectionNotice({...ready, sync: sync("unreachable")} as never), "reconnecting");
  assert.equal(connectionNotice({...ready, sync: sync(null, false)} as never), "reconnecting");
  assert.equal(connectionNotice({...ready, sync: sync("offline"), writes: {saveState: "saved_on_device"}} as never), "saved_on_device");
  assert.equal(connectionNotice({phase: {kind: "opening"}, live: false} as never), null);
});
