# ClawCC Security Architecture

## 1. Overview

ClawCC follows a defense-in-depth design philosophy. Every layer -- from network transport to data storage -- implements independent security controls. The system assumes a hostile environment where any single component may be compromised, and enforces least-privilege access at every boundary.

All cryptographic operations use the Node.js `node:crypto` module exclusively. No external dependencies are used anywhere in the codebase.

---

## 2. Threat Model

### 2.1 Trust Boundaries

```
+-------------------+     +-------------------+     +-------------------+
|   Human Operator  |     |   Control Plane   |     |    Node Agent     |
|   (Browser/CLI)   |---->|   (server.js)     |<----|   (agent.js)      |
|                   |     |                   |     |                   |
|  Trust: Verified  |     |  Trust: High      |     |  Trust: Partial   |
|  via session +    |     |  Owns data store  |     |  HMAC-verified    |
|  MFA              |     |  and policy       |     |  requests only    |
+-------------------+     +-------------------+     +-------------------+
```

| Boundary | Controls |
|----------|----------|
| Operator -> Control Plane | Session cookie (HttpOnly, SameSite, Secure), RBAC, step-up MFA |
| Node Agent -> Control Plane | HMAC request signing, nonce replay prevention, shared secret |
| Control Plane -> Data Store | Append-only JSONL, hash chains, Ed25519 signatures |
| Control Plane -> Node Agent | Typed safe actions only (no shell), allowlist enforcement |

### 2.2 Attack Surfaces

| Surface | Mitigations |
|---------|-------------|
| HTTP API endpoints | Rate limiting, input validation, body size limits, auth middleware |
| Static file serving | Path traversal prevention, directory root checks, no listing |
| SSE event stream | Authenticated sessions only, no write capability |
| Agent registration | HMAC-signed requests with timestamp freshness check |
| Configuration files | Local filesystem only, no remote config fetching |

### 2.3 Threat Actors

| Actor | Capability | Mitigations |
|-------|-----------|-------------|
| Compromised Agent Node | Send malicious events, attempt command injection | HMAC verification, event validation, sandbox enforcement, tripwires |
| Malicious Insider (Operator) | Abuse privileges, tamper with logs | RBAC, 4-eyes approval, append-only audit, hash chains, step-up auth |
| Network Attacker | MITM, replay, eavesdropping | Tailscale encryption, HMAC nonces, HSTS, optional TLS |
| Unauthorized User | Brute force login, session hijacking | Account lockout, PBKDF2, secure cookies, session rotation |

---

## 3. Identity and Access Management

### 3.1 Password Hashing

- **Algorithm**: PBKDF2
- **Hash function**: SHA-512
- **Iterations**: 100,000
- **Key length**: 64 bytes
- **Salt**: 32 bytes, cryptographically random per user
- **Comparison**: `crypto.timingSafeEqual()` to prevent timing attacks
- **Storage**: `salt:hash` format in `data/users/users.json`
- **Implementation**: `control-plane/lib/crypto.js` -- `hashPassword()`, `verifyPassword()`

### 3.2 TOTP Multi-Factor Authentication

- **Standard**: RFC 6238 (TOTP)
- **Algorithm**: HMAC-SHA1 (per RFC)
- **Digits**: 6
- **Period**: 30 seconds
- **Window tolerance**: +/- 1 step (90-second validity)
- **Secret encoding**: Custom base32 (no external library)
- **Recovery codes**: 10 random codes generated on MFA setup
- **Implementation**: `control-plane/lib/crypto.js` -- `generateTOTPSecret()`, `generateTOTPCode()`, `verifyTOTPCode()`

### 3.3 Session Management

- **Token generation**: `crypto.randomBytes(32).toString('hex')` (256-bit entropy)
- **Storage**: In-memory Map (no session cookies stored server-side on disk)
- **TTL**: Configurable, default 24 hours
- **Rotation**: `rotateSession()` creates new token, invalidates old
- **Cookies**: `HttpOnly`, `SameSite=Strict`, `Secure` (when HTTPS), `Path=/api`
- **Cleanup**: Expired sessions removed on validation attempt

### 3.4 Role-Based Access Control (RBAC)

