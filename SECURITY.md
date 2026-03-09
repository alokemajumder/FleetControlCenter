# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ClawCC, **do not open a public issue.** Security vulnerabilities must be reported privately to allow time for a fix before public disclosure.

### How to Report

Use [GitHub Security Advisories](https://github.com/alokemajumder/clawcc/security/advisories) to submit a private report. Include:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Impact assessment** -- what an attacker could achieve
4. **Affected versions** (or "all" if unknown)
5. **Suggested fix** (if you have one)

### Response Timeline

| Step | Timeframe |
|------|-----------|
| Acknowledgment of report | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix development and testing | Depends on severity |
| Security advisory published | At time of fix release |

### Severity Classification

| Severity | Description | Examples |
|----------|-------------|---------|
| Critical | Remote code execution, authentication bypass, data exfiltration | Command injection, session fixation |
| High | Privilege escalation, significant data exposure | RBAC bypass, audit log tampering |
| Medium | Limited impact requiring specific conditions | CSRF, information disclosure |
| Low | Minimal impact, defense-in-depth improvements | Missing headers, verbose errors |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x (current) | Yes |

## Security Architecture

For a comprehensive overview of ClawCC's security controls, threat model, and defense-in-depth design, see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md).

Key security features:
- PBKDF2 password hashing (100K iterations, SHA-512)
- TOTP multi-factor authentication with recovery codes
- HMAC-SHA256 request signing with nonce replay prevention
- Ed25519 digital signatures for receipt chains
- Append-only audit logging with SHA-256 hash chains
- Automatic secret redaction in event payloads
- CSP nonces, rate limiting, input validation
- Zero external dependencies (no supply chain risk)

## Security-Related Configuration

When deploying ClawCC, ensure:

1. **Change the default admin password** -- the server refuses to start in production mode with the default.
2. **Generate a strong session secret** -- `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. **Use HTTPS** -- either directly or via a reverse proxy (nginx, Caddy).
4. **Restrict CORS origins** -- set `security.corsOrigins` to your domain(s).
5. **Use Tailscale** -- for encrypted node-to-control-plane communication.
6. **Enable MFA** -- for all admin and operator accounts.

## Acknowledgments

We appreciate the security research community and will acknowledge reporters in security advisories (unless they prefer anonymity).
