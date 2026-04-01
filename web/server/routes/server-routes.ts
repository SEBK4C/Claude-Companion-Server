import type { Hono } from "hono";
import * as serverManager from "../server-manager.js";

export function registerServerRoutes(api: Hono): void {
  // ─── List all servers (redacted) ──────────────────────────────────────────
  api.get("/servers", (c) => {
    try {
      const servers = serverManager.listServers().map(serverManager.redactServer);
      return c.json(servers);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // ─── Get a single server (redacted) ──────────────────────────────────────
  api.get("/servers/:slug", (c) => {
    const server = serverManager.getServer(c.req.param("slug"));
    if (!server) return c.json({ error: "Server not found" }, 404);
    return c.json(serverManager.redactServer(server));
  });

  // ─── Create a server ─────────────────────────────────────────────────────
  api.post("/servers", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const server = serverManager.createServer({
        name: body.name,
        url: body.url,
        authToken: body.authToken,
        sshUser: body.sshUser,
        tailscaleHostname: body.tailscaleHostname,
        description: body.description,
        enabled: body.enabled,
      });
      return c.json(serverManager.redactServer(server), 201);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  // ─── Update a server ─────────────────────────────────────────────────────
  api.put("/servers/:slug", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => ({}));
    try {
      const server = serverManager.updateServer(slug, {
        name: body.name,
        url: body.url,
        authToken: body.authToken,
        sshUser: body.sshUser,
        tailscaleHostname: body.tailscaleHostname,
        description: body.description,
        enabled: body.enabled,
      });
      if (!server) return c.json({ error: "Server not found" }, 404);
      return c.json(serverManager.redactServer(server));
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  // ─── Delete a server ─────────────────────────────────────────────────────
  api.delete("/servers/:slug", (c) => {
    try {
      const deleted = serverManager.deleteServer(c.req.param("slug"));
      if (!deleted) return c.json({ error: "Server not found" }, 404);
      return c.json({ ok: true });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  // ─── Health check a remote server ────────────────────────────────────────
  api.get("/servers/:slug/health", async (c) => {
    const server = serverManager.getServer(c.req.param("slug"));
    if (!server) return c.json({ error: "Server not found" }, 404);

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${server.url}/health`, {
        headers: { Authorization: `Bearer ${server.authToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return c.json({
          ok: false,
          latencyMs,
          error: `Remote returned ${res.status}`,
        });
      }

      const data = await res.json().catch(() => ({}));
      return c.json({ ok: true, latencyMs, remote: data });
    } catch (e: unknown) {
      return c.json({
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Connection failed",
      });
    }
  });

  // ─── Test connectivity to a remote server ────────────────────────────────
  api.post("/servers/:slug/test", async (c) => {
    const server = serverManager.getServer(c.req.param("slug"));
    if (!server) return c.json({ error: "Server not found" }, 404);

    const results: {
      http: { ok: boolean; latencyMs: number; error?: string };
      auth: { ok: boolean; error?: string };
    } = {
      http: { ok: false, latencyMs: 0 },
      auth: { ok: false },
    };

    // Test HTTP connectivity
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${server.url}/health`, {
        headers: { Authorization: `Bearer ${server.authToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      results.http = { ok: true, latencyMs: Date.now() - start };

      // Test auth by calling a protected endpoint
      if (res.ok) {
        results.auth = { ok: true };
      } else if (res.status === 401 || res.status === 403) {
        results.auth = {
          ok: false,
          error: "Authentication failed — check the auth token",
        };
      } else {
        results.auth = { ok: true }; // non-auth error, auth may be fine
      }
    } catch (e: unknown) {
      results.http = {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Connection failed",
      };
    }

    const allOk = results.http.ok && results.auth.ok;
    return c.json({ ok: allOk, ...results });
  });
}
