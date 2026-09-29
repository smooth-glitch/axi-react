import { useEffect, useRef } from "react";
import { sandeshSocket } from "../../../services/sandeshSocket.js";

// The server pushes small "something changed" events when structures, options or submissions change
// (docs/SANDESH_API.md, "Live change events"). Screens re-read what they show when one arrives, so a change made
// anywhere -- the studio, the admin console, another user -- appears everywhere without a refresh.
const LIVE = new Set(["tstructs_changed", "options_changed", "submissions_changed"]);

/**
 * useLiveChanges(handler): handler({ event, ...data }) for each push, and { event: "resync" } after a reconnect
 * (events sent while offline are lost, so re-read). Bursts are coalesced to one call per ~150 ms.
 */
export function useLiveChanges(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let timer = null;
    let pending = [];
    const off = sandeshSocket.subscribe((ev) => {
      let change = null;
      if (ev?.type === "sd_event" && LIVE.has(ev.event)) change = { event: ev.event, ...(ev.data || {}) };
      else if (ev?.type === "status_change" && ev.status === "connected") change = { event: "resync" };
      if (!change) return;
      pending.push(change);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = pending;
        pending = [];
        batch.forEach((c) => ref.current?.(c));
      }, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
