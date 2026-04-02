import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { COMPANION_HOME } from "./paths.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompanionServer {
  name: string;
  slug: string;
  url: string;
  authToken: string;
  sshUser: string;
  tailscaleHostname: string;
  description?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Fields accepted when creating a new server */
export interface ServerCreateFields {
  name: string;
  url: string;
  authToken: string;
  sshUser: string;
  tailscaleHostname: string;
  description?: string;
  enabled?: boolean;
}

/** Fields that can be updated via the update API */
export interface ServerUpdateFields {
  name?: string;
  url?: string;
  authToken?: string;
  sshUser?: string;
  tailscaleHostname?: string;
  description?: string;
  enabled?: boolean;
}

/** Redacted version of CompanionServer for API responses (auth token masked) */
export type CompanionServerRedacted = Omit<CompanionServer, "authToken"> & {
  authToken: string; // masked, e.g. "abc...xyz"
};

// ─── Paths ──────────────────────────────────────────────────────────────────

const SERVERS_DIR = join(COMPANION_HOME, "servers");

function ensureDir(): void {
  mkdirSync(SERVERS_DIR, { recursive: true });
}

/** Validate that a slug contains only safe characters (prevents path traversal) */
function validateSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(
      "Invalid slug: must contain only lowercase alphanumeric characters and hyphens",
    );
  }
}

function filePath(slug: string): string {
  validateSlug(slug);
  return join(SERVERS_DIR, `${slug}.json`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Mask an auth token for safe display: show first 3 and last 3 chars */
export function redactToken(token: string): string {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 3)}...${token.slice(-3)}`;
}

/** Return a redacted copy of a server (auth token masked) */
export function redactServer(server: CompanionServer): CompanionServerRedacted {
  return { ...server, authToken: redactToken(server.authToken) };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listServers(): CompanionServer[] {
  ensureDir();
  try {
    const files = readdirSync(SERVERS_DIR).filter((f) => f.endsWith(".json"));
    const servers: CompanionServer[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(SERVERS_DIR, file), "utf-8");
        servers.push(JSON.parse(raw));
      } catch {
        // Skip corrupt files
      }
    }
    servers.sort((a, b) => a.name.localeCompare(b.name));
    return servers;
  } catch {
    return [];
  }
}

export function getServer(slug: string): CompanionServer | null {
  ensureDir();
  try {
    const raw = readFileSync(filePath(slug), "utf-8");
    return JSON.parse(raw) as CompanionServer;
  } catch {
    return null;
  }
}

export function createServer(fields: ServerCreateFields): CompanionServer {
  if (!fields.name?.trim()) throw new Error("Server name is required");
  if (!fields.url?.trim()) throw new Error("Server URL is required");
  if (!fields.authToken?.trim()) throw new Error("Auth token is required");
  if (!fields.sshUser?.trim()) throw new Error("SSH user is required");
  if (!fields.tailscaleHostname?.trim())
    throw new Error("Tailscale hostname is required");

  const slug = slugify(fields.name.trim());
  if (!slug)
    throw new Error("Server name must contain alphanumeric characters");

  ensureDir();
  if (existsSync(filePath(slug))) {
    throw new Error(
      `A server with a similar name already exists ("${slug}")`,
    );
  }

  const now = Date.now();
  const server: CompanionServer = {
    name: fields.name.trim(),
    slug,
    url: fields.url.trim().replace(/\/+$/, ""), // strip trailing slashes
    authToken: fields.authToken.trim(),
    sshUser: fields.sshUser.trim(),
    tailscaleHostname: fields.tailscaleHostname.trim(),
    description: fields.description?.trim() || undefined,
    enabled: fields.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(filePath(slug), JSON.stringify(server, null, 2), "utf-8");
  return server;
}

export function updateServer(
  slug: string,
  updates: ServerUpdateFields,
): CompanionServer | null {
  ensureDir();
  const existing = getServer(slug);
  if (!existing) return null;

  const newName = updates.name?.trim() || existing.name;
  const newSlug = slugify(newName);
  if (!newSlug)
    throw new Error("Server name must contain alphanumeric characters");

  // If name changed, check for slug collision with a different server
  if (newSlug !== slug && existsSync(filePath(newSlug))) {
    throw new Error(
      `A server with a similar name already exists ("${newSlug}")`,
    );
  }

  const server: CompanionServer = {
    ...existing,
    name: newName,
    slug: newSlug,
    url: updates.url?.trim().replace(/\/+$/, "") ?? existing.url,
    authToken: updates.authToken?.trim() ?? existing.authToken,
    sshUser: updates.sshUser?.trim() ?? existing.sshUser,
    tailscaleHostname:
      updates.tailscaleHostname?.trim() ?? existing.tailscaleHostname,
    description:
      updates.description !== undefined
        ? updates.description?.trim() || undefined
        : existing.description,
    enabled: updates.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  };

  // If slug changed, delete old file
  if (newSlug !== slug) {
    try {
      unlinkSync(filePath(slug));
    } catch {
      /* ok */
    }
  }

  writeFileSync(filePath(newSlug), JSON.stringify(server, null, 2), "utf-8");
  return server;
}

export function deleteServer(slug: string): boolean {
  ensureDir();
  if (!existsSync(filePath(slug))) return false;
  try {
    unlinkSync(filePath(slug));
    return true;
  } catch {
    return false;
  }
}
