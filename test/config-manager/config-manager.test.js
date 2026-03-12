'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createConfigManager } = require('../../control-plane/lib/config-manager');

function makeTestConfig() {
  return {
    host: '0.0.0.0',
    port: 3400,
    mode: 'local',
    dataDir: './data',
    httpsEnabled: false,
    sessionSecret: 'super-secret-key',
    auth: {
      lockoutAttempts: 5,
      lockoutDurationMs: 900000,
      sessionTtlMs: 86400000,
      defaultAdminPassword: 'changeme'
    },
    security: {
      rateLimitMaxRequests: 100,
      rateLimitWindowMs: 60000
    }
  };
}

// -- Export tests --

describe('Config export', () => {
  it('should export config with secrets redacted', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const exported = cm.exportConfig();
    assert.equal(exported.sessionSecret, '***');
    assert.equal(exported.auth.defaultAdminPassword, '***');
    assert.equal(exported.host, '0.0.0.0');
    assert.equal(exported.port, 3400);
  });

  it('should not modify original config during export', () => {
    const original = makeTestConfig();
    const cm = createConfigManager({ config: original });
    cm.exportConfig();
    assert.equal(original.sessionSecret, 'super-secret-key');
  });
});

// -- Validation tests --

describe('Config validation', () => {
  it('should validate a correct config', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.validateConfig({ host: '127.0.0.1', port: 8080 });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should reject invalid port', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.validateConfig({ port: 99999 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('port')));
  });

  it('should reject non-numeric port', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.validateConfig({ port: 'abc' });
    assert.equal(result.valid, false);
  });

  it('should reject httpsEnabled without cert paths', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.validateConfig({ httpsEnabled: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('httpsKeyPath')));
  });

  it('should reject non-object config', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.validateConfig('not-an-object');
    assert.equal(result.valid, false);
  });
});

// -- Diff tests --

describe('Config diff', () => {
  it('should detect changed fields', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const changes = cm.getDiff({ port: 9000, mode: 'production' });
    assert.ok(changes.some(c => c.field === 'port' && c.newValue === 9000));
    assert.ok(changes.some(c => c.field === 'mode' && c.newValue === 'production'));
  });

  it('should return empty for identical config', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const changes = cm.getDiff({ host: '0.0.0.0', port: 3400 });
    assert.equal(changes.length, 0);
  });

  it('should skip redacted values in diff', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const changes = cm.getDiff({ sessionSecret: '***' });
    assert.equal(changes.length, 0);
  });
});

// -- Schema tests --

describe('Config schema', () => {
  it('should return a schema object with expected fields', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const schema = cm.getConfigSchema();
    assert.ok(schema.host);
    assert.ok(schema.port);
    assert.equal(schema.port.type, 'number');
    assert.equal(schema.port.default, 3400);
    assert.ok(schema.auth);
    assert.ok(schema.security);
  });
});

// -- Defaults tests --

describe('Config defaults', () => {
  it('should return defaults matching schema', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const defaults = cm.resetToDefaults();
    assert.equal(defaults.port, 3400);
    assert.equal(defaults.host, '0.0.0.0');
    assert.equal(defaults.httpsEnabled, false);
    assert.ok(defaults.auth);
    assert.equal(defaults.auth.lockoutAttempts, 5);
  });
});

// -- Import tests --

describe('Config import', () => {
  it('should apply valid changes and return applied list', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.importConfig({ port: 9000, mode: 'production' });
    assert.ok(result.applied.length > 0);
    assert.ok(result.applied.some(a => a.field === 'port'));
    // Verify the config was actually updated
    const exported = cm.exportConfig();
    assert.equal(exported.port, 9000);
  });

  it('should skip redacted fields and return warnings', () => {
    const cm = createConfigManager({ config: makeTestConfig() });
    const result = cm.importConfig({ sessionSecret: '***' });
    assert.ok(result.warnings.some(w => w.includes('redacted')));
    assert.equal(result.applied.length, 0);
  });
});
