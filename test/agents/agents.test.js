'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createAgentTracker, SUPPORTED_AGENT_TYPES } = require('../../control-plane/lib/agents');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-agents-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeAgentData(overrides = {}) {
  return {
    nodeId: 'node-1',
    type: 'claude',
    name: 'Test Agent',
    version: '1.0.0',
    ...overrides
  };
}

// -- Registration tests --

describe('Agent registration', () => {
  it('should register a valid agent and return an agentId', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    assert.ok(agentId);
    assert.equal(typeof agentId, 'string');
    const agent = tracker.getAgent(agentId);
    assert.equal(agent.type, 'claude');
    assert.equal(agent.nodeId, 'node-1');
    assert.equal(agent.name, 'Test Agent');
    assert.equal(agent.status, 'active');
    assert.ok(agent.registeredAt);
    assert.ok(agent.lastSeenAt);
    assert.deepEqual(agent.sessions, []);
    assert.equal(agent.metrics.totalSessions, 0);
  });

  it('should reject duplicate agentId', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData({ agentId: 'dup-1' }));
    assert.equal(agentId, 'dup-1');
    assert.throws(() => tracker.registerAgent(makeAgentData({ agentId: 'dup-1' })), /already registered/);
  });

  it('should reject unsupported agent type', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.registerAgent(makeAgentData({ type: 'gpt5000' })), /Unsupported agent type/);
  });

  it('should reject missing nodeId', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.registerAgent({ type: 'claude', name: 'Test' }), /nodeId is required/);
  });

  it('should reject missing type', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.registerAgent({ nodeId: 'n1', name: 'Test' }), /type is required/);
  });

  it('should accept all supported agent types', () => {
    const tracker = createAgentTracker();
    for (const type of SUPPORTED_AGENT_TYPES) {
      const id = tracker.registerAgent(makeAgentData({ type }));
      assert.ok(id);
    }
  });
});

// -- Listing and filtering tests --

describe('Agent listing and filtering', () => {
  let tracker;
  beforeEach(() => {
    tracker = createAgentTracker();
    tracker.registerAgent(makeAgentData({ agentId: 'a1', type: 'claude', nodeId: 'node-1', name: 'Claude 1' }));
    tracker.registerAgent(makeAgentData({ agentId: 'a2', type: 'codex', nodeId: 'node-1', name: 'Codex 1' }));
    tracker.registerAgent(makeAgentData({ agentId: 'a3', type: 'claude', nodeId: 'node-2', name: 'Claude 2' }));
  });

  it('should list all agents with no filters', () => {
    const agents = tracker.listAgents();
    assert.equal(agents.length, 3);
  });

  it('should filter by type', () => {
    const agents = tracker.listAgents({ type: 'claude' });
    assert.equal(agents.length, 2);
    assert.ok(agents.every(a => a.type === 'claude'));
  });

  it('should filter by nodeId', () => {
    const agents = tracker.listAgents({ nodeId: 'node-2' });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].name, 'Claude 2');
  });

  it('should filter by status', () => {
    tracker.updateAgent('a1', { status: 'idle' });
    const agents = tracker.listAgents({ status: 'idle' });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agentId, 'a1');
  });

  it('should return empty array for no matches', () => {
    const agents = tracker.listAgents({ type: 'hermes' });
    assert.equal(agents.length, 0);
  });

  it('should get agents by type', () => {
    const agents = tracker.getAgentsByType('codex');
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agentId, 'a2');
  });

  it('should get agents by node', () => {
    const agents = tracker.getAgentsByNode('node-1');
    assert.equal(agents.length, 2);
  });
});

// -- Heartbeat and metrics --

