'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createOnboarding } = require('../../control-plane/lib/onboarding');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawcc-onboarding-test-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Minimal doctor mock
function createMockDoctor(results) {
  return {
    runAll() {
      return results || [
        { id: 'config-valid', status: 'pass', message: 'ok', fixable: false },
        { id: 'hmac-not-default', status: 'warn', message: 'default hmac', fixable: true, fixId: 'hmac-not-default' },
        { id: 'admin-password-changed', status: 'fail', message: 'still default', fixable: true, fixId: 'admin-password-changed' }
      ];
    },
    applyFix(fixId) {
      return { success: true, message: 'Fixed: ' + fixId };
    }
  };
}

describe('Onboarding - initialization', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it('should return null state before setup starts', () => {
    const ob = createOnboarding({ dataDir: tmpDir });
    assert.equal(ob.getState(), null);
  });

  it('should report not complete before setup starts', () => {
    const ob = createOnboarding({ dataDir: tmpDir });
    assert.equal(ob.isComplete(), false);
  });

  it('should initialize setup state with startSetup', () => {
    const ob = createOnboarding({ dataDir: tmpDir });
    const state = ob.startSetup();
    assert.equal(state.completed, false);
    assert.ok(state.startedAt > 0);
    assert.equal(state.completedAt, null);
    assert.equal(state.currentStep, 0);
    assert.equal(state.steps.length, 7);
    assert.equal(state.steps[0].id, 'welcome');
    assert.equal(state.steps[6].id, 'complete');
    for (const step of state.steps) {
      assert.equal(step.status, 'pending');
    }
  });

  it('should be idempotent - calling startSetup twice returns same state', () => {
    const ob = createOnboarding({ dataDir: tmpDir });
    const first = ob.startSetup();
    const second = ob.startSetup();
    assert.equal(first.startedAt, second.startedAt);
  });
});

describe('Onboarding - state persistence', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it('should persist state to disk and reload', () => {
    const ob1 = createOnboarding({ dataDir: tmpDir });
    ob1.startSetup();
    ob1.completeStep('welcome');

    // Create a new instance to test reload
    const ob2 = createOnboarding({ dataDir: tmpDir });
    const state = ob2.getState();
    assert.ok(state);
    assert.equal(state.steps[0].status, 'completed');
  });
});

describe('Onboarding - step completion', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
    ob.startSetup();
  });
  afterEach(() => cleanup(tmpDir));

  it('should complete welcome step with no data', () => {
    const step = ob.completeStep('welcome');
    assert.equal(step.status, 'completed');
    assert.ok(step.completedAt > 0);
  });

  it('should complete admin-account step with valid data', () => {
    const step = ob.completeStep('admin-account', { username: 'myadmin', password: 'securepass1' });
    assert.equal(step.status, 'completed');
    const state = ob.getState();
    assert.equal(state.config.username, 'myadmin');
  });

  it('should reject admin-account with short username', () => {
    assert.throws(
      () => ob.completeStep('admin-account', { username: 'ab', password: 'securepass1' }),
      /username must be 3-32 characters/
    );
  });

  it('should reject admin-account with non-alphanumeric username', () => {
    assert.throws(
      () => ob.completeStep('admin-account', { username: 'my-user', password: 'securepass1' }),
      /username must be alphanumeric/
    );
  });

  it('should reject admin-account with short password', () => {
    assert.throws(
      () => ob.completeStep('admin-account', { username: 'admin', password: 'short' }),
      /password must be at least 8 characters/
    );
  });

  it('should complete security-config step', () => {
    const step = ob.completeStep('security-config', { hmacSecret: 'abcdef1234567890', enableMfa: true, enableTls: false });
    assert.equal(step.status, 'completed');
    const state = ob.getState();
    assert.equal(state.config.hmacSecret, 'abcdef1234567890');
    assert.equal(state.config.enableMfa, true);
  });

  it('should reject security-config with short hmacSecret', () => {
    assert.throws(
      () => ob.completeStep('security-config', { hmacSecret: 'short' }),
      /hmacSecret must be at least 16 characters/
    );
  });

  it('should accept security-config without hmacSecret', () => {
    const step = ob.completeStep('security-config', { enableMfa: false });
    assert.equal(step.status, 'completed');
  });

  it('should complete data-directory step with absolute path', () => {
    const step = ob.completeStep('data-directory', { dataDir: '/tmp/clawcc-test-data' });
    assert.equal(step.status, 'completed');
  });

  it('should reject data-directory with relative path', () => {
    assert.throws(
      () => ob.completeStep('data-directory', { dataDir: 'relative/path' }),
      /dataDir must be an absolute path/
    );
  });

  it('should complete first-node step', () => {
    const step = ob.completeStep('first-node', { nodeName: 'my-node', nodeSecret: 'abcdef1234567890' });
    assert.equal(step.status, 'completed');
  });

  it('should reject first-node with short nodeSecret', () => {
    assert.throws(
      () => ob.completeStep('first-node', { nodeName: 'node1', nodeSecret: 'short' }),
      /nodeSecret must be at least 16 characters/
    );
  });

  it('should reject first-node with empty nodeName', () => {
    assert.throws(
      () => ob.completeStep('first-node', { nodeName: '', nodeSecret: 'abcdef1234567890' }),
      /nodeName must be 1-64 characters/
    );
  });

  it('should finalize setup on complete step', () => {
    ob.completeStep('welcome');
    ob.completeStep('admin-account', { username: 'admin1', password: 'password1234' });
    ob.completeStep('security-config', { enableMfa: false });
    ob.completeStep('data-directory', { dataDir: '/tmp/data' });
    ob.completeStep('first-node', { nodeName: 'node1', nodeSecret: 'abcdef1234567890' });
    ob.completeStep('security-scan', { results: { critical: [], warnings: [] } });
    ob.completeStep('complete');
    assert.equal(ob.isComplete(), true);
    const state = ob.getState();
    assert.equal(state.completed, true);
    assert.ok(state.completedAt > 0);
  });

  it('should throw when completing step before setup starts', () => {
    const ob2 = createOnboarding({ dataDir: makeTmpDir() });
    assert.throws(() => ob2.completeStep('welcome'), /Setup not started/);
  });

  it('should throw for unknown step', () => {
    assert.throws(() => ob.completeStep('nonexistent'), /Unknown step/);
  });
});

