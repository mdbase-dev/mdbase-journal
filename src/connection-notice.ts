import type {MdbaseSnapshot} from "@mdbase-dev/sdk";
/**
 * What the open collection's connection needs to say, from the SDK's own status
 * (the same rule and words as the other mdbase apps): nothing while connected and live.
 * saved_on_device: changes are kept on this device until they can sync; offline: no
 * network; reconnecting: the sync service cannot be reached, or other devices' changes
 * have stopped arriving live.
 */
export type ConnectionNotice = "offline" | "reconnecting" | "saved_on_device";
export const connectionNoticeLabels: Record<ConnectionNotice, string> = {
  offline: "Offline",
  reconnecting: "Reconnecting",
  saved_on_device: "Saved on this device; waiting for sync",
};
type Observed = Partial<Pick<MdbaseSnapshot, "phase" | "sync" | "writes" | "transport" | "live">>;
export function connectionNotice(snapshot: Observed | null | undefined, online = true): ConnectionNotice | null {
  if (!snapshot || (snapshot.phase && snapshot.phase.kind !== "ready")) return null;
  if (snapshot.writes?.saveState === "saved_on_device") return "saved_on_device";
  const health = snapshot.sync?.health ?? snapshot.transport?.kind ?? null;
  if (!online || health === "offline") return "offline";
  if (health === "unreachable" || health === "server_busy" || health === "rate_limited" ||
    snapshot.sync?.kind === "offline" || (snapshot.sync?.live ?? snapshot.live) === false) return "reconnecting";
  return null;
}