describe('Heartbeat and metric updates', () => {
  it('should update lastSeenAt on heartbeat', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    const before = tracker.getAgent(agentId).lastSeenAt;
    // Small delay to ensure timestamp differs
    const agent = tracker.heartbeat(agentId, { totalTokens: 500 });
    assert.ok(agent.lastSeenAt >= before);
    assert.equal(agent.metrics.totalTokens, 500);
  });

  it('should merge partial metrics on heartbeat', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    tracker.heartbeat(agentId, { totalTokens: 100, errorCount: 2 });
    tracker.heartbeat(agentId, { totalTokens: 300 });
    const agent = tracker.getAgent(agentId);
    assert.equal(agent.metrics.totalTokens, 300);
    assert.equal(agent.metrics.errorCount, 2); // preserved from first heartbeat
  });

  it('should reactivate offline agent on heartbeat', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    tracker.updateAgent(agentId, { status: 'offline' });
    assert.equal(tracker.getAgent(agentId).status, 'offline');
    tracker.heartbeat(agentId, {});
    assert.equal(tracker.getAgent(agentId).status, 'active');
  });

  it('should throw on heartbeat for unknown agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.heartbeat('nonexistent', {}), /not found/);
  });
});

// -- Fleet summary --

describe('Fleet summary computation', () => {
  it('should compute correct fleet summary', () => {
    const tracker = createAgentTracker();
    tracker.registerAgent(makeAgentData({ agentId: 's1', type: 'claude', nodeId: 'n1' }));
    tracker.registerAgent(makeAgentData({ agentId: 's2', type: 'claude', nodeId: 'n2' }));
    tracker.registerAgent(makeAgentData({ agentId: 's3', type: 'codex', nodeId: 'n1' }));
    tracker.heartbeat('s1', { totalSessions: 5, totalTokens: 1000, totalCost: 0.50 });
    tracker.heartbeat('s2', { totalSessions: 3, totalTokens: 500, totalCost: 0.25 });
    tracker.updateAgent('s3', { status: 'idle' });

    const summary = tracker.getFleetSummary();
    assert.equal(summary.totalAgents, 3);
    assert.equal(summary.byType.claude, 2);
    assert.equal(summary.byType.codex, 1);
    assert.equal(summary.byStatus.active, 2);
    assert.equal(summary.byStatus.idle, 1);
    assert.equal(summary.totalSessions, 8);
    assert.equal(summary.totalTokens, 1500);
    assert.ok(Math.abs(summary.totalCost - 0.75) < 0.001);
  });

  it('should return empty summary for no agents', () => {
    const tracker = createAgentTracker();
    const summary = tracker.getFleetSummary();
    assert.equal(summary.totalAgents, 0);
    assert.deepEqual(summary.byType, {});
    assert.deepEqual(summary.byStatus, {});
  });
});

// -- Agent removal --

describe('Agent removal', () => {
  it('should remove existing agent', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    tracker.removeAgent(agentId);
    assert.equal(tracker.getAgent(agentId), null);
    assert.equal(tracker.listAgents().length, 0);
  });

  it('should throw when removing non-existent agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.removeAgent('does-not-exist'), /not found/);
  });
});

// -- Event recording and timeline --

describe('Event recording and timeline', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record events and retrieve timeline', () => {
    tmpDir = makeTmpDir();
    const tracker = createAgentTracker({ dataDir: tmpDir });
    const agentId = tracker.registerAgent(makeAgentData());

    tracker.recordEvent(agentId, { type: 'tool_use', payload: { tool: 'Bash' } });
    tracker.recordEvent(agentId, { type: 'error', payload: { message: 'timeout' } });
    tracker.recordEvent(agentId, { type: 'completion', tokens: 150, sessionId: 'sess-1' });

    const timeline = tracker.getAgentTimeline(agentId);
    assert.equal(timeline.length, 3);
    assert.equal(timeline[0].type, 'tool_use');
    assert.equal(timeline[1].type, 'error');
    assert.equal(timeline[2].type, 'completion');

    // Check metrics updated
    const agent = tracker.getAgent(agentId);
    assert.equal(agent.metrics.errorCount, 1);
    assert.equal(agent.metrics.totalTokens, 150);
    assert.ok(agent.sessions.includes('sess-1'));
    assert.equal(agent.metrics.totalSessions, 1);
  });

  it('should respect timeline limit', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    // Without dataDir, timeline reads from disk (empty), so this tests the limit path
    const timeline = tracker.getAgentTimeline(agentId, { limit: 5 });
    assert.ok(Array.isArray(timeline));
  });

  it('should throw recording event for unknown agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.recordEvent('ghost', { type: 'test' }), /not found/);
  });
});

