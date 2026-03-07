# ClawCC - OpenClaw Fleet Control Center

A self-hosted control plane for managing, monitoring, governing, and replaying a fleet of OpenClaw agent nodes. Zero external dependencies -- runs on Node.js stdlib alone.

---

## Key Features

- **Zero Dependencies** -- No npm install required; pure Node.js stdlib
- **Append-Only JSONL Events** -- Tamper-evident event storage with daily rotation
- **SSE Real-Time Streaming** -- Server-Sent Events with filters, pause/resume, auto-reconnect
- **Tailscale Networking** -- Tailnet-first node discovery and peer visibility
- **Security Hardened** -- PBKDF2, TOTP MFA, HMAC signing, Ed25519, security headers
- **Typed Safe Actions** -- Command and path allowlists; no remote shell access
- **Intent Contracts** -- Drift scoring across 5 factors with enforcement ladder
- **Policy Simulation Lab** -- Replay recorded sessions against candidate policies
- **Digital Twin Replay** -- Session comparison and replay capabilities
- **Topology Graph** -- Cognitive graph of agents, tools, files, and services
- **Zero-Trust Sandbox** -- Path canonicalization, symlink resolution, traversal prevention
- **Tripwires / Honeytokens** -- Configurable decoy secrets, paths, and URLs
- **Signed Skills Registry** -- Ed25519 skill signing with canary rollout config
- **Tamper-Evident Receipt Ledger** -- SHA-256 hash chains with daily Ed25519 root signing, JSONL persistence
- **Mobile Ops (Pocket PWA)** -- Read-only feed, alerts, and emergency kill with step-up auth
- **4-Eyes Approval Workflow** -- Dual-approver mechanism for high-risk actions
- **ABAC Policy Conditions** -- Environment tags, time windows, risk scores, node tags, role restrictions

---

## Architecture

```
                         +---------------------+
                         |     Clients          |
                         |                      |
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

## Quick Start

### 1. Clone

```bash
git clone https://github.com/your-org/clawcc.git
cd clawcc
```

No `npm install` needed. The entire project runs on the Node.js standard library.

### 2. Configure

```bash
cp config/clawcc.config.example.json clawcc.config.json
```

Edit `clawcc.config.json` to set your preferred port, data directory, and Tailscale options.

### 3. Start the Control Plane

```bash
node control-plane/server.js
```

### 4. Open the UI

Navigate to [http://localhost:3400](http://localhost:3400)

Default credentials: `admin` / `changeme`

### 5. Enroll a Node Agent

On each agent node:

```bash
cp config/node-agent.config.example.json node-agent.config.json
# Edit node-agent.config.json: set controlPlaneUrl, nodeId, and HMAC secret
node node-agent/agent.js
```

The agent will register with the control plane, begin sending heartbeats, and stream telemetry.

### 6. Generate Demo Data (Optional)

```bash
node scripts/generate-demo-data.js
```

Generates 30 days of sample data across 3 nodes and 210 sessions.

---

## Project Structure

```
clawcc/
  control-plane/
    server.js                 HTTP server + static hosting
    lib/                      Core libraries (router, crypto, auth, events, etc.)
    middleware/                Security headers, rate limiting, auth middleware
    routes/                   API route handlers (auth, fleet, events, ops, governance)
  node-agent/
    agent.js                  Node daemon (register, heartbeat, commands)
    lib/                      Discovery, telemetry, sandbox, offline spool
  ui/                         Static SPA (glassmorphic dark theme, 7 pages)
  cli/
    clawcc.js                 CLI tool (15+ commands)
  pocket/                     Mobile PWA (feed, alerts, emergency kill)
  termux/                     Android Termux setup
  config/                     Example configuration files
  allowlists/                 Command and path allowlists
  policies/                   Default policy rules
  tripwires/                  Honeytoken definitions
  skills/                     Skills registry
  scripts/                    Demo data generator
  test/                       6 test suites (122 tests)
  data/                       Runtime data (events, snapshots, audit)
