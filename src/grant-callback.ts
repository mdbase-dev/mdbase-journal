/** The Private collection consent window returns to Journal's redirect URI
 * with `state` and `code` or `error`. */
export function isAppGrantCallback(url: URL): boolean {
  return url.searchParams.has("state") && (url.searchParams.has("code") || url.searchParams.has("error"));
}
export interface AppGrantCallbackPage {
  readonly document: Document;
  /** The SDK's app-grant entry (loaded only in this window). */
  readonly load: () => Promise<{deliverAppGrantCallback(url: string): void}>;
}
/** In the consent window: hand the result to the waiting Journal tab and
 * leave closing to that original SDK after Native finish and custody ACK,
 * without starting the SDK or writing surface here. Returns false
 * (doing nothing) on any other page. */
export function completeAppGrantCallback(url: URL, page: AppGrantCallbackPage): boolean {
  if (!isAppGrantCallback(url)) return false;
  const main = page.document.querySelector("main");
  const message = page.document.createElement("p");
  message.id = "grant-callback"; message.textContent = "You can close this window.";
  main?.replaceChildren(message);
  void page.load().then(grants => grants.deliverAppGrantCallback(url.href)).catch(() => {});
  return true;
}
