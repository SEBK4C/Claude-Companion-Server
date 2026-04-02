import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type CompanionServer,
  type ServerCreateFields,
  type ServerHealthResult,
} from "../api.js";

interface Props {
  onClose?: () => void;
  embedded?: boolean;
}

export function ServerManager({ onClose, embedded = false }: Props) {
  const [servers, setServers] = useState<CompanionServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<EditFormState>(emptyForm());
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createFields, setCreateFields] = useState<EditFormState>(emptyForm());
  const [creating, setCreating] = useState(false);

  // Health states
  const [healthMap, setHealthMap] = useState<
    Record<string, ServerHealthResult | "loading">
  >({});

  const refresh = useCallback(() => {
    api
      .listServers()
      .then(setServers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ─── Health check helpers ───────────────────────────────────────────

  function checkHealth(slug: string) {
    setHealthMap((prev) => ({ ...prev, [slug]: "loading" }));
    api
      .healthCheckServer(slug)
      .then((result) => setHealthMap((prev) => ({ ...prev, [slug]: result })))
      .catch(() =>
        setHealthMap((prev) => ({
          ...prev,
          [slug]: { ok: false, latencyMs: 0, error: "Request failed" },
        })),
      );
  }

  function checkAllHealth() {
    for (const s of servers) checkHealth(s.slug);
  }

  // Check health on initial load
  useEffect(() => {
    if (servers.length > 0) checkAllHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length]);

  // ─── CRUD handlers ─────────────────────────────────────────────────

  function startEdit(server: CompanionServer) {
    setEditingSlug(server.slug);
    setEditFields({
      name: server.name,
      url: server.url,
      authToken: "", // don't prefill — it's redacted
      sshUser: server.sshUser,
      tailscaleHostname: server.tailscaleHostname,
      description: server.description || "",
      enabled: server.enabled,
    });
    setError("");
  }

  function cancelEdit() {
    setEditingSlug(null);
    setError("");
  }

  async function saveEdit() {
    if (!editingSlug) return;
    try {
      await api.updateServer(editingSlug, {
        name: editFields.name.trim() || undefined,
        url: editFields.url.trim() || undefined,
        // Only send authToken if user typed a new one
        authToken: editFields.authToken.trim() || undefined,
        sshUser: editFields.sshUser.trim() || undefined,
        tailscaleHostname: editFields.tailscaleHostname.trim() || undefined,
        description: editFields.description.trim() || undefined,
        enabled: editFields.enabled,
      });
      setEditingSlug(null);
      setError("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(slug: string) {
    try {
      await api.deleteServer(slug);
      if (editingSlug === slug) setEditingSlug(null);
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreate() {
    const name = createFields.name.trim();
    if (!name) return;
    setCreating(true);
    try {
      const fields: ServerCreateFields = {
        name,
        url: createFields.url.trim(),
        authToken: createFields.authToken.trim(),
        sshUser: createFields.sshUser.trim(),
        tailscaleHostname: createFields.tailscaleHostname.trim(),
        description: createFields.description.trim() || undefined,
        enabled: createFields.enabled,
      };
      await api.createServer(fields);
      setCreateFields(emptyForm());
      setShowCreate(false);
      setError("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  // ─── Embedded (full page) mode ─────────────────────────────────────

  if (embedded) {
    return (
      <div className="h-full bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto overflow-x-hidden">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-safe">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-cc-fg">Servers</h1>
              <p className="mt-0.5 text-[13px] text-cc-muted leading-relaxed">
                Remote Companion Server instances connected via Tailscale.
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 mt-4 mb-5">
            <button
              onClick={checkAllHealth}
              className="flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-lg text-sm text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
              title="Check all servers"
            >
              <RefreshIcon />
              <span className="hidden sm:inline">Check All</span>
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setShowCreate(!showCreate)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors cursor-pointer shrink-0 ${
                showCreate
                  ? "bg-cc-active text-cc-fg"
                  : "bg-cc-primary hover:bg-cc-primary-hover text-white"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-4 h-4"
              >
                {showCreate ? (
                  <path d="M18 6 6 18M6 6l12 12" />
                ) : (
                  <path d="M12 5v14M5 12h14" />
                )}
              </svg>
              <span className="hidden sm:inline">
                {showCreate ? "Cancel" : "New Server"}
              </span>
            </button>
          </div>

          {/* Inline create form */}
          {showCreate && (
            <div
              className="mb-6 rounded-xl bg-cc-card p-4 sm:p-5 space-y-3"
              style={{ animation: "fadeSlideIn 150ms ease-out" }}
            >
              <ServerForm
                fields={createFields}
                onChange={setCreateFields}
                showTokenPlaceholder="Auth token from remote server"
              />

              {error && (
                <div className="px-3 py-2 rounded-lg bg-cc-error/10 text-xs text-cc-error">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] text-cc-muted">
                  Stored in{" "}
                  <code className="text-[10px]">~/.companion/servers/</code>
                </p>
                <button
                  onClick={handleCreate}
                  disabled={!isFormValid(createFields) || creating}
                  className={`px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
                    isFormValid(createFields) && !creating
                      ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                      : "bg-cc-hover text-cc-muted cursor-not-allowed"
                  }`}
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-2 mb-3 text-[12px] text-cc-muted">
            <span>
              {servers.length} server{servers.length !== 1 ? "s" : ""}
            </span>
            {servers.length > 0 && (
              <>
                <span className="text-cc-border">|</span>
                <span>
                  {servers.filter((s) => s.enabled).length} enabled
                </span>
              </>
            )}
          </div>

          {/* Server list */}
          {loading ? (
            <div className="py-12 text-center text-sm text-cc-muted">
              Loading servers...
            </div>
          ) : servers.length === 0 ? (
            <div className="py-12 text-center text-sm text-cc-muted">
              No servers configured yet.
            </div>
          ) : (
            <div className="space-y-1">
              {servers.map((server) => {
                const isEditing = editingSlug === server.slug;
                const health = healthMap[server.slug];

                if (isEditing) {
                  return (
                    <div
                      key={server.slug}
                      className="rounded-xl bg-cc-card p-4 space-y-3"
                      style={{ animation: "fadeSlideIn 150ms ease-out" }}
                    >
                      <ServerForm
                        fields={editFields}
                        onChange={setEditFields}
                        showTokenPlaceholder="Leave empty to keep current token"
                      />
                      {error && (
                        <div className="px-3 py-2 rounded-lg bg-cc-error/10 text-xs text-cc-error">
                          {error}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-2.5 min-h-[44px] text-sm rounded-lg text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => void saveEdit()}
                          className="px-4 py-2.5 min-h-[44px] text-sm rounded-lg font-medium bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <ServerRow
                    key={server.slug}
                    server={server}
                    health={health}
                    onStartEdit={() => startEdit(server)}
                    onDelete={() => void handleDelete(server.slug)}
                    onCheckHealth={() => checkHealth(server.slug)}
                  />
                );
              })}
            </div>
          )}

          {/* Error banner (when not inside create form) */}
          {error && !showCreate && !editingSlug && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-cc-error/10 text-xs text-cc-error">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ─── Modal mode ────────────────────────────────────────────────────── */

  const createForm = (
    <div className="rounded-xl bg-cc-card p-4 space-y-2.5">
      <span className="text-sm font-medium text-cc-fg">New Server</span>
      <ServerForm
        fields={createFields}
        onChange={setCreateFields}
        showTokenPlaceholder="Auth token from remote server"
      />
      <button
        onClick={handleCreate}
        disabled={!isFormValid(createFields) || creating}
        className={`px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-lg transition-colors ${
          isFormValid(createFields) && !creating
            ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
            : "bg-cc-hover text-cc-muted cursor-not-allowed"
        }`}
      >
        {creating ? "Creating..." : "Create"}
      </button>
    </div>
  );

  const serversList = loading ? (
    <div className="text-sm text-cc-muted text-center py-6">
      Loading servers...
    </div>
  ) : servers.length === 0 ? (
    <div className="text-sm text-cc-muted text-center py-6">
      No servers configured yet.
    </div>
  ) : (
    <div className="space-y-3">
      {servers.map((server) => {
        const health = healthMap[server.slug];
        return (
          <div key={server.slug} className="rounded-xl bg-cc-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <HealthDot health={health} />
              <span className="text-sm font-medium text-cc-fg flex-1 truncate">
                {server.name}
              </span>
              {!server.enabled && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">
                  disabled
                </span>
              )}
              <span className="text-xs text-cc-muted truncate max-w-[120px]">
                {server.sshUser}@{server.tailscaleHostname}
              </span>
              {editingSlug === server.slug ? (
                <button
                  onClick={cancelEdit}
                  className="text-xs px-2 py-1.5 min-h-[44px] text-cc-muted hover:text-cc-fg cursor-pointer"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    onClick={() => startEdit(server)}
                    className="text-xs px-2 py-1.5 min-h-[44px] text-cc-muted hover:text-cc-fg cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(server.slug)}
                    className="text-xs px-2 py-1.5 min-h-[44px] text-cc-muted hover:text-cc-error cursor-pointer"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>

            {editingSlug === server.slug && (
              <div className="px-3 py-3 space-y-2">
                <ServerForm
                  fields={editFields}
                  onChange={setEditFields}
                  showTokenPlaceholder="Leave empty to keep current token"
                />
                <button
                  onClick={() => void saveEdit()}
                  className="px-4 py-2.5 min-h-[44px] text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg transition-colors cursor-pointer"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const panel = (
    <div
      className="w-full max-w-lg max-h-[90dvh] sm:max-h-[80dvh] mx-0 sm:mx-4 flex flex-col bg-cc-bg rounded-t-[14px] sm:rounded-[14px] shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-cc-fg">Manage Servers</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-3.5 h-3.5"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4 pb-safe space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-cc-error/10 text-xs text-cc-error">
            {error}
          </div>
        )}
        {serversList}
        {createForm}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      {panel}
    </div>,
    document.body,
  );
}

/* ─── Form state & helpers ─────────────────────────────────────────── */

interface EditFormState {
  name: string;
  url: string;
  authToken: string;
  sshUser: string;
  tailscaleHostname: string;
  description: string;
  enabled: boolean;
}

function emptyForm(): EditFormState {
  return {
    name: "",
    url: "",
    authToken: "",
    sshUser: "",
    tailscaleHostname: "",
    description: "",
    enabled: true,
  };
}

function isFormValid(f: EditFormState): boolean {
  return !!(
    f.name.trim() &&
    f.url.trim() &&
    f.authToken.trim() &&
    f.sshUser.trim() &&
    f.tailscaleHostname.trim()
  );
}

/* ─── Server Form (shared between create and edit) ─────────────────── */

function ServerForm({
  fields,
  onChange,
  showTokenPlaceholder,
}: {
  fields: EditFormState;
  onChange: (f: EditFormState) => void;
  showTokenPlaceholder: string;
}) {
  const set = (key: keyof EditFormState, value: string | boolean) =>
    onChange({ ...fields, [key]: value });

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={fields.name}
        onChange={(e) => set("name", e.target.value)}
        placeholder="Server name (e.g. Mac Mini M4)"
        className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
      />
      <input
        type="text"
        value={fields.url}
        onChange={(e) => set("url", e.target.value)}
        placeholder="URL (e.g. http://macminim4.tail12345.ts.net:3456)"
        className="w-full px-3 py-2.5 min-h-[44px] text-sm font-mono-code bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
      />
      <input
        type="password"
        value={fields.authToken}
        onChange={(e) => set("authToken", e.target.value)}
        placeholder={showTokenPlaceholder}
        className="w-full px-3 py-2.5 min-h-[44px] text-sm font-mono-code bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={fields.sshUser}
          onChange={(e) => set("sshUser", e.target.value)}
          placeholder="SSH user (e.g. seb)"
          className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
        />
        <input
          type="text"
          value={fields.tailscaleHostname}
          onChange={(e) => set("tailscaleHostname", e.target.value)}
          placeholder="Tailscale hostname (e.g. macminim4)"
          className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
        />
      </div>
      <input
        type="text"
        value={fields.description}
        onChange={(e) => set("description", e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow"
      />
      <label className="flex items-center gap-2 py-1 cursor-pointer">
        <input
          type="checkbox"
          checked={fields.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="w-4 h-4 rounded accent-cc-primary"
        />
        <span className="text-sm text-cc-fg">Enabled</span>
      </label>
    </div>
  );
}

/* ─── Server Row (embedded page — display) ─────────────────────────── */

interface ServerRowProps {
  server: CompanionServer;
  health: ServerHealthResult | "loading" | undefined;
  onStartEdit: () => void;
  onDelete: () => void;
  onCheckHealth: () => void;
}

function ServerRow({
  server,
  health,
  onStartEdit,
  onDelete,
  onCheckHealth,
}: ServerRowProps) {
  return (
    <div className="group flex items-start gap-3 px-3 py-3 min-h-[44px] rounded-lg hover:bg-cc-hover/60 transition-colors">
      {/* Status dot */}
      <div className="shrink-0 mt-1.5">
        <HealthDot health={health} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-cc-fg truncate">
            {server.name}
          </span>
          {!server.enabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted shrink-0">
              disabled
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-cc-muted truncate">
          {server.sshUser}@{server.tailscaleHostname}
        </p>
        {server.description && (
          <p className="mt-0.5 text-xs text-cc-muted/70 truncate">
            {server.description}
          </p>
        )}
        {health && health !== "loading" && (
          <p className="mt-0.5 text-[11px] text-cc-muted">
            {health.ok
              ? `${health.latencyMs}ms`
              : health.error || "Unreachable"}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button
          onClick={onCheckHealth}
          className="p-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
          aria-label="Check health"
          title="Check health"
        >
          <RefreshIcon />
        </button>
        <button
          onClick={onStartEdit}
          className="p-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
          aria-label="Edit"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-3.5 h-3.5"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:p-1.5 rounded-md text-cc-muted hover:text-cc-error hover:bg-cc-error/10 transition-colors cursor-pointer"
          aria-label="Delete"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-3.5 h-3.5"
          >
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ─── Shared icons ─────────────────────────────────────────────────── */

function HealthDot({
  health,
}: {
  health: ServerHealthResult | "loading" | undefined;
}) {
  if (!health)
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-cc-muted/30"
        title="Not checked"
      />
    );
  if (health === "loading")
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-cc-warning animate-pulse"
        title="Checking..."
      />
    );
  if (health.ok)
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full bg-green-500"
        title={`Online (${health.latencyMs}ms)`}
      />
    );
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full bg-cc-error"
      title={health.error || "Offline"}
    />
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-3.5 h-3.5"
    >
      <path d="M1 4v6h6M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}
