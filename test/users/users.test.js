'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthManager } = require('../../control-plane/lib/auth');

describe('User Management', () => {
  let auth;

  beforeEach(() => {
    auth = createAuthManager({ maxFailures: 5, lockoutMs: 1000, sessionTTL: 3600000 });
  });

  // ── User CRUD ──

  describe('User CRUD', () => {
    it('should create and retrieve a user', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const user = auth.getUser('alice');
      assert.equal(user.username, 'alice');
      assert.equal(user.role, 'viewer');
    });

    it('should reject duplicate usernames', () => {
      auth.createUser('alice', 'password123', 'viewer');
      assert.throws(() => auth.createUser('alice', 'password456', 'operator'), /already exists/);
    });

    it('should delete a user', () => {
      auth.createUser('bob', 'password123', 'viewer');
      assert.ok(auth.getUser('bob'));
      auth.deleteUser('bob');
      assert.equal(auth.getUser('bob'), null);
    });

    it('should throw when deleting non-existent user', () => {
      assert.throws(() => auth.deleteUser('ghost'), /not found/i);
    });

    it('should list all users with safe fields', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.createUser('bob', 'password456', 'operator');
      const users = auth.listAllUsers();
      assert.equal(users.length, 2);
      for (const u of users) {
        assert.ok(u.username);
        assert.ok(u.role);
        assert.equal(u.password, undefined);
        assert.ok('disabled' in u);
        assert.ok('apiKeyCount' in u);
        assert.ok('createdAt' in u);
      }
    });
  });

  // ── API Key Management ──

  describe('API Keys', () => {
    it('should create an API key and return plain key + prefix', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const result = auth.createApiKey('alice');
      assert.ok(result.key);
      assert.ok(result.prefix);
      assert.equal(result.prefix.length, 8);
      assert.equal(result.key.length, 64); // 32 bytes hex
      assert.ok(result.key.startsWith(result.prefix));
    });

    it('should list API keys without exposing hashes', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.createApiKey('alice');
      auth.createApiKey('alice');
      const keys = auth.listApiKeys('alice');
      assert.equal(keys.length, 2);
      for (const k of keys) {
        assert.ok(k.prefix);
        assert.ok(k.createdAt);
        assert.equal(k.hash, undefined);
      }
    });

    it('should revoke an API key by prefix', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const { prefix } = auth.createApiKey('alice');
      assert.equal(auth.listApiKeys('alice').length, 1);
      const revoked = auth.revokeApiKey('alice', prefix);
      assert.ok(revoked);
      assert.equal(auth.listApiKeys('alice').length, 0);
    });

    it('should return false when revoking non-existent key', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const revoked = auth.revokeApiKey('alice', 'nonexist');
      assert.equal(revoked, false);
    });

    it('should throw when creating API key for non-existent user', () => {
      assert.throws(() => auth.createApiKey('ghost'), /not found/i);
    });
  });

  // ── API Key Authentication ──

  describe('API Key Authentication', () => {
    it('should authenticate with a valid API key', () => {
      auth.createUser('alice', 'password123', 'operator');
      const { key } = auth.createApiKey('alice');
      const user = auth.authenticateByApiKey(key);
      assert.ok(user);
      assert.equal(user.username, 'alice');
      assert.equal(user.role, 'operator');
    });

    it('should return null for an invalid API key', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const user = auth.authenticateByApiKey('invalidkey1234567890abcdef1234567890abcdef1234567890abcdef12345678');
      assert.equal(user, null);
    });

    it('should update lastUsedAt on API key auth', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const { key, prefix } = auth.createApiKey('alice');
      const keysBefore = auth.listApiKeys('alice');
      assert.equal(keysBefore[0].lastUsedAt, null);
      auth.authenticateByApiKey(key);
      const keysAfter = auth.listApiKeys('alice');
      assert.ok(keysAfter[0].lastUsedAt);
    });

    it('should not authenticate with a revoked API key', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const { key, prefix } = auth.createApiKey('alice');
      auth.revokeApiKey('alice', prefix);
      const user = auth.authenticateByApiKey(key);
      assert.equal(user, null);
    });

    it('should not authenticate disabled user via API key', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const { key } = auth.createApiKey('alice');
      auth.disableUser('alice');
      const user = auth.authenticateByApiKey(key);
      assert.equal(user, null);
    });
  });

  // ── Role Changes ──

  describe('Role Management', () => {
    it('should change a user role', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const result = auth.setUserRole('alice', 'admin');
      assert.equal(result.role, 'admin');
      assert.equal(auth.getUser('alice').role, 'admin');
    });

    it('should reject invalid roles', () => {
      auth.createUser('alice', 'password123', 'viewer');
      assert.throws(() => auth.setUserRole('alice', 'superadmin'), /Invalid role/);
    });

    it('should throw when setting role on non-existent user', () => {
      assert.throws(() => auth.setUserRole('ghost', 'viewer'), /not found/i);
    });
  });

  // ── Enable/Disable ──

  describe('User Enable/Disable', () => {
    it('should disable a user', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.disableUser('alice');
      const users = auth.listAllUsers();
      const alice = users.find(u => u.username === 'alice');
      assert.equal(alice.disabled, true);
    });

    it('should prevent disabled user from authenticating', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.disableUser('alice');
      assert.throws(() => auth.authenticate('alice', 'password123'), /disabled/i);
    });

    it('should re-enable a user', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.disableUser('alice');
      auth.enableUser('alice');
      // Should authenticate successfully now
      const result = auth.authenticate('alice', 'password123');
      assert.equal(result.username, 'alice');
    });

    it('should throw when disabling non-existent user', () => {
      assert.throws(() => auth.disableUser('ghost'), /not found/i);
    });
  });

  // ── Activity Tracking ──

  describe('Activity Tracking', () => {
    it('should track login count and lastLogin', () => {
      auth.createUser('alice', 'password123', 'viewer');
      const before = auth.getUserActivity('alice');
      assert.equal(before.loginCount, 0);
      assert.equal(before.lastLogin, null);

      auth.authenticate('alice', 'password123');
      const after = auth.getUserActivity('alice');
      assert.equal(after.loginCount, 1);
      assert.ok(after.lastLogin);
    });

    it('should return activity with apiKeyCount', () => {
      auth.createUser('alice', 'password123', 'viewer');
      auth.createApiKey('alice');
      auth.createApiKey('alice');
      const activity = auth.getUserActivity('alice');
      assert.equal(activity.apiKeyCount, 2);
      assert.ok(activity.createdAt);
    });

    it('should throw when getting activity for non-existent user', () => {
      assert.throws(() => auth.getUserActivity('ghost'), /not found/i);
    });
  });
});