```

---

## Security Highlights

ClawCC is designed to be secure by default:

- **PBKDF2 Password Hashing** -- 100k iterations, SHA-512, 64-byte key, 32-byte salt
- **TOTP Multi-Factor Auth** -- RFC 6238 compliant with recovery codes
- **HMAC Request Signing** -- Node-to-control-plane request authentication with nonce replay prevention
- **Ed25519 Signatures** -- Daily receipt root signing and skill bundle signing
- **Hash Chains** -- Tamper-evident audit logs and receipt ledgers
- **Path Sandbox** -- Canonicalization, symlink resolution, traversal prevention, forbidden path blocking
- **Rate Limiting** -- Per-IP request throttling
- **Security Headers** -- HSTS, CSP, X-Content-Type-Options (nosniff), X-Frame-Options (DENY), Referrer-Policy, Permissions-Policy
- **Secret Redaction** -- Automatic scrubbing of passwords, tokens, secrets, and API keys from event payloads
- **Session Management** -- Secure cookies (HttpOnly, SameSite, Secure), session rotation, TTL expiry
- **RBAC** -- Viewer, Operator, Admin, and Auditor roles
- **Step-Up Auth** -- MFA re-verification required for high-risk operations (kill switch, policy changes)
- **4-Eyes Approvals** -- High-risk actions require two independent approvers
- **User Persistence** -- User accounts survive server restarts (file-backed)
- **Tripwire Auto-Quarantine** -- Automatic session/node quarantine on honeytoken access

---

## Configuration

Configuration examples are provided in the `config/` directory:

| File | Purpose |
|------|---------|
| `config/clawcc.config.example.json` | Control plane settings (port, data dir, auth, Tailscale) |
| `config/node-agent.config.example.json` | Node agent settings (control plane URL, node ID, HMAC secret) |
| `allowlists/commands.json` | Allowed commands with argument constraints |
| `allowlists/paths.json` | Allowed, protected, and forbidden filesystem paths |
| `policies/default.policy.json` | 9 governance rules (drift, cost, errors, tripwires, production) |
| `tripwires/default.tripwires.json` | 5 honeytoken definitions (paths, URLs, secrets) |
| `skills/registry.json` | Skills registry with canary rollout configuration |

---

## Testing

Run the full test suite:

```bash
node test/run-all.js
```

The suite includes 122 tests across 6 modules:

| Suite | Tests | Covers |
|-------|-------|--------|
| Crypto | 27 | PBKDF2, TOTP, HMAC, Ed25519, hash chains, nonces |
| Auth | 25 | User creation, login, lockout, sessions, RBAC, MFA |
| Sandbox | 18 | Allowlists, path traversal, symlink resolution |
| Policy | 20 | Rule evaluation, drift scoring, enforcement, simulation |
| Receipts | 12 | Hash chains, Ed25519 signing, bundle verification |
| Events | 20 | Ingestion, redaction, size limits, subscriptions, queries |

---

## CLI Usage

```bash
node cli/clawcc.js --help
```

The CLI provides 15+ commands for interacting with the control plane from the terminal, including fleet management, session inspection, event queries, policy operations, and receipt verification.

Example commands:

```bash
node cli/clawcc.js status                    # Fleet overview
node cli/clawcc.js nodes                     # List registered nodes
node cli/clawcc.js sessions                  # List sessions
node cli/clawcc.js events --node mynode      # Query events
node cli/clawcc.js verify <path>             # Verify receipt chain integrity
node cli/clawcc.js kill --session <id>       # Kill a session (requires step-up)
```

---

## Mobile Ops (Pocket PWA)

Access the mobile-optimized Progressive Web App at `/pocket/` on the control plane:

```
http://localhost:3400/pocket/
```

Features:

- Live event feed with severity filtering
- Alert notifications
- Emergency kill switch with step-up MFA authentication
- Offline caching via service worker
- Installable as a home screen app

For Android Termux deployment, see `termux/README.md`.

---

## License

MIT
