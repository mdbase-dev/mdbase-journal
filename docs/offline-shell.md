# Offline app shell

The production build uses `@mdbase-dev/sdk/offline-shell/build` to precache the
public app shell, scripts, lazy chunks, fonts and packaged WASM as one release.
A previously opened app can reload its shell without connectivity. This does
not grant collection access or make uncached files and remote services available
offline; collection recovery and sync remain the SDK's responsibility.

A page and its assets always come from one release. A newly deployed release
waits until the app next starts, then activates and reloads that tab once; other
open tabs keep their release until they leave. A first install never reloads. An
incomplete deployment does not replace the last successfully cached release. Shell caching never stores authentication or
collection API responses.
