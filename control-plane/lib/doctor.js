'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

function createDoctor(opts = {}) {
  const config = opts.config || {};
  const dataDir = opts.dataDir || config.dataDir || './data';
  const authManager = opts.authManager || null;
  const receiptStore = opts.receiptStore || null;
  const eventStore = opts.eventStore || null;
  const snapshots = opts.snapshots || null;

  const checks = new Map();
  const fixes = new Map();

  // ── Check: config-valid ──
  checks.set('config-valid', {
    id: 'config-valid',
    name: 'Configuration valid',
    run() {
      const missing = [];
      if (!config.port) missing.push('port');
      if (!config.dataDir && !dataDir) missing.push('dataDir');
      if (!config.sessionSecret && !config.hmacSecret) missing.push('hmacSecret/sessionSecret');
      if (missing.length > 0) {
        return { id: 'config-valid', name: 'Configuration valid', status: 'fail', message: 'Missing required fields: ' + missing.join(', '), fixable: false };
      }
      return { id: 'config-valid', name: 'Configuration valid', status: 'pass', message: 'All required configuration fields present', fixable: false };
    }
  });

  // ── Check: data-dir-writable ──
  checks.set('data-dir-writable', {
    id: 'data-dir-writable',
    name: 'Data directory writable',
    run() {
      const dir = path.resolve(dataDir);
      try {
        fs.accessSync(dir, fs.constants.W_OK);
        return { id: 'data-dir-writable', name: 'Data directory writable', status: 'pass', message: 'Data directory exists and is writable: ' + dir, fixable: false };
      } catch {
        return { id: 'data-dir-writable', name: 'Data directory writable', status: 'fail', message: 'Data directory missing or not writable: ' + dir, fixable: true, fixId: 'data-dir-writable' };
      }
    }
  });

  fixes.set('data-dir-writable', {
    id: 'data-dir-writable',
    fix() {
      const dir = path.resolve(dataDir);
      fs.mkdirSync(dir, { recursive: true });
      return { success: true, message: 'Created data directory: ' + dir };
    }
  });

  // ── Check: hmac-not-default ──
  checks.set('hmac-not-default', {
    id: 'hmac-not-default',
    name: 'HMAC secret changed from default',
    run() {
      const secret = config.sessionSecret || config.hmacSecret || '';
      const defaults = ['change-me-in-production', 'CHANGE_ME_GENERATE_WITH_openssl_rand_hex_32', 'default-secret', ''];
      if (defaults.includes(secret)) {
        return { id: 'hmac-not-default', name: 'HMAC secret changed from default', status: 'warn', message: 'HMAC/session secret is still set to a default value', fixable: true, fixId: 'hmac-not-default' };
      }
      return { id: 'hmac-not-default', name: 'HMAC secret changed from default', status: 'pass', message: 'HMAC secret is configured', fixable: false };
    }
  });

  fixes.set('hmac-not-default', {
    id: 'hmac-not-default',
    fix() {
      const newSecret = crypto.randomBytes(32).toString('hex');
      config.sessionSecret = newSecret;
      return { success: true, message: 'Generated new session secret. Update your config file with: ' + newSecret, secret: newSecret };
    }
  });

  // ── Check: admin-password-changed ──
  checks.set('admin-password-changed', {
    id: 'admin-password-changed',
    name: 'Admin password changed from default',
    run() {
      if (!authManager) {
        return { id: 'admin-password-changed', name: 'Admin password changed from default', status: 'skip', message: 'Auth manager not available', fixable: false };
      }
      // Try to authenticate with the default password
      try {
        authManager.authenticate('admin', 'changeme');
        // If this succeeds, password is still default
        return { id: 'admin-password-changed', name: 'Admin password changed from default', status: 'warn', message: 'Admin password is still the default "changeme"', fixable: true, fixId: 'admin-password-changed' };
      } catch {
        return { id: 'admin-password-changed', name: 'Admin password changed from default', status: 'pass', message: 'Admin password has been changed from default', fixable: false };
      }
    }
  });

  fixes.set('admin-password-changed', {
    id: 'admin-password-changed',
    fix() {
      if (!authManager) {
        return { success: false, message: 'Auth manager not available' };
      }
      const newPassword = crypto.randomBytes(16).toString('hex');
      try {
        authManager.updatePassword('admin', newPassword);
        return { success: true, message: 'Admin password reset. New password: ' + newPassword, newPassword };
      } catch (err) {
        return { success: false, message: 'Failed to reset admin password: ' + err.message };
      }
    }
  });

  // ── Check: tls-configured ──
  checks.set('tls-configured', {
    id: 'tls-configured',
    name: 'TLS configured for production',
    run() {
      if (config.mode === 'local' || config.mode === 'development' || config.mode === 'dev') {
        return { id: 'tls-configured', name: 'TLS configured for production', status: 'skip', message: 'TLS check skipped in development mode', fixable: false };
      }
      if (config.httpsEnabled && config.httpsKeyPath && config.httpsCertPath) {
        return { id: 'tls-configured', name: 'TLS configured for production', status: 'pass', message: 'HTTPS is enabled with certificate and key configured', fixable: false };
      }
      return { id: 'tls-configured', name: 'TLS configured for production', status: 'warn', message: 'HTTPS is not enabled. Configure httpsEnabled, httpsKeyPath, and httpsCertPath for production', fixable: false };
    }
  });

  // ── Check: event-chain-integrity ──
  checks.set('event-chain-integrity', {
    id: 'event-chain-integrity',
    name: 'Event JSONL integrity',
    run() {
      const eventsDir = path.join(path.resolve(dataDir), 'events');
      try {
        const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl')).sort();
        if (files.length === 0) {
          return { id: 'event-chain-integrity', name: 'Event JSONL integrity', status: 'skip', message: 'No event files found', fixable: false };
        }
        // Sample check: verify last file has valid JSON lines
        const lastFile = files[files.length - 1];
        const content = fs.readFileSync(path.join(eventsDir, lastFile), 'utf8').trim();
        if (!content) {
          return { id: 'event-chain-integrity', name: 'Event JSONL integrity', status: 'pass', message: 'Event files present but empty', fixable: false };
        }
        const lines = content.split('\n');
        let corruptLines = 0;
        // Sample up to 100 lines from the end
        const sampleStart = Math.max(0, lines.length - 100);
        for (let i = sampleStart; i < lines.length; i++) {
          try {
            JSON.parse(lines[i]);
          } catch {
            corruptLines++;
          }
        }
        if (corruptLines > 0) {
          return { id: 'event-chain-integrity', name: 'Event JSONL integrity', status: 'warn', message: corruptLines + ' corrupt lines found in ' + lastFile + ' (sampled last 100 lines)', fixable: false };
        }
        return { id: 'event-chain-integrity', name: 'Event JSONL integrity', status: 'pass', message: 'Sampled ' + Math.min(100, lines.length) + ' lines from ' + lastFile + ' — all valid', fixable: false };
      } catch {
        return { id: 'event-chain-integrity', name: 'Event JSONL integrity', status: 'skip', message: 'Events directory not accessible', fixable: false };
      }
    }
  });

  // ── Check: receipt-chain-valid ──
  checks.set('receipt-chain-valid', {
    id: 'receipt-chain-valid',
    name: 'Receipt chain integrity',
    run() {
      if (!receiptStore) {
        return { id: 'receipt-chain-valid', name: 'Receipt chain integrity', status: 'skip', message: 'Receipt store not available', fixable: false };
      }
      try {
        const result = receiptStore.verifyChain();
        if (result.valid) {
          return { id: 'receipt-chain-valid', name: 'Receipt chain integrity', status: 'pass', message: 'Receipt chain is valid', fixable: false };
        }
        return { id: 'receipt-chain-valid', name: 'Receipt chain integrity', status: 'fail', message: 'Receipt chain broken at index ' + result.brokenAt + ': ' + result.reason, fixable: false };
      } catch (err) {
        return { id: 'receipt-chain-valid', name: 'Receipt chain integrity', status: 'fail', message: 'Receipt chain verification error: ' + err.message, fixable: false };
      }
    }
  });

  // ── Check: audit-chain-integrity ──
  checks.set('audit-chain-integrity', {
    id: 'audit-chain-integrity',
    name: 'Audit log hash chain integrity',
    run() {
      const auditDir = path.join(path.resolve(dataDir), 'audit');
      try {
        const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.jsonl')).sort();
        if (files.length === 0) {
          return { id: 'audit-chain-integrity', name: 'Audit log hash chain integrity', status: 'skip', message: 'No audit files found', fixable: false };
        }
        // Check last file for hash chain integrity
        const lastFile = files[files.length - 1];
        const content = fs.readFileSync(path.join(auditDir, lastFile), 'utf8').trim();
        if (!content) {
          return { id: 'audit-chain-integrity', name: 'Audit log hash chain integrity', status: 'pass', message: 'Audit files present but empty', fixable: false };
        }
        const lines = content.split('\n');
        let prevHash = null;
        let broken = false;
        for (let i = 0; i < lines.length; i++) {
          try {
            const entry = JSON.parse(lines[i]);
            if (prevHash !== null && entry.previousHash !== prevHash) {
              broken = true;
              break;
            }
            prevHash = entry.hash;
          } catch {
            broken = true;
            break;
          }
        }
        if (broken) {
          return { id: 'audit-chain-integrity', name: 'Audit log hash chain integrity', status: 'warn', message: 'Audit hash chain may be broken in ' + lastFile, fixable: false };
        }
        return { id: 'audit-chain-integrity', name: 'Audit log hash chain integrity', status: 'pass', message: 'Audit hash chain is valid in ' + lastFile + ' (' + lines.length + ' entries)', fixable: false };
      } catch {
        return { id: 'audit-chain-integrity', name: 'Audit log hash chain integrity', status: 'skip', message: 'Audit directory not accessible', fixable: false };
      }
    }
  });

  // ── Check: disk-space ──
  checks.set('disk-space', {
    id: 'disk-space',
    name: 'Disk space availability',
    run() {
      try {
        // Use os.freemem as a proxy; for actual disk space we'd need statfs
        // Node.js 18.15+ has fs.statfsSync
        const dir = path.resolve(dataDir);
        if (fs.statfsSync) {
          const stats = fs.statfsSync(dir);
          const freeBytes = stats.bfree * stats.bsize;
          const freeMB = Math.round(freeBytes / (1024 * 1024));
          if (freeMB < 500) {
            return { id: 'disk-space', name: 'Disk space availability', status: 'warn', message: 'Low disk space: ' + freeMB + 'MB free (< 500MB threshold)', fixable: false };
          }
          return { id: 'disk-space', name: 'Disk space availability', status: 'pass', message: freeMB + 'MB free disk space', fixable: false };
        }
        // Fallback: check free memory as rough proxy
        const freeMem = Math.round(os.freemem() / (1024 * 1024));
        return { id: 'disk-space', name: 'Disk space availability', status: 'pass', message: 'Disk space check not available on this platform; free memory: ' + freeMem + 'MB', fixable: false };
      } catch {
        return { id: 'disk-space', name: 'Disk space availability', status: 'skip', message: 'Could not determine disk space', fixable: false };
      }
    }
  });

  // ── Check: memory-usage ──
  checks.set('memory-usage', {
    id: 'memory-usage',
    name: 'Node.js memory usage',
    run() {
      const usage = process.memoryUsage();
      const heapUsedMB = Math.round(usage.heapUsed / (1024 * 1024));
      const heapTotalMB = Math.round(usage.heapTotal / (1024 * 1024));
      const ratio = usage.heapUsed / usage.heapTotal;
      if (ratio > 0.8) {
        return { id: 'memory-usage', name: 'Node.js memory usage', status: 'warn', message: 'High heap usage: ' + heapUsedMB + 'MB / ' + heapTotalMB + 'MB (' + Math.round(ratio * 100) + '%)', fixable: false };
      }
      return { id: 'memory-usage', name: 'Node.js memory usage', status: 'pass', message: 'Heap usage: ' + heapUsedMB + 'MB / ' + heapTotalMB + 'MB (' + Math.round(ratio * 100) + '%)', fixable: false };
    }
  });

  // ── Check: stale-sessions ──
  checks.set('stale-sessions', {
    id: 'stale-sessions',
    name: 'Stale active sessions',
    run() {
      if (!snapshots) {
        return { id: 'stale-sessions', name: 'Stale active sessions', status: 'skip', message: 'Snapshots module not available', fixable: false };
      }
      try {
        const sessData = snapshots.load(path.resolve(dataDir), 'sessions');
        if (!sessData || !sessData.sessions) {
          return { id: 'stale-sessions', name: 'Stale active sessions', status: 'skip', message: 'No session data available', fixable: false };
        }
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const stale = [];
        for (const [id, s] of Object.entries(sessData.sessions)) {
          if (s.status === 'active') {
            const lastActivity = new Date(s.lastActivity || s.startedAt).getTime();
            if (lastActivity < cutoff) {
              stale.push(id);
            }
          }
        }
        if (stale.length > 0) {
          return { id: 'stale-sessions', name: 'Stale active sessions', status: 'warn', message: stale.length + ' active sessions older than 7 days', fixable: true, fixId: 'stale-sessions', staleSessions: stale };
        }
        return { id: 'stale-sessions', name: 'Stale active sessions', status: 'pass', message: 'No stale active sessions found', fixable: false };
      } catch (err) {
        return { id: 'stale-sessions', name: 'Stale active sessions', status: 'skip', message: 'Could not check sessions: ' + err.message, fixable: false };
      }
    }
  });

  fixes.set('stale-sessions', {
    id: 'stale-sessions',
    fix() {
      if (!snapshots || !eventStore) {
        return { success: false, message: 'Snapshots or event store not available' };
      }
      try {
        const sessData = snapshots.load(path.resolve(dataDir), 'sessions');
        if (!sessData || !sessData.sessions) {
          return { success: false, message: 'No session data available' };
        }
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let fixed = 0;
        for (const [id, s] of Object.entries(sessData.sessions)) {
          if (s.status === 'active') {
            const lastActivity = new Date(s.lastActivity || s.startedAt).getTime();
            if (lastActivity < cutoff) {
              s.status = 'ended';
              fixed++;
            }
          }
        }
        if (fixed > 0) {
          // Persist updated sessions
          const snapshotsDir = path.join(path.resolve(dataDir), 'snapshots');
          fs.mkdirSync(snapshotsDir, { recursive: true });
          fs.writeFileSync(path.join(snapshotsDir, 'sessions.json'), JSON.stringify(sessData, null, 2));
        }
        return { success: true, message: 'Marked ' + fixed + ' stale sessions as ended', fixed };
      } catch (err) {
        return { success: false, message: 'Failed to fix stale sessions: ' + err.message };
      }
    }
  });

  // ── Check: sqlite-sync ──
  checks.set('sqlite-sync', {
    id: 'sqlite-sync',
    name: 'SQLite sync status',
    run() {
      if (!config.sqlite || config.sqlite.enabled === false) {
        return { id: 'sqlite-sync', name: 'SQLite sync status', status: 'skip', message: 'SQLite not enabled', fixable: false };
      }
      const sqlitePath = config.sqlite.path
        ? path.resolve(config.sqlite.path)
        : path.join(path.resolve(dataDir), 'index.sqlite');
      try {
        fs.accessSync(sqlitePath, fs.constants.R_OK);
        return { id: 'sqlite-sync', name: 'SQLite sync status', status: 'pass', message: 'SQLite database accessible at ' + sqlitePath, fixable: false };
      } catch {
        return { id: 'sqlite-sync', name: 'SQLite sync status', status: 'warn', message: 'SQLite database not found at ' + sqlitePath, fixable: false };
      }
    }
  });

  // ── Public API ──

  function runAll() {
    const results = [];
    for (const [, check] of checks) {
      try {
        results.push(check.run());
      } catch (err) {
        results.push({ id: check.id, name: check.name, status: 'fail', message: 'Check threw error: ' + err.message, fixable: false });
      }
    }
    return results;
  }

  function runCheck(checkId) {
    const check = checks.get(checkId);
    if (!check) return null;
    try {
      return check.run();
    } catch (err) {
      return { id: checkId, name: check.name, status: 'fail', message: 'Check threw error: ' + err.message, fixable: false };
    }
  }

  function applyFix(fixId) {
    const fix = fixes.get(fixId);
    if (!fix) return { success: false, message: 'No fix available for: ' + fixId };
    try {
      return fix.fix();
    } catch (err) {
      return { success: false, message: 'Fix failed: ' + err.message };
    }
  }

  function getCheckIds() {
    return [...checks.keys()];
  }

  function getFixableChecks() {
    return [...fixes.keys()];
  }

  return { runAll, runCheck, applyFix, getCheckIds, getFixableChecks };
}

module.exports = { createDoctor };
