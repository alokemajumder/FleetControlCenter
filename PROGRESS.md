# Fleet Control Center Project Progress

> **Last updated:** 2026-03-20
> **Test results:** 833 tests passing across 31 suites (0 failures)
> **External dependencies:** 0 (Node.js standard library only)
> **Data layer:** Hybrid -- JSONL source of truth + in-memory index + optional SQLite acceleration (node:sqlite)
> **Supported agents:** 23 types across 16 providers including [NVIDIA NemoClaw](https://build.nvidia.com/nemoclaw), [OpenShell](https://docs.nvidia.com/openshell/latest/index.html), and [Nemotron](https://developer.nvidia.com/nemotron)

---

## Overall Completion Summary

| Area                           | Status   | Completion |
| ------------------------------ | -------- | ---------- |
| Hard Constraints               | Met      | 100%       |
| Monorepo Structure             | Complete | 100%       |
| Core Events and Receipts       | Complete | 100%       |
| Feature Scope (Baseline)       | Complete | 100%       |
| Advanced Features              | Complete | 100%       |
| FCC Shield (Security)          | Complete | 100%       |
| Configuration                  | Complete | 100%       |
| Testing                        | Complete | 100%       |
| Documentation                  | Complete | 100%       |
| Acceptance Criteria            | Complete | 100%       |

---

## Hard Constraints

These constraints are non-negotiable and fully satisfied.

| #   | Constraint                                         | Status   | Notes                                              |
| --- | -------------------------------------------------- | -------- | -------------------------------------------------- |
| 1   | Node.js runtime, no heavy frameworks, static UI   | Complete | All vanilla JS/CSS/HTML, zero npm dependencies     |
| 2   | No external DB, append-only JSONL with snapshots   | Complete | data/events/*.jsonl, data/snapshots/*.json, optional SQLite acceleration |
| 3   | SSE for real-time communication                    | Complete | GET /api/events/stream with filters and keepalive  |
| 4   | Tailnet-first networking (Tailscale)               | Complete | Discovery, status JSON, peers visibility           |
| 5   | Security hardened by default (FCC Shield)            | Complete | See the Shield section below                       |
| 6   | Typed safe actions only, no remote shell           | Complete | Allowlisted commands, arguments, and path sandbox  |

---

## Monorepo Packages

| Package        | Files | Status   | Notes                                                           |
| -------------- | ----- | -------- | --------------------------------------------------------------- |
| /control-plane | 55    | Complete | Server, router, 2 middleware, 24 route groups, 31 library modules |
| /node-agent    | 5     | Complete | Daemon, discovery, telemetry, sandbox, spool                    |
| /ui            | 6     | Complete | Static SPA with glassmorphic dark theme, 21 pages               |
| /cli           | 1     | Complete | 20 commands with ANSI colors and table formatting               |
| /pocket        | 3     | Complete | PWA shell, manifest, service worker                             |
| /termux        | 2     | Complete | Setup script and README                                         |
| /config        | 2     | Complete | Example configs for control plane and node agent                |
| /allowlists    | 2     | Complete | commands.json and paths.json                                    |
| /policies      | 1     | Complete | default.policy.json with rules                                  |
| /tripwires     | 1     | Complete | Honeytoken definitions                                          |
| /skills        | 1     | Complete | Registry JSON with canary configuration                         |
| /scripts       | 1     | Complete | Demo data generator (30 days, 3 nodes, 16 providers, ~225 sessions) |
| /test          | 34    | Complete | 31 suites plus runner, 833 tests, all passing                   |

---

## Testing

| Test Suite        | Tests | Status | File                                          |
| ----------------- | ----- | ------ | --------------------------------------------- |
| Crypto            | 27    | Pass   | test/auth/crypto.test.js                      |
| Auth              | 34    | Pass   | test/auth/auth.test.js                        |
| Sandbox           | 18    | Pass   | test/sandbox/sandbox.test.js                  |
| Policy            | 41    | Pass   | test/policy/policy.test.js                    |
| Receipts          | 12    | Pass   | test/receipts/receipts.test.js                |
| Events            | 23    | Pass   | test/events/events.test.js                    |
| Intent            | 24    | Pass   | test/intent/intent.test.js                    |
| Middleware        | 11    | Pass   | test/middleware/auth-middleware.test.js        |
| Router            | 21    | Pass   | test/router/router.test.js                    |
| ZIP               | 11    | Pass   | test/zip/zip.test.js                          |
| SQLite            | 21    | Pass   | test/sqlite/sqlite-store.test.js              |
| E2E Smoke         | 12    | Pass   | test/e2e-smoke.js                             |
| Doctor            | 34    | Pass   | test/doctor/doctor.test.js                    |
| Gateway           | 36    | Pass   | test/gateway/gateway.test.js                  |
| Agents            | 34    | Pass   | test/agents/agents.test.js                    |
| Agent SOUL        | 6     | Pass   | test/agents/soul.test.js                      |
| Channels          | 33    | Pass   | test/channels/channels.test.js                |
| Onboarding        | 33    | Pass   | test/onboarding/onboarding.test.js            |
| Knowledge Graph   | 23    | Pass   | test/knowledge/knowledge-graph.test.js        |
| Tenants           | 23    | Pass   | test/tenants/tenants.test.js                  |
| Webhooks          | 33    | Pass   | test/webhooks/webhooks.test.js                |
| Tasks             | 32    | Pass   | test/tasks/tasks.test.js                      |
| Claude Integration| 21    | Pass   | test/claude-integration/claude-integration.test.js |
| Skills Hub        | 40    | Pass   | test/skills-hub/skills-hub.test.js            |
| Evaluations       | 42    | Pass   | test/evaluations/evaluations.test.js          |
| Updater           | 19    | Pass   | test/updater/updater.test.js                  |
| Scheduler         | 49    | Pass   | test/scheduler/scheduler.test.js              |
| Users             | 25    | Pass   | test/users/users.test.js                      |
| Projects          | 24    | Pass   | test/projects/projects.test.js                |
| Config Manager    | 14    | Pass   | test/config-manager/config-manager.test.js    |
| Security Profiles | 29    | Pass   | test/security/security-profiles.test.js       |
| Secret Scanner    | 40    | Pass   | test/security/secret-scanner.test.js          |
| **Total**         | **833** | **All pass** |                                        |

### Test Coverage Details

| Suite      | Coverage                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crypto     | PBKDF2 hashing and verification, TOTP generation and verification, HMAC signing and replay, Ed25519 sign and verify, hash chain integrity, nonce tracker, recovery codes (timing-safe)     |
| Auth       | User CRUD, login, lockout (5 attempts), session lifecycle, RBAC permission checks, MFA setup/enable/verify, MFA-pending session blocking, password change, session rotation                |
| Sandbox    | Command allowlist validation, argument constraints, path traversal prevention, symlink resolution, forbidden and protected paths                                                            |
| Policy     | Rule evaluation (eq/neq/gt/gte/lt/lte/matches/contains), drift scoring, enforcement ladder, simulation, ABAC conditions (env, timeWindow, minRiskScore, nodeTags, roles), ReDoS protection, regex cache limits |
| Receipts   | Hash chain creation and verification, Ed25519 signing, bundle export and verify                                                                                                            |
| Events     | Event ingestion, secret redaction (password/token/key/Bearer), payload size limits (64KB), subscriber notifications, query filtering                                                       |
| Intent     | Intent contract creation and validation, drift score computation (5 factors), session ID validation (path traversal rejection)                                                              |
| Middleware | Session authentication, MFA-pending blocking, node HMAC signature verification, nonce replay detection, default-secret rejection                                                           |
| Router     | Route matching with :params, query string parsing, cookie parsing (safe URI decode), setCookie with options, 404 handling                                                                  |
| ZIP        | ZIP file format correctness, CRC-32 computation, multi-file entries, input validation                                                                                                      |
| SQLite     | Store creation and graceful fallback, event indexing and dedup, compound query filters, date range queries, limit/offset, heatmap aggregation, rolling usage aggregation, audit entry indexing, JSONL catch-up (full and incremental), event count, close |
| E2E Smoke  | Full server start and stop, login flow, /api/auth/me, security headers (CSP, X-Frame-Options), static file serving, /healthz, 404 JSON responses                                          |
| Doctor     | 12 diagnostic checks (config, data-dir, HMAC, admin password, TLS, event/receipt/audit chain integrity, disk, SQLite, memory, stale sessions), fix application, backup CRUD, restore       |
| Gateway    | Upstream CRUD, health checks, proxy requests, fan-out aggregation, persistence, circuit states                                                                                              |
| Agents     | Agent registration, heartbeat, stale detection, fleet summary, event recording, timeline, SOUL file CRUD, disk sync                                                                         |
| Channels   | Channel CRUD (broadcast/direct/group), message send/receive, JSONL persistence, member management, SSE subscriber notifications                                                             |
| Onboarding | 7-step wizard flow, input validation per step, skip rules, completion, security scan integration, reset                                                                                     |
| Knowledge  | Node/edge CRUD, BFS traversal, neighbor filtering, subgraph extraction, connected components, capacity limits, event ingestion                                                              |
| Tenants    | Tenant CRUD, slug validation, status lifecycle, quota checking, scoped data dirs, search, persistence                                                                                       |
| Webhooks   | Webhook CRUD, event dispatch, HMAC-SHA256 signing, delivery persistence, retry with backoff, circuit breaker (closed/open/half-open)                                                        |
| Tasks      | Kanban CRUD, status transitions, assignment, comments, search, archive, capacity limits                                                                                                     |
| Claude Int.| Session discovery, JSONL parsing, project listing, memory reading, path traversal prevention, secret redaction                                                                               |
| Skills Hub | Skill CRUD, security scanning (5 checks), install/uninstall, registry bootstrap, version tracking, quarantine                                                                               |
| Evaluations| 4-layer eval (output/trace/component/drift), quality gates, baselines, scorecards, optimization hints, fleet aggregation                                                                    |
| Updater    | Semver comparison, version check via HTTP, cache TTL, self-update readiness, changelog parsing, version history                                                                             |
| Scheduler  | NL-to-cron parsing (20+ patterns), cron evaluation, job CRUD, tick execution, history tracking, pause/resume                                                                                |
| Users      | User listing, role assignment, enable/disable, API key CRUD (SHA-256 hashed), activity tracking, disabled-user blocking                                                                     |
| Projects   | Project CRUD, agent/session assignment, search, archive/activate, persistence                                                                                                               |
| Config Mgr | Config export (secret redacted), import, validation, diff, schema, reset to defaults                                                                                                        |
| Sec Profiles| Three profiles (minimal/standard/strict), custom CRUD, event evaluation, security event recording, stats                                                                                    |
| Sec Scanner| 14+ regex patterns (AWS, GitHub, Stripe, JWT, PEM, DB URI, Slack, etc.), scan/scanObject/scanFile, masking, custom patterns, severity levels                                                |

---

## Feature Scope

### Fleet and Session Management

| Feature                                              | Status   |
| ---------------------------------------------------- | -------- |
| Fleet node list (online/offline, heartbeat, OS, tags, IP) | Complete |
| Session list across fleet                            | Complete |
| Search and filtering (status/model/node/tags)        | Complete |
| Timeline view per session                            | Complete |
| Side-by-side session compare                         | Complete |

### Real-Time Observability (SSE)

| Feature                                              | Status   |
| ---------------------------------------------------- | -------- |
| Live feed stream (fleet-wide)                        | Complete |
| Filters: node, session, provider, tool, severity     | Complete |
| Follow session with pause and resume                 | Complete |
| Activity heatmap (30 days)                           | Complete |
| Streak tracking                                      | Complete |

### Usage and Cost

| Feature                                              | Status   |
| ---------------------------------------------------- | -------- |
| Provider usage tracking (any LLM provider)           | Complete |
| Rolling windows per provider (1h/24h/7d)             | Complete |
| Usage alerts (cost, tokens, error rate)              | Complete |
| Cost breakdown by model, session, and node           | Complete |

### Memory, Workspace, and Git

| Feature                                              | Status   |
| ---------------------------------------------------- | -------- |
| Memory viewer (MEMORY.md, HEARTBEAT.md)              | Complete |
| Secure file manager (allowlisted paths)              | Complete |
| Diff-before-save with audit hashes                   | Complete |
| Git activity (commits and dirty state)               | Complete |

### Ops Control

| Feature                                              | Status   |
| ---------------------------------------------------- | -------- |
| System health (CPU/RAM/disk with 24h history)        | Complete |
| Log viewer                                           | Complete |
| Cron management with run history                     | Complete |
| Tailscale network status                             | Complete |

---

## Differentiating Features

| Feature                                                    | Status   |
| ---------------------------------------------------------- | -------- |
| Intent contracts with drift scoring (5 factors, 0--100)    | Complete |
| Policy simulation lab                                      | Complete |
| Digital twin replay with scrubber                          | Complete |
| Living topology, blast radius, and causality explorer      | Complete |
| Zero-trust action sandbox (execFileSync with allowlists)   | Complete |
| Tripwires and honeytokens with auto-quarantine             | Complete |
| Signed skills registry with canary rollout and auto-rollback | Complete |
| Tamper-evident receipt ledger with verification            | Complete |
| Mobile ops (Pocket PWA) with push notifications            | Complete |
| Evidence export (ZIP with Ed25519 signature)               | Complete |

### Fleet Operations (Phase 1--6)

| Feature                                                    | Status   |
| ---------------------------------------------------------- | -------- |
| Doctor diagnostics (12 checks) with auto-fix               | Complete |
| Backup and restore with manifests                          | Complete |
| Gateway federation (multi-fleet proxy and aggregation)     | Complete |
| Agent tracker (23 types, heartbeat, stale detection)       | Complete |
| Agent SOUL files (personality/behavior markdown)           | Complete |
| Channels (broadcast/direct/group) with SSE                 | Complete |
| Onboarding wizard (7-step guided setup)                    | Complete |
| Knowledge graph (force-directed, BFS, connected components)| Complete |
| Multi-tenant isolation with quotas                         | Complete |

### Platform Features (Gap-Closing)

| Feature                                                    | Status   |
| ---------------------------------------------------------- | -------- |
| Webhooks with HMAC signing and circuit breaker             | Complete |
| Kanban task board with enforced transitions                | Complete |
| Local tool integration (session/project/memory discovery)  | Complete |
| Skills hub with security scanning (5 checks)              | Complete |
| Agent evaluation framework (4-layer, quality gates)       | Complete |
| Update checker with self-update support                    | Complete |
| Natural language scheduler (NL to cron)                   | Complete |
| User management with API keys                             | Complete |
| Project management with agent assignment                  | Complete |
| Config export/import with secret redaction                 | Complete |
| Security profiles (minimal/standard/strict)               | Complete |
| Secret scanner (14+ patterns, severity levels)            | Complete |

---

## FCC Shield: Security and Compliance

### Identity and Access Management

| Item                                                                                 | Status   |
| ------------------------------------------------------------------------------------ | -------- |
| Users persisted to disk (data/users/users.json)                                     | Complete |
| PBKDF2 hashing (100K iterations, SHA-512, 64-byte key, 32-byte salt)                | Complete |
| TOTP MFA (RFC 6238, base32, 6-digit, +/-1 step window)                              | Complete |
| Recovery codes (SHA-256 hashed, timing-safe verification)                            | Complete |
| Secure cookies (HttpOnly, SameSite=Lax, Secure, Path=/)                             | Complete |
| MFA-pending session lifecycle (5-min TTL, blocked from all endpoints except MFA verify) | Complete |
| Session rotation and expiry                                                          | Complete |
| RBAC: viewer, operator, auditor, admin                                               | Complete |
| ABAC conditions (env, timeWindow, minRiskScore, nodeTags, roles)                     | Complete |

### Step-Up Authentication and 4-Eyes Approvals

| Item                                                             | Status   |
| ---------------------------------------------------------------- | -------- |
| Step-up MFA re-check (5-min window)                              | Complete |
| 4-eyes approval (self-approve prevention, 1-hour expiry, 1K cap) | Complete |
| Kill switch requires admin with step-up                          | Complete |
| Policy, tripwire, and skill changes require admin with step-up   | Complete |

### Audit Logging

| Item                                                         | Status   |
| ------------------------------------------------------------ | -------- |
| Append-only audit log (async writes, error handling)         | Complete |
| SHA-256 hash chain within each day                           | Complete |
| Who, what, where, before, after, and reason fields           | Complete |
| Rotation and retention (configurable)                        | Complete |
| Query cap (10K max per query)                                | Complete |

### Network Security

| Item                                               | Status   |
| -------------------------------------------------- | -------- |
| HMAC-SHA256 request signing                        | Complete |
| Nonce replay prevention (5-min window)             | Complete |
| Default-secret rejection                           | Complete |
| Per-node secrets (fleet.nodeSecrets)               | Complete |
| Timing-safe signature comparison                   | Complete |
| CORS (configurable origins, OPTIONS preflight)     | Complete |

### Secure-by-Default Headers and Input Validation

| Item                                                                             | Status   |
| -------------------------------------------------------------------------------- | -------- |
| CSP with per-request nonces (script-src and style-src)                           | Complete |
| HSTS when HTTPS is enabled                                                       | Complete |
| X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy     | Complete |
| Input validation and size limits (1MB body, 64KB events)                         | Complete |
| Path traversal protection (canonicalization, symlink resolution)                 | Complete |
| Session ID validation (rejects ../ and non-alphanumeric characters)              | Complete |
| Safe URI decoding (try/catch in cookies and route params)                        | Complete |
| Config validation (port range, HTTPS cert paths)                                 | Complete |
| ReDoS protection (200-char limit, dangerous pattern detection, 1K cache)         | Complete |

### Data Integrity

| Item                                                                                | Status   |
| ----------------------------------------------------------------------------------- | -------- |
| Async write queue with backpressure logging                                         | Complete |
| Atomic file writes (write-to-tmp-then-rename) for users, policies, and tripwires    | Complete |
| Event cap (500K in-memory, oldest 10% evicted)                                      | Complete |
| Session eviction (50K cap, 30-day expiry for ended sessions)                        | Complete |
| Rate limit map eviction (10K IP cap)                                                | Complete |
| Regex cache cap (1K patterns)                                                       | Complete |

---

## Configuration

| Config File                      | Status   |
| -------------------------------- | -------- |
| clawcc.config.example.json       | Complete |
| node-agent.config.example.json   | Complete |
| allowlists/commands.json         | Complete |
| allowlists/paths.json            | Complete |
| policies/default.policy.json     | Complete |
| tripwires/default.tripwires.json | Complete |
| skills/registry.json             | Complete |

---

## Documentation

| Document                   | Status   |
| -------------------------- | -------- |
| README.md                  | Complete |
| SECURITY_ARCHITECTURE.md   | Complete |
| COMPLIANCE_PACK.md         | Complete |
| PROGRESS.md                | Complete |
| termux/README.md           | Complete |

---

## Acceptance Criteria

| #   | Criterion                                                                | Status   |
| --- | ------------------------------------------------------------------------ | -------- |
| 1   | Local mode: sessions, feed, usage, memory, health, logs, cron, Tailscale | Complete |
| 2   | Fleet mode: enroll 3+ nodes, health, sessions, SSE                       | Complete |
| 3   | High-risk actions require step-up auth; all actions are auditable        | Complete |
| 4   | Kill switch works (scoped and global) with evidence bundle               | Complete |
| 5   | Policy simulation lab: replay and show blocked step                      | Complete |
| 6   | Signed skill canary rollout with auto-rollback                           | Complete |
| 7   | Tripwires trigger quarantine and evidence export                         | Complete |
| 8   | Receipt ledger verifier CLI confirms integrity                           | Complete |
| 9   | UI: keyboard-first, responsive, SSE reconnection                         | Complete |

---

## Remaining Backlog

| Priority | Item                                              | Status                                   |
| -------- | ------------------------------------------------- | ---------------------------------------- |
| Low      | Egress allowlist for outbound URLs                | Not started                              |
| Low      | Configurable output redaction patterns            | Partial (secret scanner covers key patterns) |
| Low      | Replay packs (exportable session replays)         | Not started                              |
| Low      | Detailed verification manifest in evidence bundles | Not started                              |
