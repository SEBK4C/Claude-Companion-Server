import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { RemoteClient, RemoteError } from "./remote-client.js";

const MOCK_SERVER = {
  name: "Test Server",
  slug: "test-server",
  url: "http://test.tail.ts.net:3456",
  authToken: "secret-token-123",
  sshUser: "seb",
  tailscaleHostname: "test",
  enabled: true,
  createdAt: 1000,
  updatedAt: 2000,
} as const;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("RemoteClient", () => {
  it("exposes slug and baseUrl from the server config", () => {
    const client = new RemoteClient(MOCK_SERVER as any);
    expect(client.slug).toBe("test-server");
    expect(client.baseUrl).toBe("http://test.tail.ts.net:3456");
  });

  describe("fetch", () => {
    it("prepends server URL and adds Authorization header", async () => {
      // Validates that fetch calls include the correct URL and auth header
      fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }));

      const client = new RemoteClient(MOCK_SERVER as any);
      await client.fetch("/api/sessions");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://test.tail.ts.net:3456/api/sessions",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer secret-token-123",
          }),
        }),
      );
    });

    it("throws RemoteError with serverSlug when fetch times out", async () => {
      // Validates timeout handling with abort controller
      fetchSpy.mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal)?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });

      const client = new RemoteClient(MOCK_SERVER as any);

      await expect(client.fetch("/api/sessions", { timeoutMs: 50 })).rejects.toThrow(
        RemoteError,
      );

      try {
        await client.fetch("/api/sessions", { timeoutMs: 50 });
      } catch (err) {
        expect(err).toBeInstanceOf(RemoteError);
        expect((err as RemoteError).serverSlug).toBe("test-server");
        expect((err as RemoteError).message).toContain("timed out");
      }
    });

    it("throws RemoteError when connection fails", async () => {
      // Validates network error handling
      fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

      const client = new RemoteClient(MOCK_SERVER as any);
      await expect(client.fetch("/api/sessions")).rejects.toThrow(RemoteError);
    });
  });

  describe("get", () => {
    it("returns parsed JSON on success", async () => {
      // Validates GET convenience method parses response body
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ data: "hello" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new RemoteClient(MOCK_SERVER as any);
      const result = await client.get<{ data: string }>("/api/sessions");
      expect(result.data).toBe("hello");
    });

    it("throws RemoteError on non-OK response", async () => {
      // Validates error handling for 4xx/5xx responses
      fetchSpy.mockResolvedValue(new Response("Not Found", { status: 404 }));

      const client = new RemoteClient(MOCK_SERVER as any);
      await expect(client.get("/api/sessions/missing")).rejects.toThrow(RemoteError);

      try {
        await client.get("/api/sessions/missing");
      } catch (err) {
        expect((err as RemoteError).status).toBe(404);
      }
    });
  });

  describe("post", () => {
    it("sends JSON body and returns parsed response", async () => {
      // Validates POST sends correct Content-Type and body
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new RemoteClient(MOCK_SERVER as any);
      const result = await client.post<{ ok: boolean }>("/api/sessions/create", {
        name: "test",
      });
      expect(result.ok).toBe(true);

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://test.tail.ts.net:3456/api/sessions/create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "test" }),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("forward", () => {
    it("returns the raw Response without checking status", async () => {
      // Validates that forward passes through the response as-is
      fetchSpy.mockResolvedValue(
        new Response("error body", { status: 500 }),
      );

      const client = new RemoteClient(MOCK_SERVER as any);
      const res = await client.forward("/api/sessions/create");
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("error body");
    });
  });
});
