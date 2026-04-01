/**
 * LighthouseProxy — manages session-to-server mapping and proxies REST
 * requests to remote Companion Server workers in lighthouse mode.
 */

import { RemoteClient, RemoteError } from "./remote-client.js";
import * as serverManager from "./server-manager.js";
import type { CompanionServer } from "./server-manager.js";

// ─── Session → Server mapping ──────────────────────────────────────────────

/** In-memory map of sessionId → serverSlug. Rebuilt from listing polls. */
const sessionServerMap = new Map<string, string>();

/** Cache for aggregated session listing (avoid hammering remotes on rapid polls). */
let listingCache: { data: unknown[]; errors: ListingError[]; ts: number } | null = null;
const LISTING_CACHE_TTL_MS = 2_000;

interface ListingError {
  serverSlug: string;
  serverName: string;
  error: string;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Record that a session was created on a specific server.
 * Called after successful proxied session creation.
 */
export function registerSession(sessionId: string, serverSlug: string): void {
  sessionServerMap.set(sessionId, serverSlug);
}

/**
 * Look up which server owns a session.
 * Returns the serverSlug, or undefined if unknown.
 */
export function getSessionServer(sessionId: string): string | undefined {
  return sessionServerMap.get(sessionId);
}

/**
 * Remove a session from the mapping (e.g. after deletion).
 */
export function unregisterSession(sessionId: string): void {
  sessionServerMap.delete(sessionId);
}

/**
 * Create a RemoteClient for the given server slug.
 * Returns null if the server doesn't exist or is disabled.
 */
export function getClient(slug: string): RemoteClient | null {
  const server = serverManager.getServer(slug);
  if (!server || !server.enabled) return null;
  return new RemoteClient(server);
}

/**
 * Create a RemoteClient for whichever server owns the given session.
 * Falls back to querying all servers if the mapping is stale.
 */
export async function getClientForSession(
  sessionId: string,
): Promise<RemoteClient | null> {
  // Fast path: check in-memory map
  const slug = sessionServerMap.get(sessionId);
  if (slug) {
    const client = getClient(slug);
    if (client) return client;
  }

  // Slow path: search all enabled servers
  const servers = serverManager.listServers().filter((s) => s.enabled);
  for (const server of servers) {
    const client = new RemoteClient(server);
    try {
      // Try to fetch the session from this server
      await client.get(`/api/sessions/${sessionId}`, 5_000);
      // Found it — update the map
      sessionServerMap.set(sessionId, server.slug);
      return client;
    } catch {
      // Not on this server, try next
    }
  }

  return null;
}

// ─── Aggregated session listing ────────────────────────────────────────────

interface AggregatedListing {
  sessions: unknown[];
  errors: ListingError[];
}

/**
 * Fetch sessions from all enabled remote servers in parallel.
 * Injects serverSlug and serverName into each session.
 * Returns partial results if some servers are unreachable.
 */
export async function aggregateSessionListing(): Promise<AggregatedListing> {
  // Return cached result if fresh
  if (listingCache && Date.now() - listingCache.ts < LISTING_CACHE_TTL_MS) {
    return { sessions: listingCache.data, errors: listingCache.errors };
  }

  const servers = serverManager.listServers().filter((s) => s.enabled);
  if (servers.length === 0) {
    return { sessions: [], errors: [] };
  }

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const client = new RemoteClient(server);
      const sessions = await client.get<unknown[]>("/api/sessions", 5_000);
      return { server, sessions };
    }),
  );

  const allSessions: unknown[] = [];
  const errors: ListingError[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { server, sessions } = result.value;
      for (const session of sessions) {
        const enriched = {
          ...(session as Record<string, unknown>),
          serverSlug: server.slug,
          serverName: server.name,
        };
        // Update the session-server map
        const sid = (session as Record<string, unknown>).sessionId;
        if (typeof sid === "string") {
          sessionServerMap.set(sid, server.slug);
        }
        allSessions.push(enriched);
      }
    } else {
      // Find which server failed from the error
      const err = result.reason;
      const serverSlug =
        err instanceof RemoteError ? err.serverSlug : undefined;
      const server = servers.find(
        (s) => s.slug === serverSlug,
      );
      errors.push({
        serverSlug: server?.slug ?? "unknown",
        serverName: server?.name ?? "Unknown Server",
        error:
          err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sort by createdAt descending
  allSessions.sort((a, b) => {
    const aTime = (a as Record<string, unknown>).createdAt;
    const bTime = (b as Record<string, unknown>).createdAt;
    return (typeof bTime === "number" ? bTime : 0) -
      (typeof aTime === "number" ? aTime : 0);
  });

  // Cache the result
  listingCache = { data: allSessions, errors, ts: Date.now() };

  return { sessions: allSessions, errors };
}

// ─── Proxy a raw request to a remote server ────────────────────────────────

/**
 * Forward a Hono request to the remote server that owns the given session.
 * Returns the Response from the remote server, or an error Response.
 */
export async function proxySessionRequest(
  sessionId: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const client = await getClientForSession(sessionId);
  if (!client) {
    return new Response(
      JSON.stringify({ error: "Session not found on any remote server" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    return await client.forward(path, { ...init, timeoutMs: 15_000 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Remote server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Forward a session creation request (SSE stream) to a remote server.
 * Returns the raw Response with the SSE stream from the remote.
 */
export async function proxyCreateSessionStream(
  serverSlug: string,
  body: unknown,
): Promise<Response> {
  const client = getClient(serverSlug);
  if (!client) {
    return new Response(
      JSON.stringify({ error: `Server "${serverSlug}" not found or disabled` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const remoteRes = await client.forward("/api/sessions/create-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 120_000, // session creation can be slow
    });

    if (!remoteRes.ok) {
      const text = await remoteRes.text().catch(() => "Unknown error");
      return new Response(
        JSON.stringify({ error: `Remote server returned ${remoteRes.status}: ${text}` }),
        { status: remoteRes.status, headers: { "Content-Type": "application/json" } },
      );
    }

    // Return the SSE stream directly — the browser will read it as SSE
    return new Response(remoteRes.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Remote server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Forward a non-streaming session creation to a remote server.
 */
export async function proxyCreateSession(
  serverSlug: string,
  body: unknown,
): Promise<Response> {
  const client = getClient(serverSlug);
  if (!client) {
    return new Response(
      JSON.stringify({ error: `Server "${serverSlug}" not found or disabled` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const remoteRes = await client.forward("/api/sessions/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });
    const data = await remoteRes.json().catch(() => ({}));

    if (!remoteRes.ok) {
      return new Response(JSON.stringify(data), {
        status: remoteRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Register the session in our mapping
    const sessionId = (data as Record<string, unknown>).sessionId;
    if (typeof sessionId === "string") {
      registerSession(sessionId, serverSlug);
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Remote server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
