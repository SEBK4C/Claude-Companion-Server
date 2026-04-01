/**
 * WsProxyManager — bidirectional WebSocket proxy for lighthouse mode.
 *
 * When a browser connects to /ws/browser/:id on the Lighthouse, this manager
 * opens an upstream WebSocket to the remote Companion Server that owns the
 * session, and pipes messages in both directions:
 *
 *   Browser WS (ServerWebSocket) <──> Upstream WS (WebSocket client) <──> Remote Server
 */

import type { ServerWebSocket } from "bun";
import type { SocketData } from "./ws-bridge-types.js";
import * as lighthouseProxy from "./lighthouse-proxy.js";
import * as serverManager from "./server-manager.js";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 1_000;

interface ProxyPair {
  sessionId: string;
  serverSlug: string;
  browserWs: ServerWebSocket<SocketData>;
  upstream: WebSocket | null;
  /** Queued messages from browser before upstream is connected */
  pendingMessages: (string | Buffer)[];
  reconnectAttempts: number;
  closed: boolean;
}

export class WsProxyManager {
  private pairs = new Map<ServerWebSocket<SocketData>, ProxyPair>();

  /**
   * Called when a browser WebSocket opens in lighthouse mode.
   * Looks up the remote server for this session and opens an upstream connection.
   */
  async handleBrowserOpen(
    browserWs: ServerWebSocket<SocketData>,
    sessionId: string,
  ): Promise<void> {
    const serverSlug = lighthouseProxy.getSessionServer(sessionId);
    if (!serverSlug) {
      console.warn(
        `[ws-proxy] No server mapping for session ${sessionId}, will search`,
      );
      // Try to find it by querying all servers
      const client = await lighthouseProxy.getClientForSession(sessionId);
      if (!client) {
        browserWs.send(
          JSON.stringify({
            type: "error",
            error: "Session not found on any remote server",
          }),
        );
        browserWs.close(4004, "Session not found");
        return;
      }
      // Now getSessionServer should work
      const foundSlug = lighthouseProxy.getSessionServer(sessionId);
      if (!foundSlug) {
        browserWs.close(4004, "Session not found");
        return;
      }
      this.connectUpstream(browserWs, sessionId, foundSlug);
    } else {
      this.connectUpstream(browserWs, sessionId, serverSlug);
    }
  }

  /**
   * Called when a browser sends a message (in lighthouse mode).
   */
  handleBrowserMessage(
    browserWs: ServerWebSocket<SocketData>,
    msg: string | Buffer,
  ): void {
    const pair = this.pairs.get(browserWs);
    if (!pair) return;

    if (pair.upstream && pair.upstream.readyState === WebSocket.OPEN) {
      // Forward directly to upstream
      if (typeof msg === "string") {
        pair.upstream.send(msg);
      } else {
        pair.upstream.send(msg);
      }
    } else {
      // Queue until upstream connects
      pair.pendingMessages.push(msg);
    }
  }

  /**
   * Called when a browser WebSocket closes (in lighthouse mode).
   */
  handleBrowserClose(browserWs: ServerWebSocket<SocketData>): void {
    const pair = this.pairs.get(browserWs);
    if (!pair) return;

    pair.closed = true;
    if (pair.upstream) {
      try {
        pair.upstream.close(1000, "Browser disconnected");
      } catch {
        // upstream may already be closed
      }
    }
    this.pairs.delete(browserWs);
    console.log(
      `[ws-proxy] Browser disconnected from session ${pair.sessionId} (server: ${pair.serverSlug})`,
    );
  }

  /**
   * Open an upstream WebSocket to the remote server and wire bidirectional piping.
   */
  private connectUpstream(
    browserWs: ServerWebSocket<SocketData>,
    sessionId: string,
    serverSlug: string,
  ): void {
    const server = serverManager.getServer(serverSlug);
    if (!server) {
      browserWs.send(
        JSON.stringify({
          type: "error",
          error: `Server "${serverSlug}" not found`,
        }),
      );
      browserWs.close(4004, "Server not found");
      return;
    }

    // Build upstream WS URL: convert http(s) to ws(s)
    const wsUrl = server.url
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    const upstreamUrl = `${wsUrl}/ws/browser/${sessionId}?token=${encodeURIComponent(server.authToken)}`;

    const pair: ProxyPair = {
      sessionId,
      serverSlug,
      browserWs,
      upstream: null,
      pendingMessages: [],
      reconnectAttempts: 0,
      closed: false,
    };
    this.pairs.set(browserWs, pair);

    this.openUpstreamConnection(pair, upstreamUrl);

    console.log(
      `[ws-proxy] Proxying session ${sessionId} to ${server.name} (${serverSlug})`,
    );
  }

  private openUpstreamConnection(pair: ProxyPair, url: string): void {
    const upstream = new WebSocket(url);
    pair.upstream = upstream;

    upstream.onopen = () => {
      console.log(
        `[ws-proxy] Upstream connected for session ${pair.sessionId}`,
      );
      pair.reconnectAttempts = 0;

      // Flush queued messages
      for (const msg of pair.pendingMessages) {
        if (typeof msg === "string") {
          upstream.send(msg);
        } else {
          upstream.send(msg);
        }
      }
      pair.pendingMessages = [];
    };

    upstream.onmessage = (event) => {
      if (pair.closed) return;
      try {
        // Forward upstream message to browser
        if (typeof event.data === "string") {
          pair.browserWs.send(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          pair.browserWs.sendBinary(new Uint8Array(event.data));
        } else if (event.data instanceof Blob) {
          // Convert Blob to ArrayBuffer then send
          event.data.arrayBuffer().then((buf) => {
            if (!pair.closed) {
              pair.browserWs.sendBinary(new Uint8Array(buf));
            }
          });
        }
      } catch {
        // Browser socket may have closed
      }
    };

    upstream.onclose = (event) => {
      if (pair.closed) return;

      console.log(
        `[ws-proxy] Upstream closed for session ${pair.sessionId} (code: ${event.code})`,
      );

      // Attempt reconnection if not a clean close
      if (
        event.code !== 1000 &&
        pair.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
      ) {
        pair.reconnectAttempts++;
        const delay =
          RECONNECT_BASE_DELAY_MS * Math.pow(2, pair.reconnectAttempts - 1);
        console.log(
          `[ws-proxy] Reconnecting upstream for session ${pair.sessionId} (attempt ${pair.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}, delay ${delay}ms)`,
        );

        // Notify browser of reconnection attempt
        try {
          pair.browserWs.send(
            JSON.stringify({
              type: "lighthouse_reconnecting",
              attempt: pair.reconnectAttempts,
              maxAttempts: MAX_RECONNECT_ATTEMPTS,
            }),
          );
        } catch {
          // browser may be closed
        }

        setTimeout(() => {
          if (!pair.closed) {
            this.openUpstreamConnection(pair, url);
          }
        }, delay);
      } else if (!pair.closed) {
        // Give up — notify browser and close
        try {
          pair.browserWs.send(
            JSON.stringify({
              type: "error",
              error: "Remote server disconnected",
            }),
          );
          pair.browserWs.close(
            event.code || 1006,
            "Remote server disconnected",
          );
        } catch {
          // browser may be closed
        }
        pair.closed = true;
        this.pairs.delete(pair.browserWs);
      }
    };

    upstream.onerror = (event) => {
      console.warn(
        `[ws-proxy] Upstream error for session ${pair.sessionId}:`,
        event,
      );
    };
  }

  /** Number of active proxy pairs (for diagnostics). */
  get activeCount(): number {
    return this.pairs.size;
  }
}
