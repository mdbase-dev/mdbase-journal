import assert from "node:assert/strict";
import test from "node:test";
import { authorizeNativeSignIn, createNativeSignIn, createSignInPortalUi, mountNativeSignIn, signInCopy, signInPresentation, SignInTabBlocked, unavailableCollection } from "../public/native-signin-ui.mjs";

const snapshot = (patch = {}) => ({ status: "signed_out", signIn: null, collections: [], selectedCollectionId: null, problem: null, ...patch });
const paired = { state: "paired", accountEmail: "journal@example.test" };
const tick = () => new Promise(resolve => setImmediate(resolve));

// UI-only DOM/session stand-ins. No native auth, runtime or collection proof.
function harness(initial = {}) {
  let current = snapshot(initial);
  const listeners = new Set();
  const calls = [];
  const session = {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async start() { calls.push("start"); return current; },
    async renewExpiredPairing() { calls.push("renew"); current = { ...current, problem: null }; return current; },
    async authorize() { calls.push("authorize"); publish({ status: "authorizing" }); return current; },
    async close() { calls.push("close"); publish({ status: "closed", signIn: null }); },
    async forget(id) { calls.push(["forget", id]); return current; },
    setForeground(value) { calls.push(["foreground", value]); },
  };
  const portal = { reserve() { calls.push("reserve"); }, cancel() { calls.push("cancel"); } };
  const publish = patch => { current = { ...current, ...patch }; for (const listener of listeners) listener(); };
  const docListeners = new Map();
  const document = {
    visibilityState: "visible",
    createElement(tag) { return { tag, attributes: {}, events: {}, textContent: "", setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(name, listener) { this.events[name] = listener; } }; },
    addEventListener(name, listener) { docListeners.set(name, listener); },
    removeEventListener(name) { docListeners.delete(name); },
  };
  const container = { ownerDocument: document, children: [], replaceChildren(...children) { this.children = children; } };
  const button = label => container.children.find(child => child.tag === "button" && child.textContent === label);
  return { session, portal, publish, calls, container, button, docListeners };
}

test("canonical actual states and no invented capabilities", () => {
  assert.equal(signInPresentation(snapshot()).message, "Sign in with your mdbase account to sync Journal across your devices.");
  assert.equal(signInPresentation(snapshot({ status: "authorizing" })).message, signInCopy.waiting);
  assert.equal(signInPresentation(snapshot({ status: "unselected", signIn: paired })).message, "Signed in as journal@example.test");
  assert.equal(signInPresentation(snapshot({ status: "blocked", problem: "refused" })).message, signInCopy.interrupted);
  assert.equal(signInPresentation(snapshot({ status: "closed", signIn: paired })).paired, false);
  assert.equal(signInPresentation(snapshot({ signIn: { state: "account_selected", accountEmail: "secret@example.test" } })).identity, null);
  assert.doesNotMatch(JSON.stringify(signInPresentation(snapshot({ status: "unselected", signIn: paired }))), /saved on this device|Set up|reminders/);
});
test("public SDK constructor receives original explicit options and real unavailable callback", () => {
  let received;
  class Session { constructor(options) { received = options; } }
  const options = { signal: new AbortController().signal, release: { fixture: "UI stand-in only" }, appId: "journal" };
  const portal = createSignInPortalUi({ window: {} });
  const binding = createNativeSignIn({ AppHost: { AppWebSignInSession: Session } }, options, portal);
  assert.ok(binding.session instanceof Session);
  assert.equal(received.release, options.release);
  assert.equal(received.signal, options.signal);
  assert.equal(received.openCollection, unavailableCollection);
  assert.equal(received.autoSelect, "never");
});
test("aborted original owner cannot construct a new session", () => {
  const controller = new AbortController(); const reason = new Error("original"); controller.abort(reason);
  assert.throws(() => createNativeSignIn({ AppHost: { AppWebSignInSession() { assert.fail("constructed"); } } }, { signal: controller.signal }), error => error === reason);
});
test("tab is reserved once, detached, and navigated only when the SDK takes it", () => {
  const calls = []; const tab = { opener: {}, location: { replace(uri) { calls.push(uri); } }, close() { calls.push("close"); } };
  const portal = createSignInPortalUi({ window: { open(uri, target) { calls.push([uri, target]); return tab; } } });
  portal.reserve(); portal.reserve(); assert.equal(tab.opener, null); assert.equal(calls.length, 1);
  const capability = portal.open(); capability.navigate("https://mdbase.test/approval"); capability.close();
  assert.deepEqual(calls, [["about:blank", "_blank"], "https://mdbase.test/approval", "close"]);
});
test("blocked tab is distinguishable", () => {
  const portal = createSignInPortalUi({ window: { open() { return null; } } });
  assert.throws(() => portal.reserve(), SignInTabBlocked);
});
test("expiry and initial startup reserve before asynchronous SDK work", async () => {
  const expired = harness({ status: "blocked", problem: "expired" });
  await authorizeNativeSignIn(expired.session, expired.portal);
  assert.deepEqual(expired.calls, ["reserve", "renew", "authorize"]);
  const fresh = harness({ status: "not_started" });
  await authorizeNativeSignIn(fresh.session, fresh.portal);
  assert.deepEqual(fresh.calls, ["reserve", "start", "authorize"]);
});
test("SDK refusal is original and cancels only the unused tab reservation", async () => {
  const h = harness(); const error = new Error("original refusal"); h.session.authorize = async () => { throw error; };
  await assert.rejects(authorizeNativeSignIn(h.session, h.portal), reason => reason === error);
  assert.deepEqual(h.calls, ["reserve", "cancel"]);
});
test("unavailable boundary returns no connection and original abort wins", async () => {
  await assert.rejects(unavailableCollection({ signal: new AbortController().signal }), { message: signInCopy.unavailable });
  const controller = new AbortController(); const reason = { original: true }; controller.abort(reason);
  await assert.rejects(unavailableCollection({ signal: controller.signal }), error => error === reason);
});
test("SDK subscription approval is automatic and local sign-out waits for close", async () => {
  const h = harness(); let signedOut = 0;
  const dispose = mountNativeSignIn(h.container, h, { onSignedOut() { signedOut++; } });
  h.button("Sign in").events.click(); await tick();
  assert.ok(h.button(signInCopy.reopen));
  h.publish({ status: "unselected", signIn: paired });
  assert.ok(h.container.children.some(child => child.textContent === signInCopy.unavailable));
  let finish; h.session.close = () => new Promise(resolve => { finish = resolve; });
  h.button("Sign out").events.click(); assert.equal(signedOut, 0);
  finish(); await tick(); assert.equal(signedOut, 1);
  dispose(); assert.equal(h.docListeners.size, 0);
});
test("forget uses selected ID; disposal does not close borrowed SDK or publish late completion", async () => {
  const h = harness({ status: "unselected", signIn: paired, selectedCollectionId: "selected" });
  let signedOut = 0; const dispose = mountNativeSignIn(h.container, h, { onSignedOut() { signedOut++; } });
  h.button("Forget collection").events.click(); await tick(); assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === "forget" && call[1] === "selected"));
  let finish; h.session.close = () => new Promise(resolve => { finish = resolve; });
  h.button("Sign out").events.click(); dispose(); finish(); await tick();
  assert.equal(signedOut, 0); assert.deepEqual(h.container.children, []);
});
