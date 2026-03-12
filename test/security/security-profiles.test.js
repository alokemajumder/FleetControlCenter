'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createSecurityProfileManager } = require('../../control-plane/lib/security-profiles');

describe('Security Profiles - Built-in profiles', () => {
  let manager;
  beforeEach(() => { manager = createSecurityProfileManager(); });

  it('should have three built-in profiles', () => {
    const profiles = manager.listProfiles();
    const builtIn = profiles.filter(p => p.builtIn);
    assert.equal(builtIn.length, 3);
    assert.ok(builtIn.find(p => p.id === 'minimal'));
    assert.ok(builtIn.find(p => p.id === 'standard'));
    assert.ok(builtIn.find(p => p.id === 'strict'));
  });

  it('should default to standard profile', () => {
    const active = manager.getActiveProfile();
    assert.equal(active.id, 'standard');
  });

  it('should get a specific built-in profile', () => {
    const strict = manager.getProfile('strict');
    assert.equal(strict.id, 'strict');
    assert.equal(strict.rules.authFailureAction, 'log+alert+block');
    assert.equal(strict.rules.autoQuarantineOnInjection, true);
  });

  it('should get minimal profile with correct rules', () => {
    const minimal = manager.getProfile('minimal');
    assert.equal(minimal.rules.authFailureAction, 'log');
    assert.equal(minimal.rules.blockDurationMs, 0);
    assert.equal(minimal.rules.maxAuthFailuresPerHour, 100);
  });

  it('should return null for non-existent profile', () => {
    const result = manager.getProfile('nonexistent');
    assert.equal(result, null);
  });
});

describe('Security Profiles - Active profile switching', () => {
  let manager;
  beforeEach(() => { manager = createSecurityProfileManager(); });

  it('should switch active profile', () => {
    manager.setActiveProfile('strict');
    const active = manager.getActiveProfile();
    assert.equal(active.id, 'strict');
  });

  it('should reject switching to non-existent profile', () => {
    assert.throws(() => manager.setActiveProfile('nonexistent'), /Profile not found/);
  });

  it('should mark active profile in list', () => {
    manager.setActiveProfile('minimal');
    const profiles = manager.listProfiles();
    const active = profiles.find(p => p.active);
    assert.equal(active.id, 'minimal');
  });
});

describe('Security Profiles - Custom profiles', () => {
  let manager;
  beforeEach(() => { manager = createSecurityProfileManager(); });

  it('should create a custom profile', () => {
    const profile = manager.createCustomProfile({
      id: 'custom1',
      name: 'Custom One',
      description: 'Test custom profile',
      rules: { authFailureAction: 'log+alert', maxAuthFailuresPerHour: 10 }
    });
    assert.equal(profile.id, 'custom1');
    assert.equal(profile.name, 'Custom One');
    assert.equal(profile.rules.authFailureAction, 'log+alert');
    assert.equal(profile.rules.maxAuthFailuresPerHour, 10);
    // Should inherit standard defaults for unset rules
    assert.equal(profile.rules.rateLimitAction, 'log+throttle');
  });

  it('should reject creating profile with built-in ID', () => {
    assert.throws(() => manager.createCustomProfile({ id: 'strict', name: 'Fake', rules: {} }), /built-in ID/);
  });

  it('should reject creating duplicate custom profile', () => {
    manager.createCustomProfile({ id: 'dup', name: 'Dup', rules: {} });
    assert.throws(() => manager.createCustomProfile({ id: 'dup', name: 'Dup2', rules: {} }), /already exists/);
  });

  it('should update a custom profile', () => {
    manager.createCustomProfile({ id: 'upd', name: 'Original', rules: { maxAuthFailuresPerHour: 50 } });
    const updated = manager.updateCustomProfile('upd', { name: 'Updated', rules: { maxAuthFailuresPerHour: 25 } });
    assert.equal(updated.name, 'Updated');
    assert.equal(updated.rules.maxAuthFailuresPerHour, 25);
  });

  it('should reject updating built-in profile', () => {
    assert.throws(() => manager.updateCustomProfile('standard', { name: 'Hacked' }), /Cannot modify built-in/);
  });

  it('should delete a custom profile', () => {
    manager.createCustomProfile({ id: 'del', name: 'Delete Me', rules: {} });
    manager.deleteCustomProfile('del');
    assert.equal(manager.getProfile('del'), null);
  });

  it('should reject deleting built-in profile', () => {
    assert.throws(() => manager.deleteCustomProfile('standard'), /Cannot delete built-in/);
  });

  it('should reset active profile to standard when deleting active custom profile', () => {
    manager.createCustomProfile({ id: 'temp', name: 'Temp', rules: {} });
    manager.setActiveProfile('temp');
    manager.deleteCustomProfile('temp');
    assert.equal(manager.getActiveProfile().id, 'standard');
  });

  it('should switch to a custom profile', () => {
    manager.createCustomProfile({ id: 'c2', name: 'C2', rules: {} });
    manager.setActiveProfile('c2');
    assert.equal(manager.getActiveProfile().id, 'c2');
  });
});

