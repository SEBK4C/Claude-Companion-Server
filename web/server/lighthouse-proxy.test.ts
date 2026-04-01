import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Mock server-manager ──────────────────────────────────────────────────
const mockServers = new Map<string, any>();

vi.mock("./server-manager.js", () => ({
  listServers: vi.fn(() => Array.from(mockServers.values())),
  getServer: vi.fn((slug: string) => mockServers.get(slug) ?? null),
}));

import {
  registerSession,
  getSessionServer,
  unregisterSession,
  getClient,
  aggregateSessionListing,
} from "./lighthouse-proxy.js";

function makeServer(slug: string, name: string) {
  return {
    name,
    slug,
    url: `http://${slug}.tail.ts.net:3456`,
    authToken: `token-${slug}`,
    sshUser: "seb",
    tailscaleHostname: slug,
    enabled: true,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  mockServers.clear();
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════
// Session-to-server mapping
// ═══════════════════════════════════════════════════════════════════════════

describe("session-server mapping", () => {
  it("registers and retrieves session-server associations", () => {
    // Validates basic CRUD of the in-memory session-server map
    registerSession("session-1", "pve");
    expect(getSessionServer("session-1")).toBe("pve");

    unregisterSession("session-1");
    expect(getSessionServer("session-1")).toBeUndefined();
  });

  it("returns undefined for unknown sessions", () => {
    expect(getSessionServer("nonexistent")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getClient
// ═══════════════════════════════════════════════════════════════════════════

describe("getClient", () => {
  it("returns a RemoteClient for an enabled server", () => {
    mockServers.set("pve", makeServer("pve", "PVE Server"));
    const client = getClient("pve");
    expect(client).not.toBeNull();
    expect(client!.slug).toBe("pve");
  });

  it("returns null for a disabled server", () => {
    mockServers.set("pve", { ...makeServer("pve", "PVE Server"), enabled: false });
    expect(getClient("pve")).toBeNull();
  });

  it("returns null for a non-existent server", () => {
    expect(getClient("nope")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// aggregateSessionListing
// ═══════════════════════════════════════════════════════════════════════════

describe("aggregateSessionListing", () => {
  it("returns empty when no servers are configured", async () => {
    const result = await aggregateSessionListing();
    expect(result.sessions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("aggregates sessions from multiple servers", async () => {
    // Validates that sessions from multiple servers are merged and enriched
    mockServers.set("pve", makeServer("pve", "PVE Server"));
    mockServers.set("gpu", makeServer("gpu", "GPU Server"));

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("pve")) {
        return new Response(
          JSON.stringify([
            { sessionId: "s1", state: "ready", createdAt: 2000, cwd: "/home" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (urlStr.includes("gpu")) {
        return new Response(
          JSON.stringify([
            { sessionId: "s2", state: "ready", createdAt: 3000, cwd: "/work" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await aggregateSessionListing();

    expect(result.sessions).toHaveLength(2);
    expect(result.errors).toHaveLength(0);

    // Should be sorted by createdAt descending (s2 first)
    const sessions = result.sessions as any[];
    expect(sessions[0].sessionId).toBe("s2");
    expect(sessions[0].serverSlug).toBe("gpu");
    expect(sessions[0].serverName).toBe("GPU Server");
    expect(sessions[1].sessionId).toBe("s1");
    expect(sessions[1].serverSlug).toBe("pve");

    // Should populate the session-server map
    expect(getSessionServer("s1")).toBe("pve");
    expect(getSessionServer("s2")).toBe("gpu");
  });

  it("returns partial results when some servers are unreachable", async () => {
    // Validates graceful degradation: healthy server sessions returned + error for failed one
    mockServers.set("pve", makeServer("pve", "PVE Server"));
    mockServers.set("gpu", makeServer("gpu", "GPU Server"));

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("pve")) {
        return new Response(
          JSON.stringify([{ sessionId: "s1", state: "ready", createdAt: 1000 }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error("ECONNREFUSED");
    });

    // Wait for cache to expire from previous test
    await new Promise((r) => setTimeout(r, 2100));

    const result = await aggregateSessionListing();

    expect(result.sessions).toHaveLength(1);
    expect((result.sessions[0] as any).sessionId).toBe("s1");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("unreachable");
  });
});
