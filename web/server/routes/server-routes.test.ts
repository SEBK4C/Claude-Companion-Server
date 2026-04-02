import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock server-manager ──────────────────────────────────────────────────
vi.mock("../server-manager.js", () => ({
  listServers: vi.fn(() => []),
  getServer: vi.fn(() => null),
  createServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(() => false),
  redactServer: vi.fn((s: any) => ({ ...s, authToken: "***" })),
  redactToken: vi.fn(() => "***"),
}));

import { Hono } from "hono";
import * as serverManager from "../server-manager.js";
import { registerServerRoutes } from "./server-routes.js";

// ─── Mock terminal manager ────────────────────────────────────────────────
const mockTerminalManager = {
  spawnSsh: vi.fn(() => "term-1234"),
};

// ─── Test setup ────────────────────────────────────────────────────────────

let app: Hono;

beforeEach(() => {
  vi.clearAllMocks();

  app = new Hono();
  const api = new Hono();
  registerServerRoutes(api, { terminalManager: mockTerminalManager as any });
  app.route("/api", api);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Minimal server fixture matching the CompanionServer shape. */
function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Server",
    slug: "test-server",
    url: "http://test.tail.ts.net:3456",
    authToken: "secret-token-123",
    sshUser: "seb",
    tailscaleHostname: "test",
    description: "A test server",
    enabled: true,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/servers — list all servers (redacted)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/servers", () => {
  it("returns an empty list when no servers exist", async () => {
    vi.mocked(serverManager.listServers).mockReturnValue([]);

    const res = await app.request("/api/servers");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns a list of servers with redacted tokens", async () => {
    const servers = [makeServer(), makeServer({ slug: "second", name: "Second" })];
    vi.mocked(serverManager.listServers).mockReturnValue(servers as any);

    const res = await app.request("/api/servers");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    // redactServer is called for each server
    expect(serverManager.redactServer).toHaveBeenCalledTimes(2);
    expect(json[0].authToken).toBe("***");
  });

  it("returns 500 when listServers throws", async () => {
    vi.mocked(serverManager.listServers).mockImplementation(() => {
      throw new Error("disk failure");
    });

    const res = await app.request("/api/servers");

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("disk failure");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/servers/:slug — get a single server (redacted)
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/servers/:slug", () => {
  it("returns the server with redacted token when it exists", async () => {
    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);

    const res = await app.request("/api/servers/test-server");

    expect(res.status).toBe(200);
    expect(serverManager.getServer).toHaveBeenCalledWith("test-server");
    expect(serverManager.redactServer).toHaveBeenCalledWith(server);
  });

  it("returns 404 when the server does not exist", async () => {
    vi.mocked(serverManager.getServer).mockReturnValue(null);

    const res = await app.request("/api/servers/missing");

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/servers — create a server
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/servers", () => {
  it("creates a new server and returns 201 with redacted token", async () => {
    const created = makeServer();
    vi.mocked(serverManager.createServer).mockReturnValue(created as any);

    const res = await app.request("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Server",
        url: "http://test.tail.ts.net:3456",
        authToken: "secret-token-123",
        sshUser: "seb",
        tailscaleHostname: "test",
      }),
    });

    expect(res.status).toBe(201);
    expect(serverManager.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Server",
        url: "http://test.tail.ts.net:3456",
        authToken: "secret-token-123",
        sshUser: "seb",
        tailscaleHostname: "test",
      }),
    );
    expect(serverManager.redactServer).toHaveBeenCalled();
  });

  it("returns 400 when createServer throws a validation error", async () => {
    vi.mocked(serverManager.createServer).mockImplementation(() => {
      throw new Error("Server name is required");
    });

    const res = await app.request("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Server name is required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/servers/:slug — update a server
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /api/servers/:slug", () => {
  it("updates an existing server and returns redacted result", async () => {
    const updated = makeServer({ name: "Updated" });
    vi.mocked(serverManager.updateServer).mockReturnValue(updated as any);

    const res = await app.request("/api/servers/test-server", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });

    expect(res.status).toBe(200);
    expect(serverManager.updateServer).toHaveBeenCalledWith(
      "test-server",
      expect.objectContaining({ name: "Updated" }),
    );
    expect(serverManager.redactServer).toHaveBeenCalled();
  });

  it("returns 404 when the server does not exist", async () => {
    vi.mocked(serverManager.updateServer).mockReturnValue(null);

    const res = await app.request("/api/servers/missing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it("returns 400 when updateServer throws", async () => {
    vi.mocked(serverManager.updateServer).mockImplementation(() => {
      throw new Error("Invalid slug");
    });

    const res = await app.request("/api/servers/test-server", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid slug");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/servers/:slug — delete a server
// ═══════════════════════════════════════════════════════════════════════════

describe("DELETE /api/servers/:slug", () => {
  it("deletes a server and returns ok", async () => {
    vi.mocked(serverManager.deleteServer).mockReturnValue(true);

    const res = await app.request("/api/servers/test-server", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(serverManager.deleteServer).toHaveBeenCalledWith("test-server");
  });

  it("returns 404 when the server does not exist", async () => {
    vi.mocked(serverManager.deleteServer).mockReturnValue(false);

    const res = await app.request("/api/servers/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/servers/:slug/health — health check proxied to remote
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/servers/:slug/health", () => {
  it("returns 404 when the server does not exist", async () => {
    vi.mocked(serverManager.getServer).mockReturnValue(null);

    const res = await app.request("/api/servers/missing/health");

    expect(res.status).toBe(404);
  });

  it("returns health result when remote server responds", async () => {
    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);

    // Mock global fetch for the health check call
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, uptime: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await app.request("/api/servers/test-server/health");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
    expect(json.remote).toEqual({ ok: true, uptime: 3600 });

    // Verify fetch was called with the correct URL and auth header
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://test.tail.ts.net:3456/health",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret-token-123" },
      }),
    );

    fetchSpy.mockRestore();
  });

  it("returns ok: false when remote server is unreachable", async () => {
    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Connection refused"),
    );

    const res = await app.request("/api/servers/test-server/health");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("Connection refused");

    fetchSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/servers/:slug/terminal — SSH terminal to a remote server
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/servers/:slug/terminal", () => {
  it("returns 404 when the server does not exist", async () => {
    vi.mocked(serverManager.getServer).mockReturnValue(null);

    const res = await app.request("/api/servers/missing/terminal", { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("spawns an SSH terminal and returns the terminal ID", async () => {
    // Validates that the endpoint calls spawnSsh with the correct user and hostname
    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);

    const res = await app.request("/api/servers/test-server/terminal", { method: "POST" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.terminalId).toBe("term-1234");
    expect(mockTerminalManager.spawnSsh).toHaveBeenCalledWith("seb", "test");
  });

  it("returns 500 when spawnSsh throws", async () => {
    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);
    mockTerminalManager.spawnSsh.mockImplementation(() => {
      throw new Error("SSH binary not found");
    });

    const res = await app.request("/api/servers/test-server/terminal", { method: "POST" });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("SSH binary not found");
  });

  it("returns 503 when terminal manager is not available", async () => {
    // Test with a separate app instance that has no terminal manager
    const appNoTerm = new Hono();
    const apiNoTerm = new Hono();
    registerServerRoutes(apiNoTerm); // no terminalManager option
    appNoTerm.route("/api", apiNoTerm);

    const server = makeServer();
    vi.mocked(serverManager.getServer).mockReturnValue(server as any);

    const res = await appNoTerm.request("/api/servers/test-server/terminal", { method: "POST" });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/terminal manager/i);
  });
});
