import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// vi.mock is hoisted above all declarations, so we must compute the
// temp dir inside the factory using inline requires.
vi.mock("./paths.js", () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-server-test-"));
  return { COMPANION_HOME: dir, __TEST_HOME: dir };
});

// Re-import to get the actual TEST_HOME value for cleanup
import { COMPANION_HOME as TEST_HOME } from "./paths.js";
const SERVERS_SUBDIR = join(TEST_HOME, "servers");

import {
  listServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  redactToken,
  redactServer,
} from "./server-manager.js";

beforeEach(() => {
  // Clean the servers directory between tests for isolation
  if (existsSync(SERVERS_SUBDIR)) {
    rmSync(SERVERS_SUBDIR, { recursive: true, force: true });
  }
});

afterEach(() => {
  // Final cleanup
  if (existsSync(SERVERS_SUBDIR)) {
    rmSync(SERVERS_SUBDIR, { recursive: true, force: true });
  }
});

// ─── Helper ────────────────────────────────────────────────────────────────

function makeFields(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Server",
    url: "http://test.tail.ts.net:3456",
    authToken: "abc123def456",
    sshUser: "seb",
    tailscaleHostname: "test",
    description: "A test server",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// redactToken / redactServer
// ═══════════════════════════════════════════════════════════════════════════

describe("redactToken", () => {
  it("masks long tokens showing first 3 and last 3 chars", () => {
    expect(redactToken("abcdefghijklmnop")).toBe("abc...nop");
  });

  it("returns *** for short tokens", () => {
    expect(redactToken("short")).toBe("***");
    expect(redactToken("12345678")).toBe("***");
  });
});

describe("redactServer", () => {
  it("returns server with masked auth token", () => {
    const server = createServer(makeFields());
    const redacted = redactServer(server);
    expect(redacted.authToken).toBe("abc...456");
    expect(redacted.name).toBe("Test Server");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD operations
// ═══════════════════════════════════════════════════════════════════════════

describe("createServer", () => {
  it("creates a server and returns it with slug, timestamps, and enabled=true", () => {
    const server = createServer(makeFields());
    expect(server.name).toBe("Test Server");
    expect(server.slug).toBe("test-server");
    expect(server.url).toBe("http://test.tail.ts.net:3456");
    expect(server.authToken).toBe("abc123def456");
    expect(server.sshUser).toBe("seb");
    expect(server.tailscaleHostname).toBe("test");
    expect(server.enabled).toBe(true);
    expect(server.createdAt).toBeGreaterThan(0);
    expect(server.updatedAt).toBe(server.createdAt);
  });

  it("strips trailing slashes from URL", () => {
    const server = createServer(makeFields({ url: "http://test.ts.net:3456///" }));
    expect(server.url).toBe("http://test.ts.net:3456");
  });

  it("throws when name is empty", () => {
    expect(() => createServer(makeFields({ name: "" }))).toThrow(/name is required/i);
  });

  it("throws when url is empty", () => {
    expect(() => createServer(makeFields({ url: "" }))).toThrow(/url is required/i);
  });

  it("throws when authToken is empty", () => {
    expect(() => createServer(makeFields({ authToken: "" }))).toThrow(/auth token is required/i);
  });

  it("throws when sshUser is empty", () => {
    expect(() => createServer(makeFields({ sshUser: "" }))).toThrow(/ssh user is required/i);
  });

  it("throws when tailscaleHostname is empty", () => {
    expect(() => createServer(makeFields({ tailscaleHostname: "" }))).toThrow(/tailscale hostname is required/i);
  });

  it("throws when a server with the same slugified name already exists", () => {
    createServer(makeFields());
    expect(() => createServer(makeFields())).toThrow(/already exists/i);
  });

  it("respects enabled=false override", () => {
    const server = createServer(makeFields({ enabled: false }));
    expect(server.enabled).toBe(false);
  });
});

describe("listServers", () => {
  it("returns an empty array when no servers exist", () => {
    expect(listServers()).toEqual([]);
  });

  it("returns all servers sorted by name", () => {
    createServer(makeFields({ name: "Zebra Server" }));
    createServer(makeFields({ name: "Alpha Server" }));

    const list = listServers();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Alpha Server");
    expect(list[1].name).toBe("Zebra Server");
  });
});

describe("getServer", () => {
  it("returns null for non-existent slug", () => {
    expect(getServer("nope")).toBeNull();
  });

  it("returns the server by slug", () => {
    createServer(makeFields());
    const server = getServer("test-server");
    expect(server).not.toBeNull();
    expect(server!.name).toBe("Test Server");
  });
});

describe("updateServer", () => {
  it("returns null when server does not exist", () => {
    expect(updateServer("nope", { name: "X" })).toBeNull();
  });

  it("updates name and re-slugifies", () => {
    createServer(makeFields());
    const updated = updateServer("test-server", { name: "Renamed Server" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed Server");
    expect(updated!.slug).toBe("renamed-server");
    // Old slug should no longer work
    expect(getServer("test-server")).toBeNull();
    // New slug should work
    expect(getServer("renamed-server")).not.toBeNull();
  });

  it("updates url and strips trailing slashes", () => {
    createServer(makeFields());
    const updated = updateServer("test-server", { url: "http://new.ts.net:3456/" });
    expect(updated!.url).toBe("http://new.ts.net:3456");
  });

  it("updates authToken", () => {
    createServer(makeFields());
    const updated = updateServer("test-server", { authToken: "newtoken123" });
    expect(updated!.authToken).toBe("newtoken123");
  });

  it("preserves fields not included in update", () => {
    createServer(makeFields());
    const updated = updateServer("test-server", { description: "Updated desc" });
    expect(updated!.sshUser).toBe("seb");
    expect(updated!.url).toBe("http://test.tail.ts.net:3456");
    expect(updated!.description).toBe("Updated desc");
  });

  it("can disable a server", () => {
    createServer(makeFields());
    const updated = updateServer("test-server", { enabled: false });
    expect(updated!.enabled).toBe(false);
  });

  it("throws on slug collision with a different server", () => {
    createServer(makeFields({ name: "Server A" }));
    createServer(makeFields({ name: "Server B" }));
    expect(() => updateServer("server-b", { name: "Server A" })).toThrow(/already exists/i);
  });
});

describe("deleteServer", () => {
  it("returns false for non-existent server", () => {
    expect(deleteServer("nope")).toBe(false);
  });

  it("deletes an existing server", () => {
    createServer(makeFields());
    expect(deleteServer("test-server")).toBe(true);
    expect(getServer("test-server")).toBeNull();
    expect(listServers()).toHaveLength(0);
  });
});
