import { describe, it, expect } from "vitest";
import { WsProxyManager } from "./ws-proxy.js";

describe("WsProxyManager", () => {
  it("initializes with zero active connections", () => {
    // Validates the proxy manager starts clean
    const manager = new WsProxyManager();
    expect(manager.activeCount).toBe(0);
  });

  it("exposes activeCount for diagnostics", () => {
    // Validates the activeCount getter exists and returns a number
    const manager = new WsProxyManager();
    expect(typeof manager.activeCount).toBe("number");
  });

  // Note: Full integration tests for WebSocket proxying require a running
  // Bun server with real WebSocket connections. These are better tested
  // via end-to-end tests. The unit tests here verify the manager's API surface.
  //
  // handleBrowserOpen, handleBrowserMessage, handleBrowserClose require
  // ServerWebSocket<SocketData> instances which can only be obtained from
  // Bun.serve's upgrade flow.
});