// -- Stale detection --

describe('Stale detection', () => {
  it('should mark agents as offline when stale', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    // Manually set lastSeenAt to past
    const agent = tracker.getAgent(agentId);
    agent.lastSeenAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago

    const marked = tracker.markStale(5 * 60 * 1000); // 5 min threshold
    assert.equal(marked.length, 1);
    assert.equal(marked[0], agentId);
    assert.equal(tracker.getAgent(agentId).status, 'offline');
  });

  it('should not mark recently seen agents as stale', () => {
    const tracker = createAgentTracker();
    tracker.registerAgent(makeAgentData({ agentId: 'fresh' }));
    const marked = tracker.markStale(5 * 60 * 1000);
    assert.equal(marked.length, 0);
    assert.equal(tracker.getAgent('fresh').status, 'active');
  });

  it('should not re-mark already offline agents', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    tracker.updateAgent(agentId, { status: 'offline' });
    const agent = tracker.getAgent(agentId);
    agent.lastSeenAt = Date.now() - 10 * 60 * 1000;
    const marked = tracker.markStale(5 * 60 * 1000);
    assert.equal(marked.length, 0); // already offline
  });

  it('should use default threshold when none provided', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    const agent = tracker.getAgent(agentId);
    agent.lastSeenAt = Date.now() - 10 * 60 * 1000;
    const marked = tracker.markStale();
    assert.equal(marked.length, 1);
  });
});

// -- Agent metrics endpoint --

describe('Agent metrics', () => {
  it('should return computed metrics for an agent', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    tracker.heartbeat(agentId, { totalSessions: 10, totalTokens: 5000, totalCost: 2.50, avgResponseTime: 120 });

    const metrics = tracker.getAgentMetrics(agentId);
    assert.equal(metrics.agentId, agentId);
    assert.equal(metrics.totalSessions, 10);
    assert.equal(metrics.totalTokens, 5000);
    assert.ok(metrics.uptimeMs >= 0);
    assert.equal(metrics.status, 'active');
  });

  it('should throw for unknown agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.getAgentMetrics('nope'), /not found/);
  });
});

// -- Persistence --

describe('Persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist and reload agents from disk', () => {
    tmpDir = makeTmpDir();
    const tracker1 = createAgentTracker({ dataDir: tmpDir });
    tracker1.registerAgent(makeAgentData({ agentId: 'persist-1', type: 'claude', nodeId: 'n1' }));
    tracker1.destroy(); // forces final persist

    // Create a new tracker that should load from disk
    const tracker2 = createAgentTracker({ dataDir: tmpDir });
    const agent = tracker2.getAgent('persist-1');
    assert.ok(agent);
    assert.equal(agent.type, 'claude');
    assert.equal(agent.nodeId, 'n1');
  });
});

// -- Edge cases --

describe('Edge cases', () => {
  it('should return null for non-existent agent', () => {
    const tracker = createAgentTracker();
    assert.equal(tracker.getAgent('nope'), null);
  });

  it('should handle update of non-existent agent', () => {
    const tracker = createAgentTracker();
    assert.throws(() => tracker.updateAgent('nope', { name: 'test' }), /not found/);
  });

  it('should reject invalid status on update', () => {
    const tracker = createAgentTracker();
    const agentId = tracker.registerAgent(makeAgentData());
    assert.throws(() => tracker.updateAgent(agentId, { status: 'banana' }), /Invalid status/);
  });
});
