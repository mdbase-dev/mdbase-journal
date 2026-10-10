export class ConnectPopupBlocked extends Error {
  constructor() { super("Your browser blocked the sign-in tab."); }
}

// Same app-owned production pattern as Planner/Reader/Writer. Only the genuine
// SDK-validated public Connect URI is passed here; no approval/storage callback.
export function openConnectPopup({ name = "mdbase-connect-authorization", window = globalThis.window } = {}) {
  let popup = null;
  try { popup = window.open("", name, "popup,width=620,height=760"); }
  catch { /* Try a tab. */ }
  if (!popup) {
    try {
      popup = window.open("", "_blank");
      // Literal noopener would lose the blank handle. Detach before navigation.
      if (popup) popup.opener = null;
    } catch {
      try { popup?.close(); } catch { /* Display cleanup only. */ }
      popup = null;
    }
  }
  if (!popup) throw new ConnectPopupBlocked();
  const original = popup;
  let closed = false;
  return {
    get closed() { return closed || original.closed; },
    navigate(uri) {
      if (closed || original.closed) throw new Error("Sign-in window closed.");
      original.location.href = uri;
    },
    close() {
      if (closed) return;
      closed = true;
      try { original.close(); } catch { /* Display cleanup does not undo approval. */ }
    },
  };
}
