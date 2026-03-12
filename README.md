<div align="center">

# Fleet Control Center

### Self-Hosted Control Plane for AI Agent Fleets

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](package.json)
[![Tests](https://img.shields.io/badge/tests-833%20passing-brightgreen?style=flat-square)](test/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

**Monitor, govern, replay, and secure your AI agent fleet from a single dashboard.**
**Zero npm dependencies. Pure Node.js. Air-gappable. Deploy anywhere.**

[Quick Start](#quick-start) | [Features](#features) | [Architecture](#architecture) | [Security](#security) | [API Docs](PROGRESS.md) | [Contributing](CONTRIBUTING.md)

</div>

---

## Why FCC?

You're running AI agents — Claude Code, Copilot, Cursor, Codex, or your own. They touch files, call APIs, generate code. But **what are they actually doing?**

| You ask... | FCC answers |
|-----------|-------------|
| "What did my agents do last night?" | Append-only event ledger with session replay and timeline |
| "Are my agents drifting off-task?" | Intent contracts with 5-factor drift scoring |
| "How do I kill a rogue agent NOW?" | Emergency kill switch with step-up MFA |
| "Can I prove compliance to auditors?" | Hash-chained audit trails, Ed25519 receipts, evidence export |
| "Do I need 500 npm packages for this?" | **Zero.** Pure Node.js stdlib. No `node_modules`. |

---

## Quick Start

```bash
git clone https://github.com/alokemajumder/FleetControlCenter.git
cd FleetControlCenter
node control-plane/server.js
```

Open [http://localhost:3400](http://localhost:3400). Login: `admin` / `changeme`.

That's it. No `npm install`. No build step. No Docker required.

### With Docker

```bash
docker compose up -d
```

### On Android (Termux)

```bash
bash termux/setup.sh
```

---

## Features

### Core Platform
- **Real-time SSE Feed** — Live event streaming with filters and auto-reconnect
- **Session Replay** — Step-by-step digital twin replay with timeline scrubber
- **Knowledge Graph** — Force-directed SVG visualization of agents, tools, and files
- **Activity Heatmap** — 30-day contribution grid with streak tracking
- **Gateway Federation** — Proxy and aggregate across multiple FCC instances
- **Natural Language Scheduler** — "every monday at 9am" → cron jobs
- **21-page SPA** — Glassmorphic dark theme, keyboard-first, works offline (PWA)

### Security & Governance
- **Zero-Trust Sandbox** — Command/path allowlists, symlink resolution, no remote shell
- **Intent Contracts** — Drift scoring across 5 factors with enforcement ladders
- **Policy Engine** — ABAC conditions (env, time windows, risk scores, node tags)
- **Secret Scanner** — 14+ patterns (AWS, GitHub, Stripe, JWT, PEM keys)
- **Security Profiles** — Minimal / Standard / Strict enforcement presets
- **Tripwires & Honeytokens** — Decoy secrets with auto-quarantine
- **4-Eyes Approval** — Dual-approver workflow with self-approve prevention
- **Evidence Export** — ZIP bundles with Ed25519 signatures for auditors

### Fleet Operations
- **Agent Tracker** — 7 agent types, heartbeat monitoring, stale detection
- **Kanban Task Board** — 6-column board with enforced status transitions
- **Webhooks** — HMAC-SHA256 signed delivery with circuit breaker
- **Skills Hub** — Browse, install, and security-scan agent skills
- **Agent Evaluations** — 4-layer scoring with quality gates and fleet scorecards
- **Doctor Diagnostics** — 12 health checks with auto-fix
- **Backup & Restore** — Timestamped backups with JSON manifests

### Identity & Access
- **PBKDF2** — 100K iterations, SHA-512
- **TOTP MFA** — RFC 6238 with recovery codes
- **RBAC** — Viewer / Operator / Auditor / Admin
- **API Keys** — SHA-256 hashed, prefix-based revocation
- **Session Rotation** — HttpOnly, SameSite cookies with configurable TTL

---

## Supported Agents

Works with **any** AI coding agent. Auto-discovers sessions from:

| | Agents |
|-|--------|
| **Major** | Claude Code, Codex CLI, GitHub Copilot, Cursor, Windsurf, Gemini Code Assist, Augment, Kiro, Amazon Q, Tabnine |
| **Open Source** | Continue, OpenHands, Tabby, Goose, OpenCode, Cline, Aider |
| **Custom** | Any agent via `discoveryPaths` config — no vendor lock-in |

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Web UI     │     │  CLI        │     │  Pocket PWA │
│  (21 pages) │     │  (18 cmds)  │     │  (mobile)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────┬───────┴───────────────────┘
                   │ HTTP / SSE
          ┌────────┴────────┐
          │  Control Plane  │
          │  31 lib modules │
          │  24 route files │
          └────────┬────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───┴───┐    ┌────┴────┐   ┌────┴────┐
│ JSONL │    │ SQLite  │   │ Node    │
│ Event │    │ Accel.  │   │ Agent   │
│ Store │    │ (opt.)  │   │ Daemon  │
└───────┘    └─────────┘   └─────────┘
```

**Data Layer:** Append-only JSONL files (tamper-evident source of truth) + optional SQLite acceleration (Node.js 22+). No external database required.

**Crypto Stack:** PBKDF2 + TOTP + HMAC-SHA256 + Ed25519 + SHA-256 hash chains — all from `node:crypto`.

---

## Zero Dependencies — Really

```
$ ls node_modules
ls: node_modules: No such file or directory

$ cat package.json | grep dependencies
(nothing)
```

The entire project — server, agent, UI, CLI, PWA — uses only Node.js built-in modules: `node:crypto`, `node:fs`, `node:http`, `node:https`, `node:sqlite`, `node:test`, `node:assert`.

**Why?** Zero supply-chain risk. No CVEs from transitive deps. Air-gap deployable. Auditable by one person.

---

## Testing

833 tests across 31 suites. Zero external test frameworks.

```bash
node test/run-all.js          # All unit tests
node test/e2e-smoke.js        # Server integration tests
```

| Suite | Tests | Suite | Tests |
|-------|------:|-------|------:|
| Auth | 34 | Webhooks | 33 |
| Policy | 41 | Scheduler | 49 |
| Evaluations | 42 | Secret Scanner | 40 |
| Skills Hub | 40 | Gateway | 36 |
| Agents | 34+6 | Doctor | 34 |
| Channels | 33 | Onboarding | 33 |
| Crypto | 27 | Events | 23 |
| Users | 25 | Projects | 24 |
| Knowledge Graph | 23 | Tenants | 23 |
| Tasks | 32 | Config | 14 |
| Intent | 24 | Updater | 19 |
| Router | 21 | SQLite | 21 |
| Sandbox | 18 | Middleware | 11 |
| Receipts | 12 | ZIP | 11 |
| Security Profiles | 29 | E2E Smoke | 12 |

---

## Configuration

```bash
cp config/clawcc.config.example.json clawcc.config.json
# Edit to taste, then:
node control-plane/server.js
```

Key settings:

```jsonc
{
  "port": 3400,
  "mode": "local",                          // or "fleet"
  "dataDir": "./data",
  "auth": {
    "defaultAdminPassword": "changeme",     // CHANGE THIS
    "sessionSecret": "generate-a-32-byte-random-string"
  },
  "gateway": { "enabled": false },          // Multi-fleet federation
  "multiTenant": { "enabled": false }       // Tenant isolation
}
```

Generate a secure session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Security

FCC is hardened by default. See [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) for the full threat model.

| Layer | Controls |
|-------|----------|
| **Identity** | PBKDF2 (100K iter), TOTP MFA, recovery codes, API keys |
| **Authorization** | RBAC (4 roles), ABAC conditions, step-up auth, 4-eyes approval |
| **Transport** | HMAC-SHA256 request signing, nonce replay prevention, CORS |
| **Data** | Append-only JSONL, SHA-256 hash chains, Ed25519 signatures |
| **Headers** | CSP with nonces, HSTS, X-Frame-Options, Referrer-Policy |
| **Input** | 1MB body limit, 64KB event limit, ReDoS protection, path traversal prevention |
| **Secrets** | Automatic redaction in events, 14+ scanner patterns |
| **Compliance** | SOC 2, ISO 27001, NIST CSF control mappings ([COMPLIANCE_PACK.md](COMPLIANCE_PACK.md)) |

Report vulnerabilities via [GitHub Security Advisories](https://github.com/alokemajumder/FleetControlCenter/security/advisories). See [SECURITY.md](SECURITY.md).

---

## CLI

```bash
node cli/clawcc.js <command>

# Key commands:
node cli/clawcc.js status              # Fleet overview
node cli/clawcc.js sessions            # List all sessions
node cli/clawcc.js drift <sessionId>   # Check drift score
node cli/clawcc.js kill <target>       # Emergency kill
node cli/clawcc.js evidence <session>  # Export evidence ZIP
node cli/clawcc.js keygen              # Generate Ed25519 keys
node cli/clawcc.js verify-receipts     # Verify receipt chain
```

---

## Project Structure

```
FleetControlCenter/
  control-plane/
    server.js               Main server (31 modules, 24 route files)
    lib/                    31 library modules
    routes/                 24 route handlers
    middleware/             Auth + security middleware
  node-agent/               Agent daemon with offline spooling
  ui/                       SPA (21 pages, glassmorphic dark theme)
  cli/                      18 CLI commands
  pocket/                   Mobile PWA with push notifications
  test/                     833 tests across 31 suites
  config/                   Example configurations
  allowlists/               Command + path allowlists
  policies/                 Default governance rules
```

---

## Deployment

### Production Checklist

- [ ] Change the default admin password
- [ ] Generate a strong session secret
- [ ] Use HTTPS (directly or via reverse proxy)
- [ ] Restrict CORS origins to your domain
- [ ] Enable MFA for all admin accounts
- [ ] Consider Tailscale for node-to-control-plane encryption

### Node Agent

```bash
# On each machine with AI agents:
cp config/node-agent.config.example.json node-agent.config.json
# Set controlPlaneUrl and sharedSecret
node node-agent/agent.js
```

---

## Troubleshooting

**Server won't start?**
```bash
node --version              # Must be >= 18
lsof -i :3400               # Check port conflicts
```

**Agent can't connect?**
```bash
curl http://CONTROL_PLANE:3400/healthz    # Test connectivity
```

**MFA locked out?**
Use a recovery code, or have another admin reset MFA via the API.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions welcome — features, tests, docs, bug reports.

```bash
# Run tests before submitting a PR
node test/run-all.js && node test/e2e-smoke.js
```

---

## Roadmap

- [ ] Egress URL allowlisting
- [ ] Exportable session replay packs
- [ ] Grafana/Prometheus metrics export
- [ ] Plugin system for custom integrations

---

## License

[MIT](LICENSE) -- use it however you want.

---

<div align="center">

**Built for teams who run AI agents in production and need to sleep at night.**

[Report Bug](https://github.com/alokemajumder/FleetControlCenter/issues) | [Request Feature](https://github.com/alokemajumder/FleetControlCenter/issues) | [Security Advisory](https://github.com/alokemajumder/FleetControlCenter/security/advisories)

</div>