describe('Security Profiles - Event evaluation', () => {
  let manager;
  beforeEach(() => { manager = createSecurityProfileManager(); });

  it('should evaluate auth failure under minimal profile as log', () => {
    manager.setActiveProfile('minimal');
    const result = manager.evaluateEvent('auth.failure', {});
    assert.equal(result.action, 'log');
  });

  it('should evaluate auth failure under standard profile as alert', () => {
    manager.setActiveProfile('standard');
    const result = manager.evaluateEvent('auth.failure', {});
    assert.equal(result.action, 'alert');
  });

  it('should evaluate auth failure under strict profile as block', () => {
    manager.setActiveProfile('strict');
    const result = manager.evaluateEvent('auth.failure', {});
    assert.equal(result.action, 'block');
  });

  it('should escalate to block when auth failure threshold exceeded', () => {
    manager.setActiveProfile('standard');
    const result = manager.evaluateEvent('auth.failure', { failureCount: 25 });
    assert.equal(result.action, 'block');
    assert.equal(result.details.thresholdExceeded, true);
  });

  it('should evaluate injection attempt under strict as quarantine', () => {
    manager.setActiveProfile('strict');
    const result = manager.evaluateEvent('injection.attempt', {});
    assert.equal(result.action, 'quarantine');
  });

  it('should return log for unknown event type', () => {
    const result = manager.evaluateEvent('unknown.event', {});
    assert.equal(result.action, 'log');
  });

  it('should escalate rate limit to block on threshold exceeded', () => {
    manager.setActiveProfile('standard');
    const result = manager.evaluateEvent('rate.limit', { hitCount: 35 });
    assert.equal(result.action, 'block');
  });
});

describe('Security Profiles - Security events and stats', () => {
  let manager;
  beforeEach(() => { manager = createSecurityProfileManager(); });

  it('should record and retrieve security events', () => {
    manager.recordSecurityEvent({ type: 'auth.failure', action: 'log', details: { ip: '1.2.3.4' } });
    manager.recordSecurityEvent({ type: 'secret.leak', action: 'alert', details: { file: 'env' } });
    const events = manager.getSecurityEvents({});
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'auth.failure');
    assert.equal(events[1].type, 'secret.leak');
  });

  it('should filter events by type', () => {
    manager.recordSecurityEvent({ type: 'auth.failure', action: 'log' });
    manager.recordSecurityEvent({ type: 'secret.leak', action: 'alert' });
    manager.recordSecurityEvent({ type: 'auth.failure', action: 'block' });
    const events = manager.getSecurityEvents({ type: 'auth.failure' });
    assert.equal(events.length, 2);
  });

  it('should limit returned events', () => {
    for (let i = 0; i < 10; i++) {
      manager.recordSecurityEvent({ type: 'test', action: 'log' });
    }
    const events = manager.getSecurityEvents({ limit: 3 });
    assert.equal(events.length, 3);
  });

  it('should compute security stats', () => {
    manager.recordSecurityEvent({ type: 'auth.failure', action: 'log' });
    manager.recordSecurityEvent({ type: 'auth.failure', action: 'block' });
    manager.recordSecurityEvent({ type: 'secret.leak', action: 'alert' });
    const stats = manager.getSecurityStats();
    assert.equal(stats.totalEvents, 3);
    assert.equal(stats.byType['auth.failure'], 2);
    assert.equal(stats.byType['secret.leak'], 1);
    assert.equal(stats.byAction['log'], 1);
    assert.equal(stats.byAction['block'], 1);
    assert.equal(stats.byAction['alert'], 1);
    assert.equal(stats.activeProfile, 'standard');
    assert.ok(stats.recentTrend);
  });

  it('should assign unique IDs to recorded events', () => {
    const e1 = manager.recordSecurityEvent({ type: 'test', action: 'log' });
    const e2 = manager.recordSecurityEvent({ type: 'test', action: 'log' });
    assert.ok(e1.id);
    assert.ok(e2.id);
    assert.notEqual(e1.id, e2.id);
  });
});
