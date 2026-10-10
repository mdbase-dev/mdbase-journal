import { openConnectPopup } from "./connect-popup.mjs";
import { ConnectPopupBlocked as SignInTabBlocked } from "./connect-popup.mjs";
export { ConnectPopupBlocked as SignInTabBlocked } from "./connect-popup.mjs";

// UI-only binding to the qualified SDK's public AppHost namespace. Callers use
// loadNativeSdk() once and supply its actual result and explicit SDK options.
export const signInCopy = Object.freeze({
  signIn: "Sign in",
  waiting: "Waiting for approval in the mdbase tab…",
  reopen: "Open the mdbase tab again",
  tabBlocked: "Your browser blocked the sign-in tab.",
  openSignIn: "Open sign-in",
  interrupted: "Sign-in was interrupted. Please try again.",
  signOut: "Sign out",
  unavailable: "Opening collections isn't available in this build yet.",
});
// UI-only window ownership identity, not a native actor/record/journal namespace.
let nextPortalKey = 0;
export function createSignInPortalUi({ window = globalThis.window } = {}) {
  const name = `mdbase-journal-connect-${++nextPortalKey}`;
  let active = null;
  const open = () => openConnectPopup({ name, window });
  return {
    reserve() { if (!active || active.closed) active = open(); },
    open() { if (!active || active.closed) active = open(); return active; },
    cancel() { const original = active; active = null; original?.close(); },
  };
}
export async function unavailableCollection({ signal }) {
  signal.throwIfAborted();
  throw new Error(signInCopy.unavailable);
}
export function createNativeSignIn(sdk, options, portal = createSignInPortalUi()) {
  options.signal.throwIfAborted();
  // No inferred release/identity/trust/runtime/defaults or collection factory.
  const session = new sdk.AppHost.AppWebSignInSession({
    ...options, openPortal: () => portal.open(), openCollection: unavailableCollection, autoSelect: "never",
  });
  return { session, portal };
}
export async function authorizeNativeSignIn(session, portal) {
  portal.reserve(); // User gesture, before SDK asset/runtime/renewal awaits.
  try {
    if (session.getSnapshot().status === "not_started") await session.start();
    if (session.getSnapshot().problem === "expired") await session.renewExpiredPairing();
    return await session.authorize();
  } catch (error) { portal.cancel(); throw error; }
}
export function signInPresentation(snapshot, problem = null) {
  const paired = snapshot.status !== "closed" && snapshot.signIn?.state === "paired";
  const email = paired ? snapshot.signIn.accountEmail : null;
  const identity = email ? `Signed in as ${email}` : null;
  const selected = snapshot.collections.find(({ collectionId }) => collectionId === snapshot.selectedCollectionId);
  const waiting = snapshot.status === "authorizing" && problem === null;
  const message = problem === "tab_blocked" ? signInCopy.tabBlocked
    : problem === "interrupted" || snapshot.status === "blocked" ? signInCopy.interrupted
    : waiting ? signInCopy.waiting
    : snapshot.status === "opening" && selected ? `Signed in. Opening ${selected.displayName}…`
    : identity ?? (paired ? signInCopy.unavailable : "Sign in with your mdbase account to sync Journal across your devices.");
  return { message, identity: identity === message ? null : identity, waiting, paired,
    unavailable: paired && message !== signInCopy.unavailable,
    error: problem !== null || snapshot.status === "blocked",
    action: problem === "tab_blocked" ? signInCopy.openSignIn : signInCopy.signIn,
    disabled: ["starting", "opening", "closed"].includes(snapshot.status),
  };
}

/** Borrowed session: caller owns teardown and replacement after confirmed close. */
export function mountNativeSignIn(container, { session, portal }, { onSignedOut, document = container.ownerDocument } = {}) {
  let active = true;
  let working = false;
  let problem = null;
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  const act = async (action) => {
    if (working || !active) return;
    working = true; problem = null; render();
    try { await action(); }
    catch (reason) { if (active) problem = reason instanceof SignInTabBlocked ? "tab_blocked" : "interrupted"; }
    finally { if (active) { working = false; render(); } }
  };
  const button = (text, disabled, action) => {
    const element = node("button", text); element.type = "button"; element.disabled = disabled;
    element.addEventListener("click", () => { void act(action); }); return element;
  };
  const render = () => {
    if (!active) return;
    const snapshot = session.getSnapshot();
    // Already paired does not finish additional consent: authorizing stays open.
    if (["unselected", "opening", "setup_required", "ready", "blocked", "closed"].includes(snapshot.status)) portal.cancel();
    const view = signInPresentation(snapshot, problem);
    const children = [];
    if (view.identity) children.push(node("p", view.identity));
    const status = node("p", view.message);
    status.setAttribute("role", view.error ? "alert" : "status"); status.setAttribute("aria-live", "polite"); children.push(status);
    if (view.unavailable) children.push(node("p", signInCopy.unavailable));
    if (view.waiting) children.push(button(signInCopy.reopen, working, () => authorizeNativeSignIn(session, portal)));
    else if (!view.paired || view.error) children.push(button(view.action, working || view.disabled, () => authorizeNativeSignIn(session, portal)));
    if (view.paired) children.push(button(signInCopy.signOut, working, async () => {
      await session.close(); portal.cancel(); if (active) onSignedOut?.();
    }));
    if (snapshot.selectedCollectionId) {
      const collectionId = snapshot.selectedCollectionId;
      children.push(button("Forget collection", working, () => session.forget(collectionId)));
    }
    container.replaceChildren(...children);
  };
  const foreground = () => {
    if (!active || session.getSnapshot().status === "closed") return;
    try { session.setForeground(document.visibilityState === "visible"); }
    catch { problem = "interrupted"; render(); }
  };
  const unsubscribe = session.subscribe(render);
  document.addEventListener("visibilitychange", foreground);
  try { session.setForeground(document.visibilityState === "visible"); } catch { /* Retired owner. */ }
  render();
  return () => {
    active = false; unsubscribe(); document.removeEventListener("visibilitychange", foreground);
    portal.cancel();
    container.replaceChildren(); // Borrowed SDK session is closed by its owner.
  };
}
