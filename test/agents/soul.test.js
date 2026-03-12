'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createAgentTracker } = require('../../control-plane/lib/agents');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-soul-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgentData(overrides = {}) {
  return {
    nodeId: 'node-1',
    type: 'claude',
    name: 'Test Agent',
    ...overrides
  };
}

// -- SOUL set/get tests --

describe('Agent SOUL - set and get', () => {
  it('should set and get SOUL content', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    const soulContent = '# Agent SOUL\n\nYou are a helpful coding assistant.';
    tracker.setSoul(agentId, soulContent);
    const soul = tracker.getSoul(agentId);
    assert.equal(soul, soulContent);
  });

  it('should return null for agent with no SOUL', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    const soul = tracker.getSoul(agentId);
    assert.equal(soul, null);
  });

  it('should throw for non-existent agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.setSoul('ghost', 'content'), /not found/);
    assert.throws(() => tracker.getSoul('ghost'), /not found/);
  });
});

// -- SOUL disk persistence tests --

describe('Agent SOUL - disk persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist SOUL to disk and read it back', () => {
    tmpDir = makeTmpDir();
    const tracker = createAgentTracker({ dataDir: tmpDir });
    const agentId = tracker.registerAgent(makeAgentData({ agentId: 'soul-persist' }));
    tracker.setSoul(agentId, '# My Soul\nBe kind.');

    // Verify file was written
    const soulPath = path.join(tmpDir, 'agents', 'souls', 'soul-persist.md');
    assert.ok(fs.existsSync(soulPath));
    assert.equal(fs.readFileSync(soulPath, 'utf8'), '# My Soul\nBe kind.');
  });
});

// -- SOUL sync from disk tests --

describe('Agent SOUL - sync from disk', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should sync SOULs from disk files', () => {
    tmpDir = makeTmpDir();
    const tracker = createAgentTracker({ dataDir: tmpDir });
    const agentId = tracker.registerAgent(makeAgentData({ agentId: 'sync-agent' }));

    // Write a soul file directly to disk
    const soulsDir = path.join(tmpDir, 'agents', 'souls');
    fs.mkdirSync(soulsDir, { recursive: true });
    fs.writeFileSync(path.join(soulsDir, 'sync-agent.md'), '# Synced Soul');

    const synced = tracker.syncSoulsFromDisk();
    assert.ok(synced.includes('sync-agent'));
    assert.equal(tracker.getSoul(agentId), '# Synced Soul');
  });
});

// -- SOUL export test --

describe('Agent SOUL - export', () => {
  it('should export soul with agent metadata', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData({ agentId: 'export-agent', name: 'Exporter', type: 'claude' }));
    tracker.setSoul(agentId, '# Export Soul');

    const exported = tracker.exportSoul(agentId);
    assert.equal(exported.agentId, 'export-agent');
    assert.equal(exported.name, 'Exporter');
    assert.equal(exported.type, 'claude');
    assert.equal(exported.soul, '# Export Soul');
  });
});