| Role | Permissions | Use Case |
|------|------------|----------|
| `viewer` | `read` | Read-only dashboard access |
| `operator` | `read`, `action` | Execute safe actions, manage sessions |
| `auditor` | `read`, `audit` | Read audit logs, export evidence |
| `admin` | `read`, `action`, `admin`, `audit` | Full access including user management |

### 3.5 Attribute-Based Access Control (ABAC)

Policy rules support ABAC conditions that are evaluated before the rule fires:

| Condition | Description | Example |
|-----------|-------------|---------|
| `env` | Restrict to specific environments | `["production", "staging"]` |
| `timeWindow` | Time-of-day and day-of-week restrictions | `{ "after": "09:00", "before": "17:00", "days": [1,2,3,4,5] }` |
| `minRiskScore` | Only fire when drift/risk score exceeds threshold | `30` |
| `nodeTags` | Require or forbid specific node tags | `{ "required": ["monitored"], "forbidden": ["exempt"] }` |
| `roles` | Restrict to specific user roles | `["admin", "operator"]` |

### 3.6 Step-Up Authentication

High-risk actions require MFA re-verification within a configurable time window (default 5 minutes):

- Kill switch activation (session, node, global)
- Policy modification
- Tripwire configuration changes
- Skill deployment
- User management

### 3.7 4-Eyes Approval Workflow

Critical operations can require approval from two independent administrators:

- Requester creates an approval request with action details
- A different user (cannot be the requester) must approve
- Configurable number of required approvals (default: 2)
- Approval requests expire after a configurable window (default: 1 hour)
- All approval actions are logged to the audit trail

---

## 4. Network Security

### 4.1 Tailscale-First Architecture

- Nodes connect over Tailscale mesh VPN by default
- WireGuard encryption for all node-to-control-plane traffic
- Tailscale ACLs can restrict which nodes access the control plane
- Agent discovery includes Tailscale IP and peer information

### 4.2 HMAC Request Signing

Node agents sign every request to the control plane:

```
Signature = HMAC-SHA256(
  sharedSecret,
  method + path + timestamp + SHA256(body)
)
```

- **Freshness**: Requests older than 5 minutes are rejected
- **Replay prevention**: Nonce tracker rejects duplicate nonces within the freshness window
- **Verification**: `control-plane/middleware/auth-middleware.js` -- `verifyNodeSignature()`

### 4.3 TLS Support

- Optional HTTPS mode with user-provided certificate and key
- HSTS header (`max-age=31536000; includeSubDomains`) when HTTPS is enabled
- Recommended: Use Tailscale for encryption, or place behind a reverse proxy with TLS termination

---

## 5. Data Security

### 5.1 Append-Only Audit Logs

- **Storage**: `data/audit/YYYY-MM-DD.jsonl`
- **File mode**: Append-only (`flag: 'a'`)
- **Hash chain**: Each entry includes `prevHash` linking to the previous entry
- **Fields**: `actor`, `action`, `target`, `detail`, `reason`, `before`, `after`, `timestamp`, `hash`, `prevHash`
- **Rotation**: Configurable retention period with `audit.rotate(dataDir, retentionDays)`

### 5.2 Receipt Ledger

- **Storage**: `data/receipts/receipts-YYYY-MM-DD.jsonl` (hash-chained)
- **Chain**: SHA-256 hash chain -- each receipt hashes `prevHash + dataHash`
- **Daily root**: Merkle-like root hash of all daily receipts, signed with Ed25519
- **Root storage**: `data/receipts/roots/YYYY-MM-DD.json`
- **Key persistence**: Ed25519 key pair stored in `data/receipts/keys.json`
- **Verification**: CLI (`clawcc verify`) and API (`/api/governance/receipts/verify`)
- **Export**: Evidence bundles include receipts, bundle hash, and Ed25519 signature

### 5.3 Secret Redaction

Events are automatically scrubbed before storage. Patterns matched:

- `password`, `token`, `secret`, `key`, `apiKey`, `api_key`
- `Bearer` tokens in string values
- Custom patterns configurable

### 5.4 Input Validation

- **Body size**: Configurable maximum (default 1MB), enforced in `parseBody()`
- **Content-Type**: JSON only for API endpoints
- **Event payloads**: 64KB maximum, required fields validated (type, severity, nodeId, timestamp)
- **Severity levels**: Restricted to `info`, `warning`, `error`, `critical`

---

## 6. Action Sandbox

### 6.1 Command Allowlist

