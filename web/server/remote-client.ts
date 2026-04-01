/**
 * RemoteClient — authenticated HTTP client for making requests to remote
 * Companion Server instances. Used by lighthouse mode to proxy REST calls.
 */

import type { CompanionServer } from "./server-manager.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class RemoteError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly serverSlug?: string,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

export class RemoteClient {
  constructor(private server: CompanionServer) {}

  get slug(): string {
    return this.server.slug;
  }

  get baseUrl(): string {
    return this.server.url;
  }

  /**
   * Make an authenticated fetch to the remote server.
   * Adds Authorization header and handles timeouts.
   */
  async fetch(
    path: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<Response> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Merge abort signals if one was already provided
    if (fetchInit.signal) {
      fetchInit.signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const url = `${this.server.url}${path}`;
      const res = await globalThis.fetch(url, {
        ...fetchInit,
        headers: {
          ...fetchInit.headers,
          Authorization: `Bearer ${this.server.authToken}`,
        },
        signal: controller.signal,
      });
      return res;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new RemoteError(
          `Remote server "${this.server.name}" timed out after ${timeoutMs}ms`,
          undefined,
          this.server.slug,
        );
      }
      throw new RemoteError(
        `Remote server "${this.server.name}" unreachable: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        this.server.slug,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /** GET with JSON response. */
  async get<T>(path: string, timeoutMs?: number): Promise<T> {
    const res = await this.fetch(path, { timeoutMs });
    if (!res.ok) {
      throw new RemoteError(
        `Remote server "${this.server.name}" returned ${res.status} for GET ${path}`,
        res.status,
        this.server.slug,
      );
    }
    return (await res.json()) as T;
  }

  /** POST with JSON body and JSON response. */
  async post<T>(
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const res = await this.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
      timeoutMs,
    });
    if (!res.ok) {
      throw new RemoteError(
        `Remote server "${this.server.name}" returned ${res.status} for POST ${path}`,
        res.status,
        this.server.slug,
      );
    }
    return (await res.json()) as T;
  }

  /**
   * Forward a request and return the raw Response (for SSE streaming, etc.).
   * Does NOT check res.ok — caller handles the response.
   */
  async forward(
    path: string,
    init?: RequestInit & { timeoutMs?: number },
  ): Promise<Response> {
    return this.fetch(path, init);
  }
}
