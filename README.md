<p align="center">
  <img src="screenshot.png" alt="The Companion" width="100%" />
</p>

<h1 align="center">The Companion</h1>
<p align="center"><strong>Web UI for Claude Code and Codex sessions — single instance or multi-server.</strong></p>
<p align="center">Run multiple agents across multiple machines, inspect every tool call, and gate risky actions with explicit approvals.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/the-companion"><img src="https://img.shields.io/npm/v/the-companion.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/the-companion"><img src="https://img.shields.io/npm/dm/the-companion.svg" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</p>

## Quick start

**Requirements:** [Bun](https://bun.sh) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://github.com/openai/codex) CLI.

### Try it instantly

```bash
bunx the-companion
```

Open [http://localhost:3456](http://localhost:3456).

### Install globally

```bash
bun install -g the-companion

# Register as a background service (launchd on macOS, systemd on Linux)
the-companion install

# Start the service
the-companion start
```

Open [http://localhost:3456](http://localhost:3456). The server runs in the background and survives reboots.

## Why this is useful
- **Parallel sessions**: work on multiple tasks without juggling terminals.
- **Multi-server federation**: manage Claude Code sessions across multiple machines from a single UI.
- **Full visibility**: see streaming output, tool calls, and tool results in one timeline.
- **Permission control**: approve/deny sensitive operations from the UI — with cross-server notifications.
- **Session recovery**: restore work after process/server restarts.
- **Dual-engine support**: designed for both Claude Code and Codex-backed flows.
- **SSH terminals**: open a terminal to any remote server directly from the browser.

## Single server vs. multi-server

The Companion works in two modes:

### Single server (default)
One machine runs the Companion and spawns Claude Code processes locally. This is the standard setup — just `bunx the-companion` and go.

### Multi-server (Lighthouse mode)
A hub-and-spoke architecture where one **Lighthouse** server acts as a proxy UI, forwarding sessions to multiple **worker** servers. All traffic flows through Tailscale.

```text
Browser
  |
  v
Lighthouse (proxy, no local CLI)
  |-- Tailscale --> Worker: server-PVE (root)
  |-- Tailscale --> Worker: server-LLM-GPU (seb)
  '-- Tailscale --> Worker: MacminiM4 (seb)
```

Each worker runs the Companion as a standard service. The Lighthouse doesn't spawn CLI processes itself — it proxies REST and WebSocket traffic to the workers.

## Multi-server setup guide

### Prerequisites
- [Tailscale](https://tailscale.com) installed on all machines (Lighthouse + workers)
- [Bun](https://bun.sh) installed on all machines
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed on each **worker** (not needed on the Lighthouse)

### Step 1: Set up worker servers

On each machine that will run Claude Code sessions, install and start the Companion normally:

```bash
bun install -g the-companion
the-companion install
the-companion start
```

Grab the auth token from each worker — you'll need it for the Lighthouse config:

```bash
cat ~/.companion/auth.json
```

Note each worker's Tailscale hostname (e.g. `server-pve.tailnet-name.ts.net`).

### Step 2: Set up the Lighthouse

On the machine that will be your single UI entry point (e.g. an LXC container), run the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/SEBK4C/Claude-Companion-Server/feat/multi-server-registry/scripts/install-lighthouse.sh | bash
```

This installs all dependencies (git, unzip, Bun), clones the repo, builds, and sets up a systemd service with `COMPANION_LIGHTHOUSE=1`. The script prints the auth token and URL when done.

To customize the port:

```bash
COMPANION_PORT=8080 curl -fsSL https://raw.githubusercontent.com/SEBK4C/Claude-Companion-Server/feat/multi-server-registry/scripts/install-lighthouse.sh | bash
```

To update an existing installation, just run the installer again — it pulls the latest code and restarts.

### Step 3: Register worker servers

Open the Lighthouse UI in your browser:

```
http://<lighthouse-tailscale-hostname>:3456
```

Navigate to **Servers** (`#/servers`) in the sidebar and add each worker:

| Field | Example |
|---|---|
| Name | PVE Server |
| URL | `http://server-pve.tailnet-name.ts.net:3456` |
| Auth Token | *(paste from worker's `~/.companion/auth.json`)* |
| SSH User | root |
| Tailscale Hostname | server-pve |

Repeat for each worker. The health indicator will show green when connectivity is confirmed.

### Step 4: Use it

- **Create sessions**: on the HomePage, pick which server to run on using the server dropdown
- **Unified sidebar**: all sessions from all servers appear in one list with colored server badges
- **Permissions**: notifications work across all servers — approve/deny from anywhere
- **SSH terminals**: open a terminal to any server via **Servers > Terminal**

## Architecture

### Single server
```text
Browser (React)
  <-> ws://localhost:3456/ws/browser/:session
Companion server (Bun + Hono)
  <-> ws://localhost:3456/ws/cli/:session
Claude Code / Codex CLI
```

### Multi-server (Lighthouse mode)
```text
Browser (React)
  <-> ws://lighthouse:3456/ws/browser/:session
Lighthouse (Bun + Hono, COMPANION_LIGHTHOUSE=1)
  <-> ws://worker:3456/ws/browser/:session   (proxied)
Worker Companion server
  <-> ws://worker:3456/ws/cli/:session
Claude Code / Codex CLI
```

The Lighthouse proxies:
- **REST**: session create/list/kill and all `/api/sessions/:id/*` routes
- **WebSocket**: bidirectional message piping with auto-reconnect (3 attempts, exponential backoff)
- **SSH**: spawns local `ssh -t user@hostname` via PTY for in-browser terminals

The bridge uses the CLI `--sdk-url` websocket path and NDJSON events.

## CLI commands

| Command | Description |
|---|---|
| `the-companion` | Start server in foreground (default) |
| `the-companion serve` | Start server in foreground (explicit) |
| `the-companion install` | Register as a background service (launchd/systemd) |
| `the-companion start` | Start the background service |
| `the-companion stop` | Stop the background service |
| `the-companion restart` | Restart the background service |
| `the-companion uninstall` | Remove the background service |
| `the-companion status` | Show service status |
| `the-companion logs` | Tail service log files |

**Options:** `--port <n>` overrides the default port (3456).

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `COMPANION_LIGHTHOUSE` | Set to `1` to enable lighthouse (proxy-only) mode | `0` |
| `COMPANION_AUTH_TOKEN` | Override the auto-generated auth token | *(auto-generated)* |
| `PORT` | Server port | `3456` |
| `HOST` | Bind address | `0.0.0.0` |
| `COMPANION_SESSION_DIR` | Session persistence directory | `$TMPDIR/vibe-sessions` |
| `COMPANION_RECORD` | Enable protocol recording | `1` |
| `COMPANION_RECORDINGS_DIR` | Recording storage directory | `~/.companion/recordings` |

## Authentication

The server auto-generates an auth token on first start, stored at `~/.companion/auth.json`. You can also manage tokens manually:

```bash
# Show the current token (or auto-generate one)
cd web && bun run generate-token

# Force-regenerate a new token
cd web && bun run generate-token --force
```

Or set a token via environment variable (takes priority over the file):

```bash
COMPANION_AUTH_TOKEN="my-secret-token" bunx the-companion
```

In multi-server mode, each worker has its own token. The Lighthouse stores worker tokens in its server registry (`~/.companion/servers/`).

## Screenshots
| Chat + tool timeline | Permission flow |
|---|---|
| <img src="screenshot.png" alt="Main workspace" width="100%" /> | <img src="web/docs/screenshots/notification-section.png" alt="Permission and notifications" width="100%" /> |

## Development
```bash
make dev
```

Manual:
```bash
cd web
bun install
bun run dev
```

Checks:
```bash
cd web
bun run typecheck
bun run test
```

## Preview / Prerelease

Every push to `main` publishes a preview artifact:

| Artifact | Tag / dist-tag | Example |
|---|---|---|
| Docker image (moving) | `preview-main` | `docker.io/stangirard/the-companion:preview-main` |
| Docker image (immutable) | `preview-<sha>` | `docker.io/stangirard/the-companion:preview-abc1234...` |
| npm package | `next` | `bunx the-companion@next` |

Preview builds use a patch-core bump (e.g. `0.68.1-preview.*` when stable is `0.68.0`) so the in-app update checker can detect them as semver-ahead of the current stable release. They are **not** production-stable — use `latest` / semver tags for stable releases.

### Tracking prerelease updates in-app

In **Settings > Updates**, switch the update channel to **Prerelease** to receive preview builds. The default channel is **Stable** (semver releases only). Switching channels takes effect immediately on the next update check.

## Docs
- **Full documentation**: [`docs/`](docs/) (Mintlify — run `cd docs && mint dev` to preview locally)
- Protocol reverse engineering: [`WEBSOCKET_PROTOCOL_REVERSED.md`](WEBSOCKET_PROTOCOL_REVERSED.md)
- Contributor and architecture guide: [`CLAUDE.md`](CLAUDE.md)

## License
MIT
