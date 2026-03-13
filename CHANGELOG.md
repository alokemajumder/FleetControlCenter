# Changelog

All notable changes to Fleet Control Center are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-12

### Added

#### Fleet Operations
- Doctor diagnostics engine with 12 system health checks and 4 auto-fixable issues.
- Backup and restore manager with timestamped directories and JSON manifests.
- Gateway federation mode for multi-fleet proxy and fan-out aggregation with health checks.
- Agent tracker supporting 7 agent types with heartbeat, stale detection, and fleet summary.
- Agent SOUL files (personality/behavior markdown) with disk sync and per-agent CRUD.
- Channels subsystem (broadcast/direct/group) with JSONL persistence and SSE notifications.
- 7-step onboarding wizard with per-step validation and security scan integration.
- Knowledge graph with force-directed layout, BFS traversal, and connected components.
- Multi-tenant isolation with slug-based routing, quotas, and scoped data directories.

#### Platform Features
- Webhooks with HMAC-SHA256 signing, exponential backoff retry, and circuit breaker pattern.
- Kanban task board with 6 columns, enforced status transitions, and comments.
- Local tool integration for session/project/memory discovery with path traversal prevention.
- Skills hub with 5-point security scanning, install/uninstall, and quarantine support.
- Agent evaluation framework with 4-layer scoring, quality gates, baselines, and fleet scorecards.
- Update checker with GitHub release polling, semver comparison, and self-update readiness.
- Natural language scheduler parsing 20+ patterns to cron expressions with job management.
- User management with API key authentication (SHA-256 hashed), role assignment, and activity tracking.
- Project management with agent assignment, session linking, and search.
- Config export/import with automatic secret redaction, validation, and diff.
- Security profiles (minimal/standard/strict) with custom profile CRUD and event evaluation.
- Secret scanner with 14+ regex patterns (AWS, GitHub, Stripe, JWT, PEM, etc.) and severity levels.

#### UI
- Expanded from 7 to 21 pages: added Doctor, Gateway, Agents, Channels, Tasks, Knowledge Graph, Tenants, Skills Hub, Evaluations, Scheduler, Projects, Users, Config, Security.
- Kanban board with drag-and-drop-style status transitions.
- Force-directed knowledge graph visualization (vanilla SVG).
- Chat UI for agent channels with SSE streaming.
- Security posture dashboard with profile selector and secret scanner.

#### Testing
- 578 new tests across 19 new suites (833 total tests, 31 suites, all passing).

### Changed
- Rebranded user-facing strings from "ClawCC" to "Fleet Control Center" / "FCC".
- Updated all GitHub URLs to `github.com/alokemajumder/FleetControlCenter`.
- Webhook headers renamed from `X-ClawCC-*` to `X-FCC-*`.
- Auth middleware now supports API key authentication via `Authorization: Bearer` and `X-API-Key` headers.
- Server.js expanded to initialize 31 modules with 24 route files and full graceful shutdown.

## [0.1.1] - 2026-03-11

### Added

- Optional SQLite acceleration layer (`node:sqlite`, Node.js 22+) for faster compound queries, heatmap aggregation, rolling usage, and audit log searches. JSONL remains the tamper-evident source of truth; SQLite is a derived, always-rebuildable acceleration layer.
- Incremental SQLite catch-up from JSONL on boot (only processes new events since last run).
- SQLite WAL mode for concurrent read performance.
- 21 new tests for the SQLite store (255 total tests across 12 suites, all passing).

### Fixed

- Case-sensitive admin role checks across 8 route handlers (fleet-routes, kill-switch, governance-routes) that could allow privilege escalation with mixed-case roles. All now use case-insensitive comparison.
- Snapshots missing timestamp fallback: `processEvent()` now uses `event.ts || event.timestamp` instead of only `event.ts`, preventing undefined activity timestamps.
- Receipt bundle verification now checks the first receipt's `prevHash` instead of skipping it, closing a potential chain tampering gap.

## [0.1.0] - 2026-03-09

### Added

#### Core Platform

- Control plane server with custom HTTP router, middleware pipeline, and static file serving.
- Append-only JSONL event store with daily rotation and async serialized write queue.
- Hybrid in-memory index layer rebuilt from JSONL on boot with O(1) lookups.
- SSE real-time event streaming with filters, keepalive, and max 1-hour lifetime.
- Session management with timeline, replay, blast radius, and side-by-side comparison.
- Interactive SVG topology graph with hover tooltips and click-to-detail.
- Activity heatmap (30-day) and streak tracking.
- Causality explorer for tracing file and tool references across sessions.
- Usage tracking with rolling windows (1h/24h/7d) and configurable alerts.
- Graceful shutdown with connection draining, snapshot flushing, and write queue completion.

#### Security

- PBKDF2 password hashing (100K iterations, SHA-512, 64-byte key).
- TOTP MFA (RFC 6238) with recovery codes and MFA-pending session lifecycle.
- HMAC-SHA256 request signing with nonce replay prevention and timestamp freshness.
- Ed25519 digital signatures for receipt chains and evidence bundles.
- RBAC (viewer/operator/auditor/admin) with ABAC conditions.
- Step-up authentication for high-risk operations.
- 4-eyes approval workflow with self-approve prevention.
- CSP nonces (per-request), security headers, rate limiting, and request timeouts.
- Automatic secret redaction in event payloads (key-name and Bearer token detection).
- Zero-trust action sandbox with command and path allowlists and symlink resolution.
- ReDoS protection with pattern length limits and dangerous construct detection.

#### Governance and Compliance

- Policy engine with rule evaluation, drift scoring (5 factors), and enforcement ladders.
- Intent contracts with session-level drift computation.
- Tripwires and honeytokens with auto-quarantine on trigger.
- Signed skills registry with Ed25519 verification and canary rollout.
- Tamper-evident receipt ledger with SHA-256 hash chains and daily Ed25519 root signing.
- Append-only audit logging with SHA-256 hash chains.
- Evidence export as ZIP bundles with Ed25519 signatures.
- Access review endpoint for compliance auditing.
- SOC 2, ISO 27001, and NIST CSF control mappings documented.

#### Clients

- Web UI: single-page application with glassmorphic dark theme and keyboard shortcuts.
- CLI: 20 commands for fleet management, policy simulation, drift detection, and evidence export.
- Pocket PWA: mobile-optimized interface with push notifications and offline caching.
- Termux: Android deployment script and documentation.

#### Node Agent

- Daemon with HMAC-signed registration and heartbeats.
- Session and workspace discovery with secret redaction.
- Health telemetry (CPU, RAM, disk).
- Offline event spooling with replay on reconnect.
- Sandbox enforcement with command and path allowlists.

#### Infrastructure

- Zero external dependencies -- Node.js stdlib only.
- Tailscale mesh VPN integration for node discovery.
- 255 tests across 12 suites (11 unit + 1 E2E), all passing.
- Example configurations for control plane and node agent.
- Demo data generator (30 days, 3 nodes, 14 providers, ~225 sessions).

[0.2.0]: https://github.com/alokemajumder/FleetControlCenter/releases/tag/v0.2.0
[0.1.1]: https://github.com/alokemajumder/FleetControlCenter/releases/tag/v0.1.1
[0.1.0]: https://github.com/alokemajumder/FleetControlCenter/releases/tag/v0.1.0
