import { SDK_ASSET } from "./sdk/pin.mjs";

// Asset intake only. Sign-in, SQL, collection setup and record sessions remain
// shared SDK/factory responsibilities; this function opens no connection.
export function loadNativeSdk({ signal, document = globalThis.document, global = globalThis } = {}) {
  signal?.throwIfAborted();
  if (global.MdbaseSDK) throw new Error("An SDK global already exists; reload before selecting the qualified Journal asset");
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(SDK_ASSET.url, new URL("./sdk/pin.mjs", import.meta.url)).href;
    script.integrity = SDK_ASSET.integrity;
    script.crossOrigin = "anonymous";
    script.async = true;
    const clean = () => {
      script.onload = null;
      script.onerror = null;
      signal?.removeEventListener("abort", abort);
      script.remove();
    };
    const abort = () => { clean(); reject(signal.reason); };
    script.onload = () => {
      clean();
      try {
        signal?.throwIfAborted();
        const sdk = global.MdbaseSDK;
        if (typeof sdk?.Client?.MdbaseClient !== "function" || typeof sdk?.AppHost?.AppWebSignInSession !== "function") {
          throw new Error("Qualified SDK public Client/AppHost exports are unavailable");
        }
        resolve(sdk);
      } catch (error) { reject(error); }
    };
    script.onerror = () => { clean(); reject(new Error("Journal's qualified SDK asset failed to load")); };
    signal?.addEventListener("abort", abort, { once: true });
    document.head.append(script);
  });
}