Only explicitly allowed commands can be executed on agent nodes:

- Commands defined in `allowlists/commands.json` with allowed arguments
- Argument constraints: `allowed` (whitelist) and `disallowed` (blacklist) patterns
- No shell interpretation -- commands executed via `execFileSync` (not `exec`)
- Output truncated to 64KB

### 6.2 Path Security

- **Allowlist**: Only files within declared paths are accessible
- **Canonicalization**: `path.resolve()` normalizes all paths before checking
- **Traversal prevention**: Raw input checked for `..` sequences before resolution
- **Symlink resolution**: `fs.realpathSync()` follows symlinks and verifies the real target is within allowed paths
- **Protected paths**: Require explicit approval flag for access
- **Forbidden paths**: Hard-blocked with no override

### 6.3 Implementation

- `node-agent/lib/sandbox.js` -- `createSandbox()` factory with `validateCommand()`, `isPathAllowed()`, `checkSymlink()`, `validateFileOperation()`
- `allowlists/commands.json` -- 8 default allowed commands (ls, cat, echo, grep, find, head, tail, wc)
- `allowlists/paths.json` -- Allowed (`/tmp`, workspace), protected (`/etc`), forbidden (`/root`, `/proc`)

---

## 7. Security Headers

Applied to all HTTP responses via `control-plane/middleware/security.js`:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS only) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `0` (modern CSP preferred) |

### Rate Limiting

- **Algorithm**: Sliding window per IP address
- **Default**: 100 requests per 60 seconds
- **Response**: HTTP 429 with JSON error body
- **Configurable**: `security.rateLimitWindowMs` and `security.rateLimitMaxRequests` in config

---

## 8. Tripwires and Honeytokens

### 8.1 Configuration

Defined in `tripwires/default.tripwires.json`:

- **File honeytokens**: Decoy paths that trigger on access (e.g., `/etc/shadow`, `.env.production`)
- **URL honeytokens**: Decoy URLs that trigger on request
- **Secret honeytokens**: Decoy credentials that trigger on use
- **Path honeytokens**: Decoy filesystem paths that trigger on traversal

### 8.2 Auto-Quarantine

When a `tripwire.triggered` event is ingested:

1. The associated session is immediately ended (severity: critical)
2. The associated node is quarantined
3. A receipt is created for the quarantine action (evidence preservation)
4. An audit log entry records the auto-quarantine
5. All actions are attributed to `system` actor

### 8.3 Evidence Preservation

Tripwire triggers automatically create:
- Event records (session.ended, node.quarantined)
- Receipt ledger entries
- Audit trail entries
- Evidence available for export via `/api/governance/evidence/export`

---

## 9. Signed Skills

### 9.1 Verification

Before deploying a skill to the fleet:

1. The deployment request must include `signature`, `publicKey`, and `bundle` fields
2. The Ed25519 signature is verified against the bundle content
3. If the skill is marked as `signed` in the registry and no signature is provided, deployment is rejected
4. Signature verification can be disabled per-environment via `skills.requireSignature: false`

### 9.2 Canary Rollout

Skills can be deployed to a subset of nodes before full fleet rollout:

- Specify `canary: true` and `canaryNodes: [...]` in the deploy request
- Events are emitted per canary node with `phase: "canary"`
- Monitor drift scores and error rates on canary nodes before promoting to full deployment
- Rollback available via `/api/governance/skills/:id/rollback`

---

## 10. Compliance Controls

### 10.1 Audit Trail Completeness

Every state-changing operation produces an audit entry with:
- Who (actor username)
- What (action type)
- Where (target resource)
- When (ISO 8601 timestamp)
- Before/after state (for modifications)
- Reason (for destructive actions)
- Hash chain link (tamper evidence)

### 10.2 Evidence Export

- JSON evidence bundles with Ed25519 signature
- Bundle includes receipts, chain hashes, and verification data
- CLI verifier (`clawcc verify`) for offline integrity checking
- API endpoint (`/api/governance/evidence/verify`) for programmatic verification

### 10.3 Access Review

- `GET /api/governance/access-review` lists all users with roles, MFA status, and creation dates
- Requires `audit:read` permission (auditor or admin role)

See [COMPLIANCE_PACK.md](COMPLIANCE_PACK.md) for detailed control mappings to SOC 2, ISO 27001, and NIST CSF.
