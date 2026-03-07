# ClawCC - Fleet Control Center

A self-hosted control plane for managing, monitoring, governing, and replaying a fleet of AI agent nodes. Zero external dependencies -- runs on Node.js stdlib alone.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration Reference](#configuration-reference)
- [Deployment Guide](#deployment-guide)
- [API Reference](#api-reference)
- [CLI Reference](#cli-reference)
- [UI Dashboard](#ui-dashboard)
- [Mobile Ops (Pocket PWA)](#mobile-ops-pocket-pwa)
- [Node Agent](#node-agent)
- [Security](#security)
- [Governance & Compliance](#governance--compliance)
- [Third-Party Requirements](#third-party-requirements)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- **Zero Dependencies** -- No `npm install` required; pure Node.js stdlib (`node:crypto`, `node:fs`, `node:http`, etc.)
- **Append-Only JSONL Events** -- Tamper-evident event storage with daily rotation and async serialized writes
- **Hybrid Index Layer** -- In-memory indexes rebuilt from JSONL on boot; O(1) lookups instead of file scans
- **SSE Real-Time Streaming** -- Server-Sent Events with filters, keepalive, and auto-cleanup
- **Tailscale Networking** -- Tailnet-first node discovery and peer visibility
- **Security Hardened** -- PBKDF2, TOTP MFA, HMAC signing, Ed25519, CSP nonces, ReDoS protection, request timeouts
- **Typed Safe Actions** -- Command and path allowlists; no remote shell access
- **Intent Contracts** -- Drift scoring across 5 factors with enforcement ladder
- **Policy Simulation Lab** -- Replay recorded sessions against candidate policies
- **Digital Twin Replay** -- Session comparison and step-by-step replay with scrubber
- **Topology Graph** -- Interactive SVG cognitive graph of agents, tools, files, and services
- **Zero-Trust Sandbox** -- Path canonicalization, symlink resolution, traversal prevention
- **Tripwires / Honeytokens** -- Configurable decoy secrets, paths, and URLs with auto-quarantine
- **Signed Skills Registry** -- Ed25519 skill signing with canary rollout and auto-rollback
- **Tamper-Evident Receipt Ledger** -- SHA-256 hash chains with daily Ed25519 root signing
- **Mobile Ops (Pocket PWA)** -- Live feed, alerts, push notifications, and emergency kill with step-up auth
- **4-Eyes Approval Workflow** -- Dual-approver mechanism for high-risk actions
- **ABAC Policy Conditions** -- Environment tags, time windows, risk scores, node tags, role restrictions
- **Evidence Export** -- ZIP bundles with events, audit logs, receipts, and integrity hashes
- **Activity Heatmap & Streaks** -- 30-day event visualization with streak tracking
- **Usage Alerts** -- Configurable cost, token, and error rate thresholds with rolling windows
- **Blast Radius Analysis** -- Per-session and per-node impact assessment
- **Causality Explorer** -- Trace file/tool references across sessions
- **Graceful Shutdown** -- Connection draining, snapshot flushing, signal handling

---

## Architecture

```
                         +---------------------+
                         |     Clients          |
                  +------+------+------+--------+
                  |      |      |      |
               UI (SPA)  CLI  Pocket  Termux
               :3400/   shell  PWA    Android
                  |      |      |      |
                  +------+------+------+
                         |
                    HTTP / SSE
                         |
              +----------+----------+
              |   Control Plane     |
              |   (server.js)       |
              |                     |
              |  +-- Router         |
              |  +-- Auth / RBAC    |
              |  +-- Security MW    |
              |  +-- Hybrid Index   |
              |  +-- Events Store   |
              |  +-- Snapshots      |
              |  +-- Policy Engine  |
              |  +-- Intent / Drift |
              |  +-- Receipts       |
              |  +-- Audit Logger   |
              +----------+----------+
                         |
            Tailscale / HTTP signed requests
                         |
         +---------------+---------------+
         |               |               |
   +-----------+   +-----------+   +-----------+
   | Node      |   | Node      |   | Node      |
   | Agent     |   | Agent     |   | Agent     |
   |           |   |           |   |           |
   | discovery |   | discovery |   | discovery |
   | telemetry |   | telemetry |   | telemetry |
   | sandbox   |   | sandbox   |   | sandbox   |
   | spool     |   | spool     |   | spool     |
   +-----------+   +-----------+   +-----------+

              Data Layer (filesystem)
   +------------------------------------------+
   | data/events/YYYY-MM-DD.jsonl             |
   | data/snapshots/{sessions,usage,health,   |
   |                 topology}.json           |
   | data/audit/YYYY-MM-DD.jsonl              |
   | data/receipts/receipts-*.jsonl           |
   | data/receipts/roots/*.json               |
   | data/users/users.json                    |
   +------------------------------------------+
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | >= 18.0.0 | The only hard requirement. No npm packages needed. |
| **Operating System** | Linux, macOS, Windows | Tested on Ubuntu 22.04+, macOS 13+, Windows 10+ |
| **Disk Space** | ~50MB + data | Base install is tiny; data grows with event volume |
| **Memory** | 128MB minimum | ~200MB for 500K events in-memory index |

**Optional:**

| Tool | Purpose |
|------|---------|
| Tailscale | Secure mesh networking between nodes (recommended for production) |
| Git | Version tracking on ops workspace page |
| systemd / pm2 | Process management for production deployment |
| nginx / Caddy | Reverse proxy with TLS termination |

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/alokemajumder/clawcc.git
cd clawcc
```

No `npm install` needed. The entire project runs on the Node.js standard library.

### 2. Configure

```bash
cp config/clawcc.config.example.json clawcc.config.json
```

At minimum, change the `sessionSecret`:

```bash
# Generate a secure session secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `clawcc.config.json` and replace the `sessionSecret` value.

### 3. Start the Control Plane

```bash
node control-plane/server.js
```

Or using npm:

```bash
npm start
```

### 4. Open the UI

Navigate to [http://localhost:3400](http://localhost:3400)

Default credentials: **admin** / **changeme**

> **Important:** Change the default password immediately after first login via the UI settings or API.

### 5. Generate Demo Data (Optional)

```bash
node scripts/generate-demo-data.js
```

Generates 30 days of sample data across 3 nodes and 210 sessions. Restart the server after generating to rebuild indexes.

### 6. Enroll a Node Agent

On each agent machine:

```bash
cp config/node-agent.config.example.json node-agent.config.json
```

Edit `node-agent.config.json`:

```json
{
  "nodeId": "my-agent-01",
  "controlPlaneUrl": "http://YOUR_CONTROL_PLANE_IP:3400",
  "nodeSecret": "SAME_SECRET_AS_CONTROL_PLANE"
}
```

Start the agent:

```bash
node node-agent/agent.js
```

Or using npm:

```bash
npm run agent
```

The agent will register with the control plane, begin sending heartbeats, and stream telemetry.

---

## Configuration Reference

### Control Plane (`clawcc.config.json`)

Copy from `config/clawcc.config.example.json` and customize:

```jsonc
{
  // --- Server ---
  "mode": "local",                    // "local" or "fleet"
  "host": "0.0.0.0",                  // Bind address
  "port": 3400,                       // HTTP port
  "dataDir": "./data",                // Data storage directory

  // --- HTTPS (optional) ---
  "httpsEnabled": false,              // Enable HTTPS
  "httpsKeyPath": "/path/to/key.pem", // TLS private key
  "httpsCertPath": "/path/to/cert.pem", // TLS certificate

  // --- Secrets ---
  "sessionSecret": "CHANGE_ME_...",   // Used for HMAC verification (generate with openssl rand -hex 32)
  "adminKeyPublic": "",               // Ed25519 public key for admin operations
  "adminKeyPrivate": "",              // Ed25519 private key (keep secure)

  // --- Authentication ---
  "auth": {
    "sessionTtlMs": 86400000,         // Session lifetime: 24 hours
    "lockoutAttempts": 5,             // Failed login attempts before lockout
    "lockoutDurationMs": 900000,      // Lockout duration: 15 minutes
    "stepUpWindowMs": 300000          // Step-up auth validity: 5 minutes
  },

  // --- Fleet ---
  "fleet": {
    "heartbeatTimeoutMs": 60000,      // Mark node offline after this duration
    "maxNodes": 100                   // Maximum registered nodes
  },

  // --- Events ---
  "events": {
    "maxPayloadBytes": 65536,         // Max event payload: 64KB
    "snapshotIntervalMs": 60000,      // Snapshot rebuild interval: 1 minute
    "retentionDays": 90               // Event retention: 90 days
  },

  // --- Audit ---
  "audit": {
    "retentionDays": 365,             // Audit log retention: 1 year
    "rotationEnabled": true           // Enable log rotation
  },

  // --- Security ---
  "security": {
    "rateLimitWindowMs": 60000,       // Rate limit window: 1 minute
    "rateLimitMaxRequests": 100,      // Max requests per window per IP
    "requestTimeoutMs": 30000         // Request timeout: 30 seconds
  },

  // --- Tailscale (optional) ---
  "tailscale": {
    "enabled": true,                  // Enable Tailscale integration
    "statusCommand": "tailscale status --json"
  },

  // --- Workspace Discovery ---
  "discovery": {
    "paths": ["~/.claude"],           // Paths the ops workspace page can browse
    "intervalMs": 30000               // Discovery refresh interval
  },

  // --- Skills ---
  "skills": {
    "registryPath": "./skills/registry.json",
    "requireSigned": true,            // Require Ed25519 signature for skill deployment
    "canaryPercentage": 10            // Default canary rollout percentage
  },

  // --- Usage Alerts ---
  "alerts": {
    "costPerHour": 5.00,              // Alert when hourly cost exceeds $5
    "tokensPerHour": 100000,          // Alert when hourly tokens exceed 100K
    "errorRateThreshold": 0.10,       // Alert when error rate exceeds 10%
    "enabled": true
  }
}
```

### Node Agent (`node-agent.config.json`)

Copy from `config/node-agent.config.example.json` and customize:

```jsonc
{
  "nodeId": "",                       // Unique node identifier (auto-generated if empty)
  "controlPlaneUrl": "http://localhost:3400",  // Control plane URL
  "nodeSecret": "CHANGE_ME_TO_A_STRONG_SECRET", // HMAC shared secret (must match control plane)
  "tags": ["dev"],                    // Tags for policy targeting
  "discoveryPaths": ["~/.claude"],    // Paths to discover sessions and memory files
  "telemetryIntervalMs": 5000,        // Telemetry reporting interval: 5 seconds
  "heartbeatIntervalMs": 15000,       // Heartbeat interval: 15 seconds
  "dataDir": "./node-data",           // Local data directory
  "allowlistsDir": "../allowlists",   // Path to command/path allowlists
  "spoolDir": "./node-data/spool",    // Offline event spool directory
  "logLevel": "info"                  // Log level: debug, info, warn, error
}
```

### Allowlists

**Command Allowlist** (`allowlists/commands.json`):

Defines which commands agents can execute. Each entry specifies allowed and disallowed argument patterns:

```json
{
  "commands": {
    "ls": { "allowed": ["-la", "-lh"], "disallowed": ["-R"] },
    "cat": { "allowed": [], "disallowed": ["../"] },
    "grep": { "allowed": ["-r", "-n", "-i"], "disallowed": [] }
  }
}
```

**Path Allowlist** (`allowlists/paths.json`):

Controls filesystem access for agents:

```json
{
  "allowed": ["/tmp", "/home/user/workspace"],
  "protected": ["/etc"],
  "forbidden": ["/root", "/proc", "/sys"]
}
```

- **allowed**: Freely accessible paths
- **protected**: Accessible only with explicit approval flag
- **forbidden**: Hard-blocked, no override possible

### Policies

Governance rules in `policies/default.policy.json`:

```json
{
  "id": "default",
  "name": "Default Policy",
  "enabled": true,
  "priority": 10,
  "rules": [
    {
      "field": "type",
      "operator": "eq",
      "value": "tool.call",
      "score": 5,
      "conditions": {
        "env": ["production"],
        "timeWindow": { "after": "09:00", "before": "17:00" }
      }
    }
  ],
  "enforcement": {
    "ladder": [
      { "threshold": 10, "action": "log" },
      { "threshold": 30, "action": "warn" },
      { "threshold": 50, "action": "pause" },
      { "threshold": 100, "action": "kill" }
    ]
  }
}
```

### Tripwires

Honeytoken definitions in `tripwires/default.tripwires.json`:

```json
{
  "tripwires": [
    { "id": "tw-1", "type": "file", "target": "/etc/shadow", "severity": "critical" },
    { "id": "tw-2", "type": "secret", "target": "FAKE_API_KEY_12345", "severity": "critical" },
    { "id": "tw-3", "type": "url", "target": "https://canary.internal/token", "severity": "warning" }
  ]
}
```

When triggered, the system automatically quarantines the session and node, creates evidence, and logs to audit.

---

## Deployment Guide

### Development (Local)

```bash
git clone https://github.com/alokemajumder/clawcc.git
cd clawcc
cp config/clawcc.config.example.json clawcc.config.json
node control-plane/server.js
```

### Production (Single Server)

#### 1. Prepare the server

```bash
# Create a dedicated user
sudo useradd -m -s /bin/bash clawcc
sudo su - clawcc

# Clone the repository
git clone https://github.com/alokemajumder/clawcc.git
cd clawcc

# Create and edit config
cp config/clawcc.config.example.json clawcc.config.json
```

#### 2. Generate secrets

```bash
# Generate session secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate Ed25519 key pair for receipt signing
node cli/clawcc.js keygen
```

#### 3. Configure for production

Edit `clawcc.config.json`:

```json
{
  "mode": "fleet",
  "host": "0.0.0.0",
  "port": 3400,
  "dataDir": "/var/lib/clawcc/data",
  "sessionSecret": "YOUR_GENERATED_SECRET_HERE",
  "auth": {
    "sessionTtlMs": 28800000,
    "lockoutAttempts": 3,
    "lockoutDurationMs": 1800000,
    "stepUpWindowMs": 180000
  },
  "security": {
    "rateLimitWindowMs": 60000,
    "rateLimitMaxRequests": 200,
    "requestTimeoutMs": 30000
  },
  "events": {
    "retentionDays": 365
  }
}
```

#### 4. Create systemd service

```ini
# /etc/systemd/system/clawcc.service
[Unit]
Description=ClawCC Fleet Control Center
After=network.target

[Service]
Type=simple
User=clawcc
Group=clawcc
WorkingDirectory=/home/clawcc/clawcc
ExecStart=/usr/bin/node control-plane/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/clawcc/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable clawcc
sudo systemctl start clawcc
sudo systemctl status clawcc
```

#### 5. Set up a reverse proxy (nginx)

```nginx
# /etc/nginx/sites-available/clawcc
server {
    listen 443 ssl http2;
    server_name clawcc.example.com;

    ssl_certificate /etc/letsencrypt/live/clawcc.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clawcc.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3400;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # Health check (unauthenticated)
    location /healthz {
        proxy_pass http://127.0.0.1:3400/healthz;
    }
}
```

### Production (Docker)

```dockerfile
# Dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN mkdir -p /data
EXPOSE 3400
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "require('http').get('http://localhost:3400/healthz', r => { process.exit(r.statusCode === 200 ? 0 : 1) })"
CMD ["node", "control-plane/server.js"]
```

```yaml
# docker-compose.yml
services:
  clawcc:
    build: .
    ports:
      - "3400:3400"
    volumes:
      - clawcc-data:/data
      - ./clawcc.config.json:/app/clawcc.config.json:ro
    restart: always
    environment:
      - NODE_ENV=production

volumes:
  clawcc-data:
```

```bash
docker compose up -d
```

### Production (Tailscale Mesh)

For multi-node deployments, Tailscale provides encrypted mesh networking without opening ports:

```bash
# On the control plane server
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# On each agent node
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Configure agents to connect via Tailscale IP:

```json
{
  "controlPlaneUrl": "http://100.x.y.z:3400"
}
```

### Health Check

The `/healthz` endpoint is unauthenticated for use with load balancers, Kubernetes probes, and monitoring:

```bash
curl http://localhost:3400/healthz
# {"status":"ok","uptime":123.456}
```

---

## API Reference

All API endpoints require authentication via session cookie (`clawcc_session`) unless noted otherwise. Request and response bodies are JSON.

### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|:---:|
| POST | `/api/auth/login` | Login with username/password | No |
| POST | `/api/auth/logout` | End session | Yes |
| GET | `/api/auth/me` | Get current user info | Yes |
| POST | `/api/auth/change-password` | Change password | Yes |
| POST | `/api/auth/mfa/setup` | Generate MFA secret and QR URI | Yes |
| POST | `/api/auth/mfa/verify` | Verify MFA code during login | Yes |
| POST | `/api/auth/mfa/enable` | Enable MFA with verification code | Yes |
| POST | `/api/auth/step-up` | Re-verify MFA for high-risk operations | Yes |

**Login example:**

```bash
# Login
curl -c cookies.txt -X POST http://localhost:3400/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}'

# Use session cookie for subsequent requests
curl -b cookies.txt http://localhost:3400/api/auth/me
```

### Fleet Management

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/api/fleet/register` | Register a node | None (agent) |
| POST | `/api/fleet/heartbeat` | Node heartbeat | None (agent) |
| GET | `/api/fleet/nodes` | List all nodes | read |
| GET | `/api/fleet/nodes/:nodeId` | Get node details | read |
| GET | `/api/fleet/nodes/:nodeId/sessions` | Get node's sessions | read |
| GET | `/api/fleet/nodes/:nodeId/blast-radius` | Get node blast radius | read |
| POST | `/api/fleet/nodes/:nodeId/action` | Queue action for node | action |
| DELETE | `/api/fleet/nodes/:nodeId` | Remove a node | admin |
| GET | `/api/fleet/topology` | Get fleet topology graph | read |

### Events & Sessions

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/api/events/ingest` | Ingest a new event | None (agent) |
| GET | `/api/events/stream` | SSE real-time event stream | read |
| GET | `/api/events/query` | Query events with filters | read |
| GET | `/api/events/heatmap` | 30-day activity heatmap | read |
| GET | `/api/events/causality` | Trace file/tool references | read |
| GET | `/api/events/streak` | Activity streak stats | read |
| GET | `/api/sessions` | List all sessions | read |
| GET | `/api/sessions/:id` | Get session events | read |
| GET | `/api/sessions/:id/timeline` | Get session timeline | read |
| GET | `/api/sessions/:id/receipt` | Get session receipt | read |
| GET | `/api/sessions/:id/blast-radius` | Get session blast radius | read |
| GET | `/api/sessions/:id/replay` | Get session replay data | read |
| POST | `/api/sessions/:id/compare` | Compare two sessions | read |

**Event query parameters:** `from`, `to`, `nodeId`, `sessionId`, `type`, `severity`, `limit`, `offset`

**SSE stream parameters:** `nodeId`, `sessionId`, `type`, `severity`

### Operations

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/ops/health` | System health (CPU, RAM, uptime) | read |
| GET | `/api/ops/health/history` | Health history (1 hour) | read |
| GET | `/api/ops/usage` | Usage statistics | read |
| GET | `/api/ops/usage/breakdown` | Usage breakdown by provider | read |
| GET | `/api/ops/usage/alerts` | Current usage alerts | read |
| GET | `/api/ops/usage/rolling` | Rolling usage window | read |
| GET | `/api/ops/memory` | Agent memory files | read |
| GET | `/api/ops/workspace/files` | List workspace files | read |
| GET | `/api/ops/workspace/file` | Read a workspace file | read |
| PUT | `/api/ops/workspace/file` | Write a workspace file | action |
| GET | `/api/ops/git` | Git status and recent commits | read |
| GET | `/api/ops/cron` | List cron jobs | read |
| GET | `/api/ops/cron/history` | Cron run history | read |
| POST | `/api/ops/cron/:jobId/run` | Trigger a cron job | action |
| POST | `/api/ops/cron/:jobId/toggle` | Toggle a cron job | action |
| GET | `/api/ops/logs` | Read log files | read |
| GET | `/api/ops/tailscale` | Tailscale network status | read |
| POST | `/api/ops/notifications/subscribe` | Subscribe to push notifications | read |
| POST | `/api/ops/notifications/test` | Send test notification | read |

### Governance

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| GET | `/api/governance/policies` | List all policies | read |
| GET | `/api/governance/policies/:id` | Get a policy | read |
| PUT | `/api/governance/policies/:id` | Update a policy | admin + step-up |
| POST | `/api/governance/policies/simulate` | Simulate policy on session | read |
| POST | `/api/governance/approvals` | Create approval request | read |
| GET | `/api/governance/approvals` | List pending approvals | read |
| GET | `/api/governance/approvals/:id` | Get approval details | read |
| POST | `/api/governance/approvals/:id/grant` | Grant approval | action |
| POST | `/api/governance/approvals/:id/deny` | Deny approval | read |
| GET | `/api/governance/tripwires` | List tripwire definitions | read |
| PUT | `/api/governance/tripwires` | Update tripwires | admin + step-up |
| GET | `/api/governance/tripwires/triggers` | List tripwire triggers | read |
| GET | `/api/governance/audit` | Query audit log | audit |
| POST | `/api/governance/evidence/export` | Export evidence bundle (ZIP) | audit |
| POST | `/api/governance/evidence/verify` | Verify evidence bundle | read |
| GET | `/api/governance/skills` | List skills registry | read |
| POST | `/api/governance/skills/:id/deploy` | Deploy a skill | admin + step-up |
| POST | `/api/governance/skills/:id/rollback` | Rollback a skill | admin |
| GET | `/api/governance/access-review` | List users for access review | audit |
| GET | `/api/governance/receipts/verify` | Verify receipt chain | read |

### Kill Switch

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|------------|
| POST | `/api/kill/session/:sessionId` | Kill a session | admin + step-up |
| POST | `/api/kill/node/:nodeId` | Kill a node | admin + step-up |
| POST | `/api/kill/global` | Global kill switch | admin + step-up |

### Health Check (Unauthenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/healthz` | Health probe for load balancers |
| GET | `/api/healthz` | Health probe (alternate path) |

---

## CLI Reference

The CLI provides 18 commands for interacting with the control plane from the terminal.

### Setup

```bash
# Initialize CLI configuration and generate keys
node cli/clawcc.js init

# Configuration is stored in ~/.clawcc/config.json
```

### Commands

```bash
# Fleet overview
node cli/clawcc.js status [--host URL]

# List registered nodes
node cli/clawcc.js nodes [--host URL] [--format table|json]

# List sessions
node cli/clawcc.js sessions [--host URL] [--format table|json]

# Live event feed (SSE stream)
node cli/clawcc.js feed [--host URL]

# List governance policies
node cli/clawcc.js policies [--host URL] [--format table|json]

# Apply a policy from file
node cli/clawcc.js policy-apply --file policy.json [--host URL]

# Simulate policy on a session
node cli/clawcc.js policy-simulate --session SESSION_ID [--host URL]

# Kill a session (requires step-up MFA)
node cli/clawcc.js kill-session --id SESSION_ID [--host URL]

# Kill a node
node cli/clawcc.js kill-node --id NODE_ID [--host URL]

# Global kill switch
node cli/clawcc.js kill-global [--host URL]

# Verify receipt chain integrity
node cli/clawcc.js verify <evidence-bundle.json>

# Export evidence bundle
node cli/clawcc.js export [--session SESSION_ID] [--host URL]

# List users
node cli/clawcc.js users [--host URL] [--format table|json]

# Create a user
node cli/clawcc.js user-create [--host URL]

# Verify receipts for a date
node cli/clawcc.js receipts-verify [--date YYYY-MM-DD] [--host URL]

# Generate Ed25519 key pair
node cli/clawcc.js keygen

# Enroll this machine as a node
node cli/clawcc.js enroll [--host URL]
```

### CLI Configuration

The CLI reads configuration from `~/.clawcc/config.json`:

```json
{
  "host": "http://localhost:3400",
  "format": "table"
}
```

Override with `--host` and `--format` flags on any command.

---

## UI Dashboard

The web UI is a single-page application (SPA) served at the root URL with a glassmorphic dark theme. No build step required -- it's plain HTML/CSS/JS.

### Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Fleet overview, node status, session counts, health metrics |
| **Live Feed** | Real-time event stream with filters, activity heatmap, streak badge |
| **Sessions** | Session list with drill-down, timeline, blast radius, drift analysis, compare, replay |
| **Fleet** | Node management, topology graph, blast radius, node actions |
| **Governance** | Policies, tripwires, approvals, skills, audit log, evidence export |
| **Ops** | System health, usage, workspace files, git status, cron, logs, Tailscale |
| **Settings** | User profile, password change, MFA setup, access review |

### Accessing the UI

```
http://localhost:3400          # Main dashboard
http://localhost:3400/pocket/  # Mobile PWA
```

---

## Mobile Ops (Pocket PWA)

The Pocket PWA is a mobile-optimized interface at `/pocket/`:

### Features

- Live event feed with severity filtering
- Alert notifications (push notification support)
- Emergency kill switch with step-up MFA
- Offline caching via service worker
- Installable as a home screen app (Add to Home Screen)

### Push Notifications

1. Open the Pocket PWA
2. Go to the Alerts tab
3. Click "Enable Notifications"
4. Grant browser notification permission
5. Notifications are sent for critical events

### Android (Termux) Deployment

For running ClawCC directly on an Android device:

```bash
# In Termux
pkg install nodejs git
git clone https://github.com/alokemajumder/clawcc.git
cd clawcc/termux
bash setup.sh
```

See `termux/README.md` for details.

---

## Node Agent

The node agent runs on each machine you want to monitor and manages:

- **Registration**: Enrolls with the control plane on startup
- **Heartbeat**: Sends periodic health data (CPU, RAM, load)
- **Telemetry**: Discovers and reports sessions, memory files, git activity
- **Sandbox**: Executes typed safe actions within allowlist constraints
- **Offline Spool**: Queues events locally when the control plane is unreachable

### Running the Agent

```bash
# Configure
cp config/node-agent.config.example.json node-agent.config.json
# Edit nodeId, controlPlaneUrl, and nodeSecret

# Start
node node-agent/agent.js
```

### Agent Security

- All requests to the control plane are HMAC-signed
- No shell commands are exposed -- only typed safe actions via allowlists
- Path access is sandboxed with symlink resolution and traversal prevention
- Offline events are spooled to disk and replayed when connectivity returns

---

## Security

ClawCC is designed to be secure by default. See [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) for the full threat model and control details.

### Security Summary

| Layer | Controls |
|-------|----------|
| **Authentication** | PBKDF2 (100K iterations, SHA-512), TOTP MFA, session cookies (HttpOnly, SameSite, Secure) |
| **Authorization** | RBAC (viewer/operator/auditor/admin), ABAC conditions, step-up auth, 4-eyes approval |
| **Network** | Tailscale WireGuard, HMAC request signing, nonce replay prevention, optional TLS |
| **Input** | Body size limits (1MB), event payload limits (64KB), type validation, ReDoS-safe regex |
| **Output** | Secret redaction, CSP nonces, security headers (HSTS, X-Frame-Options, etc.) |
| **Data** | Append-only JSONL, SHA-256 hash chains, Ed25519 signatures, serialized async writes |
| **Runtime** | Rate limiting, request timeouts (30s), graceful shutdown, uncaught exception handlers |
| **Sandbox** | Command allowlists, path allowlists, symlink resolution, traversal prevention |

### Changing the Admin Password

```bash
# Via API
curl -b cookies.txt -X POST http://localhost:3400/api/auth/change-password \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"changeme","newPassword":"your-secure-password-here"}'
```

### Setting Up MFA

```bash
# Get MFA secret and QR URI
curl -b cookies.txt -X POST http://localhost:3400/api/auth/mfa/setup

# Verify with code from authenticator app
curl -b cookies.txt -X POST http://localhost:3400/api/auth/mfa/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

### RBAC Roles

| Role | Permissions | Use Case |
|------|------------|----------|
| `viewer` | Read-only access | Dashboard monitoring |
| `operator` | Read + execute safe actions | Day-to-day operations |
| `auditor` | Read + audit logs + evidence export | Compliance auditing |
| `admin` | Full access | System administration |

---

## Governance & Compliance

ClawCC provides built-in compliance controls mapped to SOC 2, ISO 27001, and NIST CSF. See [COMPLIANCE_PACK.md](COMPLIANCE_PACK.md) for detailed control mappings.

### Evidence Export

Export signed evidence bundles for audit purposes:

```bash
# Export all evidence as ZIP
curl -b cookies.txt -X POST http://localhost:3400/api/governance/evidence/export \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-01-01","to":"2026-03-01"}' \
  -o evidence-bundle.zip

# Export for a specific session
curl -b cookies.txt -X POST http://localhost:3400/api/governance/evidence/export \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"sess-123","format":"json"}'
```

### Verify Receipt Chain

```bash
# Via API
curl -b cookies.txt "http://localhost:3400/api/governance/receipts/verify?date=2026-03-01"

# Via CLI
node cli/clawcc.js verify evidence-bundle.json
```

---

## Third-Party Requirements

ClawCC has **zero runtime dependencies**. No npm packages are used. Everything runs on the Node.js standard library.

### Required

| Dependency | Version | Notes |
|------------|---------|-------|
| **Node.js** | >= 18.0.0 | The only requirement. Uses `node:crypto`, `node:fs`, `node:http`, `node:os`, `node:path`, `node:url`, `node:child_process`, `node:test`, `node:assert` |

### Optional (Infrastructure)

| Tool | Purpose | When Needed |
|------|---------|-------------|
| **Tailscale** | Encrypted mesh networking between control plane and agents | Multi-node fleet deployments |
| **nginx / Caddy** | Reverse proxy with TLS termination | Production deployments requiring HTTPS |
| **Let's Encrypt / certbot** | Free TLS certificates | When using HTTPS directly or via reverse proxy |
| **systemd** | Process management, auto-restart | Linux production servers |
| **Docker** | Container deployment | Containerized environments |
| **pm2** | Node.js process manager | Alternative to systemd |

### No External APIs Required

ClawCC does not call any external APIs, cloud services, or SaaS platforms. It is fully self-contained and air-gappable:

- No analytics or telemetry sent anywhere
- No license server or activation check
- No package registry calls at runtime
- No external authentication providers (built-in auth only)
- All cryptography uses Node.js `node:crypto` (OpenSSL under the hood)

### Optional Integrations

| Integration | Type | Description |
|-------------|------|-------------|
| **Tailscale** | CLI tool | Reads `tailscale status --json` for network topology. Install separately. |
| **Git** | CLI tool | Reads `git log` / `git status` on the ops workspace page. Standard install. |
| **crontab** | System tool | Reads `crontab -l` for cron job display. Available on all Unix systems. |

---

## Testing

Run the full test suite:

```bash
# Using npm
npm test

# Direct
node --test test/**/*.test.js
```

The suite includes 122 tests across 6 modules:

| Suite | Tests | Covers |
|-------|-------|--------|
| Crypto | 27 | PBKDF2, TOTP, HMAC, Ed25519, hash chains, nonces |
| Auth | 25 | User creation, login, lockout, sessions, RBAC, MFA, password change |
| Sandbox | 18 | Allowlists, path traversal, symlink resolution |
| Policy | 20 | Rule evaluation, drift scoring, enforcement, simulation, ReDoS protection |
| Receipts | 12 | Hash chains, Ed25519 signing, bundle verification |
| Events | 20 | Ingestion, redaction, size limits, subscriptions, queries, async writes |

---

## Troubleshooting

### Server won't start

```bash
# Check Node.js version (must be >= 18)
node --version

# Check if port is in use
lsof -i :3400

# Run with debug output
node control-plane/server.js 2>&1 | head -50
```

### Agent can't connect to control plane

```bash
# Test connectivity
curl http://CONTROL_PLANE_IP:3400/healthz

# Check agent config
cat node-agent.config.json | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).controlPlaneUrl)"

# Verify shared secret matches
# The nodeSecret in agent config must match the sessionSecret in control plane config
```

### MFA not working

- Ensure your device clock is synchronized (TOTP is time-based, 30-second window)
- Recovery codes from MFA setup can be used as one-time codes
- Admin can reset MFA for a user via the API

### High memory usage

- The in-memory index grows with event count (capped at 500K events)
- Check index stats: events are evicted from memory but persist on disk
- Restart the server to rebuild indexes from disk

### Events not appearing in UI

```bash
# Check if events are being ingested
curl -b cookies.txt "http://localhost:3400/api/events/query?limit=5"

# Check SSE stream is working
curl -N -b cookies.txt http://localhost:3400/api/events/stream
```

---

## Project Structure

```
clawcc/
  control-plane/
    server.js                 HTTP server, module initialization, request handling
    lib/
      auth.js                 User management, sessions, RBAC, MFA
      audit.js                Append-only audit logging with hash chains
      crypto.js               PBKDF2, TOTP, HMAC, Ed25519, hash chains
      events.js               Event store with async write queue
      index.js                Hybrid in-memory index layer
      intent.js               Intent contracts and drift scoring
      policy.js               Policy engine with ABAC, ReDoS-safe regex
      receipts.js             Receipt ledger with Ed25519 signing
      router.js               HTTP router with :param support
      snapshots.js            Session/usage/health/topology snapshots
      zip.js                  ZIP file builder (deflateRaw + CRC-32)
    middleware/
      auth-middleware.js       Session auth, step-up auth, node signature verification
      security.js              Security headers, rate limiting, body parsing, path sanitization
    routes/
      auth-routes.js           Authentication endpoints
      event-routes.js          Event ingestion, streaming, sessions, heatmap, replay
      fleet-routes.js          Node management, topology, blast radius
      governance-routes.js     Policies, approvals, tripwires, skills, audit, evidence
      kill-switch.js           Emergency kill switch (session/node/global)
      ops-routes.js            Health, usage, workspace, cron, logs, notifications
  node-agent/
    agent.js                  Node agent daemon
    lib/
      discovery.js             Session and workspace discovery
      sandbox.js               Command/path sandbox with allowlists
      spool.js                 Offline event spooling
      telemetry.js             Health and performance telemetry
  ui/
    index.html                SPA entry point
    css/main.css              Glassmorphic dark theme
    js/
      api.js                   API client
      app.js                   SPA router and initialization
      pages.js                 Page renderers (7 pages)
  cli/
    clawcc.js                 CLI tool (18 commands)
  pocket/
    index.html                Mobile PWA
    sw.js                     Service worker (offline, push notifications)
    manifest.json             PWA manifest
  termux/
    setup.sh                  Android Termux setup script
    README.md                 Termux deployment guide
  config/
    clawcc.config.example.json     Control plane config template
    node-agent.config.example.json Node agent config template
  allowlists/
    commands.json             Allowed commands with argument constraints
    paths.json                Allowed/protected/forbidden paths
  policies/
    default.policy.json       Default governance policy rules
  tripwires/
    default.tripwires.json    Honeytoken definitions
  skills/
    registry.json             Skills registry
  scripts/
    generate-demo-data.js     Demo data generator (30 days, 3 nodes)
  test/                       6 test suites (122 tests)
  SECURITY_ARCHITECTURE.md    Threat model and security controls
  COMPLIANCE_PACK.md          SOC 2 / ISO 27001 / NIST CSF mappings
```

---

## License

MIT
