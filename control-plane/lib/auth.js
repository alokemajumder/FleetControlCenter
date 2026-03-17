'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword, verifyPassword, generateTOTPSecret, verifyTOTPCode, generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode } = require('./crypto');

// ── User store ──

function createAuthManager(opts = {}) {
  const users = new Map();
  const sessions = new Map();
  const failedAttempts = new Map();
  const maxFailures = opts.maxFailures || 5;
  const lockoutMs = opts.lockoutMs || 60000;
  const sessionTTL = opts.sessionTTL || 3600000; // 1 hour
  const stepUpWindow = opts.stepUpWindow || 300000; // 5 min
  const dataDir = opts.dataDir || null;

  const ROLES = {
    viewer: { permissions: ['read'] },
    operator: { permissions: ['read', 'action'] },
    auditor: { permissions: ['read', 'audit'] },
    admin: { permissions: ['read', 'action', 'admin', 'audit'] }
  };

  function usersFilePath() {
    if (!dataDir) return null;
    return path.join(dataDir, 'users', 'users.json');
  }

  function persistUsers() {
    const fp = usersFilePath();
    if (!fp) return;
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      const data = [...users.values()].map(u => ({
        username: u.username, password: u.password, role: u.role,
        mfaSecret: u.mfaSecret, mfaEnabled: u.mfaEnabled, createdAt: u.createdAt,
        recoveryCodes: u.recoveryCodes || [],
        apiKeys: u.apiKeys || [],
        disabled: u.disabled || false,
        loginCount: u.loginCount || 0,
        lastLogin: u.lastLogin || null
      }));
      // Atomic write: tmp file then rename to avoid data loss on crash
      const tmpPath = fp + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, fp);
    } catch { /* ignore write errors */ }
  }

  function loadUsers() {
    const fp = usersFilePath();
    if (!fp) return;
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const u of data) {
        users.set(u.username, {
          username: u.username, password: u.password, role: u.role,
          mfaSecret: u.mfaSecret || null, mfaEnabled: u.mfaEnabled || false,
          createdAt: u.createdAt || Date.now(),
          recoveryCodes: u.recoveryCodes || [],
          apiKeys: u.apiKeys || [],
          disabled: u.disabled || false,
          loginCount: u.loginCount || 0,
          lastLogin: u.lastLogin || null
        });
      }
    } catch { /* no saved users yet */ }
  }

  // Load persisted users on init
  loadUsers();

  function createUser(username, password, role = 'viewer') {
    if (users.has(username)) throw new Error('User already exists');
    if (!ROLES[role]) throw new Error(`Invalid role: ${role}`);
    const hashed = hashPassword(password);
    const user = { username, password: hashed, role, mfaSecret: null, mfaEnabled: false, createdAt: Date.now(), apiKeys: [], disabled: false, loginCount: 0, lastLogin: null };
    users.set(username, user);
    persistUsers();
    return { username, role };
  }

  function authenticate(username, password) {
    const record = failedAttempts.get(username) || { count: 0, lockedUntil: 0 };
    if (Date.now() < record.lockedUntil) {
      throw new Error('Account locked');
    }
    const user = users.get(username);
    if (!user || !verifyPassword(password, user.password)) {
      record.count++;
      if (record.count >= maxFailures) {
        record.lockedUntil = Date.now() + lockoutMs;
      }
      failedAttempts.set(username, record);
      throw new Error('Invalid credentials');
    }
    if (user.disabled) {
      throw new Error('Account disabled');
    }
    // Reset on success
    failedAttempts.delete(username);
    user.loginCount = (user.loginCount || 0) + 1;
    user.lastLogin = Date.now();
    persistUsers();
    return { username: user.username, role: user.role, mfaEnabled: user.mfaEnabled };
  }

  function createSession(username, opts = {}) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = opts.mfaPending ? Math.min(sessionTTL, 300000) : sessionTTL; // 5 min max for MFA-pending
    sessions.set(token, {
      username, role: user.role,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      stepUpAt: 0,
      mfaPending: !!opts.mfaPending
    });
    return token;
  }

  function upgradeSession(token) {
    const session = sessions.get(token);
    if (!session) return false;
    session.mfaPending = false;
    session.expiresAt = Date.now() + sessionTTL; // extend to full TTL after MFA
    return true;
  }

  function validateSession(token) {
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return { username: session.username, role: session.role, mfaPending: !!session.mfaPending };
  }

  function destroySession(token) {
    return sessions.delete(token);
  }

  function rotateSession(oldToken) {
    const session = sessions.get(oldToken);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      sessions.delete(oldToken);
      return null;
    }
    sessions.delete(oldToken);
    const newToken = crypto.randomBytes(32).toString('hex');
    sessions.set(newToken, { ...session, createdAt: Date.now(), expiresAt: Date.now() + sessionTTL });
    return newToken;
  }

  function checkPermission(role, permission) {
    const roleDef = ROLES[role];
    if (!roleDef) return false;
    return roleDef.permissions.includes(permission);
  }

  function setupMFA(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    const secret = generateTOTPSecret();
    user.mfaSecret = secret;
    // Generate and store hashed recovery codes
    const codes = generateRecoveryCodes(10);
    user.recoveryCodes = codes.map(c => hashRecoveryCode(c));
    persistUsers();
    return { secret, recoveryCodes: codes };
  }

  function verifyMFA(username, code) {
    const user = users.get(username);
    if (!user || !user.mfaSecret) throw new Error('MFA not set up');
    if (verifyTOTPCode(user.mfaSecret, code)) {
      user.mfaEnabled = true;
      persistUsers();
      return true;
    }
    return false;
  }

  function stepUpAuth(token) {
    const session = sessions.get(token);
    if (!session) return false;
    session.stepUpAt = Date.now();
    return true;
  }

  function requireStepUp(token) {
    const session = sessions.get(token);
    if (!session) return false;
    if (!session.stepUpAt) return false;
    return (Date.now() - session.stepUpAt) < stepUpWindow;
  }

  function useRecoveryCode(username, code) {
    const user = users.get(username);
    if (!user || !user.recoveryCodes) return false;
    const idx = user.recoveryCodes.findIndex(h => verifyRecoveryCode(code, h));
    if (idx === -1) return false;
    user.recoveryCodes.splice(idx, 1); // one-time use
    persistUsers();
    return true;
  }

  function getStepUpAt(token) {
    const session = sessions.get(token);
    if (!session) return 0;
    return session.stepUpAt || 0;
  }

  function deleteUser(username) {
    if (!users.has(username)) throw new Error('User not found');
    users.delete(username);
    persistUsers();
  }

  function createApiKey(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    const plainKey = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const prefix = plainKey.slice(0, 8);
    if (!user.apiKeys) user.apiKeys = [];
    user.apiKeys.push({ hash, prefix, createdAt: Date.now(), lastUsedAt: null });
    persistUsers();
    return { key: plainKey, prefix };
  }

  function revokeApiKey(username, keyPrefix) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    if (!user.apiKeys) return false;
    const idx = user.apiKeys.findIndex(k => k.prefix === keyPrefix);
    if (idx === -1) return false;
    user.apiKeys.splice(idx, 1);
    persistUsers();
    return true;
  }

  function listApiKeys(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    return (user.apiKeys || []).map(k => ({ prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }));
  }

  function authenticateByApiKey(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    for (const user of users.values()) {
      if (!user.apiKeys) continue;
      const found = user.apiKeys.find(k => k.hash === hash);
      if (found) {
        if (user.disabled) return null;
        found.lastUsedAt = Date.now();
        persistUsers();
        return { username: user.username, role: user.role, mfaEnabled: user.mfaEnabled };
      }
    }
    return null;
  }

  function listAllUsers() {
    return [...users.values()].map(u => ({
      username: u.username, role: u.role, mfaEnabled: u.mfaEnabled,
      disabled: u.disabled || false, createdAt: u.createdAt,
      apiKeyCount: (u.apiKeys || []).length, loginCount: u.loginCount || 0,
      lastLogin: u.lastLogin || null
    }));
  }

  function setUserRole(username, role) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    if (!ROLES[role]) throw new Error(`Invalid role: ${role}`);
    user.role = role;
    persistUsers();
    return { username: user.username, role: user.role };
  }

  function disableUser(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    user.disabled = true;
    persistUsers();
  }

  function enableUser(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    user.disabled = false;
    persistUsers();
  }

  function getUserActivity(username) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    return {
      lastLogin: user.lastLogin || null,
      loginCount: user.loginCount || 0,
      mfaEnabled: user.mfaEnabled || false,
      apiKeyCount: (user.apiKeys || []).length,
      createdAt: user.createdAt
    };
  }

  function createDefaultAdmin(password = 'admin') {
    if (!users.has('admin')) {
      return createUser('admin', password, 'admin');
    }
    return { username: 'admin', role: 'admin' };
  }

  function getUser(username) {
    const user = users.get(username);
    if (!user) return null;
    return { username: user.username, role: user.role, mfaEnabled: user.mfaEnabled };
  }

  function listUsers() {
    return [...users.values()].map(u => ({ username: u.username, role: u.role, mfaEnabled: u.mfaEnabled }));
  }

  function checkPasswordDirect(username, password) {
    const user = users.get(username);
    if (!user) return false;
    return verifyPassword(password, user.password);
  }

  function changePassword(username, oldPassword, newPassword) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    if (!verifyPassword(oldPassword, user.password)) {
      throw new Error('Invalid old password');
    }
    user.password = hashPassword(newPassword);
    persistUsers();
  }

  function updatePassword(username, newPassword) {
    const user = users.get(username);
    if (!user) throw new Error('User not found');
    user.password = hashPassword(newPassword);
    persistUsers();
  }

  return {
    createUser, authenticate, createSession, upgradeSession, validateSession, destroySession,
    rotateSession, checkPermission, setupMFA, verifyMFA,
    stepUpAuth, requireStepUp, createDefaultAdmin, getUser, listUsers,
    changePassword, updatePassword, checkPasswordDirect, getStepUpAt, useRecoveryCode,
    deleteUser, createApiKey, revokeApiKey, listApiKeys, authenticateByApiKey,
    listAllUsers, setUserRole, disableUser, enableUser, getUserActivity
  };
}

module.exports = { createAuthManager };