describe('Onboarding - step skipping', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
    ob.startSetup();
  });
  afterEach(() => cleanup(tmpDir));

  it('should skip a skippable step', () => {
    const step = ob.skipStep('admin-account');
    assert.equal(step.status, 'skipped');
    assert.ok(step.completedAt > 0);
  });

  it('should not allow skipping welcome', () => {
    assert.throws(() => ob.skipStep('welcome'), /cannot be skipped/);
  });

  it('should not allow skipping complete', () => {
    assert.throws(() => ob.skipStep('complete'), /cannot be skipped/);
  });

  it('should throw when skipping before setup starts', () => {
    const ob2 = createOnboarding({ dataDir: makeTmpDir() });
    assert.throws(() => ob2.skipStep('admin-account'), /Setup not started/);
  });
});

describe('Onboarding - progress tracking', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
  });
  afterEach(() => cleanup(tmpDir));

  it('should show 0% before setup starts', () => {
    const p = ob.getProgress();
    assert.equal(p.completedSteps, 0);
    assert.equal(p.totalSteps, 7);
    assert.equal(p.percentComplete, 0);
  });

  it('should track completed steps', () => {
    ob.startSetup();
    ob.completeStep('welcome');
    ob.completeStep('admin-account', { username: 'admin1', password: 'password1234' });
    const p = ob.getProgress();
    assert.equal(p.completedSteps, 2);
    assert.equal(p.percentComplete, 29);
  });

  it('should count skipped steps as completed', () => {
    ob.startSetup();
    ob.completeStep('welcome');
    ob.skipStep('admin-account');
    const p = ob.getProgress();
    assert.equal(p.completedSteps, 2);
  });
});

describe('Onboarding - security scan', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
    ob.startSetup();
  });
  afterEach(() => cleanup(tmpDir));

  it('should run security scan and categorize results', () => {
    const doctor = createMockDoctor();
    const results = ob.runSecurityScan(doctor);
    assert.ok(Array.isArray(results.critical));
    assert.ok(Array.isArray(results.warnings));
    assert.ok(Array.isArray(results.passed));
    assert.ok(Array.isArray(results.fixable));
    assert.equal(results.critical.length, 1);
    assert.equal(results.warnings.length, 1);
    assert.equal(results.passed.length, 1);
    assert.equal(results.fixable.length, 2);
  });

  it('should throw without doctor module', () => {
    assert.throws(() => ob.runSecurityScan(null), /Doctor module is required/);
  });
});

describe('Onboarding - config generation', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
    ob.startSetup();
  });
  afterEach(() => cleanup(tmpDir));

  it('should generate empty config when no steps completed', () => {
    const cfg = ob.generateConfig();
    assert.deepEqual(cfg, {});
  });

  it('should generate config from accumulated choices', () => {
    ob.completeStep('welcome');
    ob.completeStep('admin-account', { username: 'myadmin', password: 'password1234' });
    ob.completeStep('security-config', { hmacSecret: 'abcdef1234567890ab', enableMfa: true, enableTls: false });
    ob.completeStep('data-directory', { dataDir: '/var/clawcc/data' });
    ob.completeStep('first-node', { nodeName: 'prod-node-1', nodeSecret: 'nodesecret1234567890' });
    const cfg = ob.generateConfig();
    assert.equal(cfg.adminUsername, 'myadmin');
    assert.equal(cfg.hmacSecret, 'abcdef1234567890ab');
    assert.equal(cfg.enableMfa, true);
    assert.equal(cfg.enableTls, false);
    assert.equal(cfg.dataDir, '/var/clawcc/data');
    assert.ok(cfg.fleet);
    assert.equal(cfg.fleet.nodeSecrets['prod-node-1'], 'nodesecret1234567890');
  });
});

describe('Onboarding - reset', () => {
  let tmpDir, ob;
  beforeEach(() => {
    tmpDir = makeTmpDir();
    ob = createOnboarding({ dataDir: tmpDir });
    ob.startSetup();
  });
  afterEach(() => cleanup(tmpDir));

  it('should reset to initial state', () => {
    ob.completeStep('welcome');
    ob.completeStep('admin-account', { username: 'admin1', password: 'password1234' });
    const state = ob.resetSetup();
    assert.equal(state.completed, false);
    assert.equal(state.currentStep, 0);
    for (const step of state.steps) {
      assert.equal(step.status, 'pending');
    }
    assert.deepEqual(state.config, {});
  });
});
