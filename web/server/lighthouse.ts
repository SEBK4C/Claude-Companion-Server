/**
 * Lighthouse mode — when COMPANION_LIGHTHOUSE=1, the server acts as a pure
 * proxy that forwards session operations to remote Companion Server workers.
 * No local CLI processes are spawned.
 */

/** Whether this instance is running in lighthouse (proxy-only) mode. */
export const isLighthouseMode =
  process.env.COMPANION_LIGHTHOUSE === "1" ||
  process.env.COMPANION_LIGHTHOUSE === "true";
