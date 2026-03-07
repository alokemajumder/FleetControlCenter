'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { createPolicyEngine } = require('../../control-plane/lib/policy');

describe('Load policy', () => {
  it('should load a valid policy', () => {
    const engine = createPolicyEngine();
    const policy = engine.loadPolicy({
      id: 'policy-1',
      name: 'Test Policy',
      rules: [{ field: 'type', operator: 'eq', value: 'command', score: 10 }],
      enforcement: { ladder: [{ threshold: 50, action: 'warn' }] }
    });
    assert.equal(policy.id, 'policy-1');
    assert.equal(policy.name, 'Test Policy');
    assert.equal(policy.rules.length, 1);
  });

  it('should reject policy without id', () => {
    const engine = createPolicyEngine();
    assert.throws(() => engine.loadPolicy({ name: 'No ID' }), /must have id/);
  });

  it('should reject policy without name', () => {
    const engine = createPolicyEngine();
    assert.throws(() => engine.loadPolicy({ id: 'p1' }), /must have.*name/);
  });
});

describe('Rule matching operators', () => {
  let engine;
  beforeEach(() => { engine = createPolicyEngine(); });

  it('eq: matches equal values', () => {
    const rule = { field: 'type', operator: 'eq', value: 'command', score: 10 };
    assert.ok(engine.evaluateRule(rule, { type: 'command' }));
    assert.ok(!engine.evaluateRule(rule, { type: 'file' }));
  });

  it('gte: matches greater than or equal', () => {
    const rule = { field: 'count', operator: 'gte', value: 5, score: 10 };
    assert.ok(engine.evaluateRule(rule, { count: 5 }));
    assert.ok(engine.evaluateRule(rule, { count: 10 }));
    assert.ok(!engine.evaluateRule(rule, { count: 3 }));
  });

  it('lte: matches less than or equal', () => {
    const rule = { field: 'count', operator: 'lte', value: 5, score: 10 };
    assert.ok(engine.evaluateRule(rule, { count: 5 }));
    assert.ok(engine.evaluateRule(rule, { count: 3 }));
    assert.ok(!engine.evaluateRule(rule, { count: 10 }));
  });

  it('matches: regex matching', () => {
    const rule = { field: 'command', operator: 'matches', value: '^rm\\s+-rf', score: 20 };
    assert.ok(engine.evaluateRule(rule, { command: 'rm -rf /tmp' }));
    assert.ok(!engine.evaluateRule(rule, { command: 'ls -la' }));
  });

  it('contains: substring matching', () => {
    const rule = { field: 'payload', operator: 'contains', value: 'password', score: 15 };
    assert.ok(engine.evaluateRule(rule, { payload: 'set password=abc' }));
    assert.ok(!engine.evaluateRule(rule, { payload: 'hello world' }));
  });

  it('returns false for missing field', () => {
    const rule = { field: 'missing', operator: 'eq', value: 'x', score: 10 };
    assert.ok(!engine.evaluateRule(rule, { other: 'value' }));
  });

  it('supports nested field access', () => {
    const rule = { field: 'meta.source', operator: 'eq', value: 'agent', score: 5 };
    assert.ok(engine.evaluateRule(rule, { meta: { source: 'agent' } }));
  });
});

describe('Drift score evaluation', () => {
  let engine;
  beforeEach(() => {
    engine = createPolicyEngine();
    engine.loadPolicy({
      id: 'drift-1',
      name: 'Drift Detection',
      rules: [
        { field: 'type', operator: 'eq', value: 'file_write', score: 10 },
        { field: 'type', operator: 'eq', value: 'network_access', score: 20 },
        { field: 'severity', operator: 'eq', value: 'critical', score: 50 }
      ],
      enforcement: {
        ladder: [
          { threshold: 10, action: 'log' },
          { threshold: 30, action: 'warn' },
          { threshold: 50, action: 'pause' },
          { threshold: 100, action: 'kill' }
        ]
      }
    });
  });

  it('should calculate drift score from events', () => {
    const events = [
      { type: 'file_write', severity: 'info' },
      { type: 'network_access', severity: 'warning' }
    ];
    const result = engine.evaluateDriftScore(events, 'drift-1');
    assert.equal(result.score, 30); // 10 + 20
    assert.equal(result.matched.length, 2);
  });

  it('should accumulate score across multiple matching events', () => {
    const events = [
      { type: 'file_write', severity: 'info' },
      { type: 'file_write', severity: 'info' },
      { type: 'file_write', severity: 'critical' }
    ];
    const result = engine.evaluateDriftScore(events, 'drift-1');
    // 3 file_writes (10*3) + 1 critical (50) = 80
    assert.equal(result.score, 80);
  });
});

describe('Enforcement ladder', () => {
  let engine;
  beforeEach(() => {
    engine = createPolicyEngine();
    engine.loadPolicy({
      id: 'enforce-1',
      name: 'Enforcement Test',
      rules: [],
      enforcement: {
        ladder: [
          { threshold: 10, action: 'log' },
          { threshold: 30, action: 'warn' },
          { threshold: 50, action: 'pause' },
          { threshold: 100, action: 'kill' }
        ]
      }
    });
  });

  it('should return none for score below all thresholds', () => {
    assert.equal(engine.getEnforcementAction(5, 'enforce-1'), 'none');
  });

  it('should return log for score >= 10', () => {
    assert.equal(engine.getEnforcementAction(10, 'enforce-1'), 'log');
  });

  it('should return warn for score >= 30', () => {
    assert.equal(engine.getEnforcementAction(35, 'enforce-1'), 'warn');
  });

  it('should return pause for score >= 50', () => {
    assert.equal(engine.getEnforcementAction(50, 'enforce-1'), 'pause');
  });

  it('should return kill for score >= 100', () => {
    assert.equal(engine.getEnforcementAction(150, 'enforce-1'), 'kill');
  });
});

describe('Policy simulation', () => {
  it('should simulate policy on events and return action', () => {
    const engine = createPolicyEngine();
    engine.loadPolicy({
      id: 'sim-1',
      name: 'Simulation',
      rules: [
        { field: 'type', operator: 'eq', value: 'shell_exec', score: 25 },
        { field: 'type', operator: 'eq', value: 'file_delete', score: 30 }
      ],
      enforcement: {
        ladder: [
          { threshold: 20, action: 'warn' },
          { threshold: 50, action: 'kill' }
        ]
      }
    });

    const events = [
      { type: 'shell_exec' },
      { type: 'file_delete' }
    ];
    const result = engine.simulate(events, 'sim-1');
    assert.equal(result.score, 55);
    assert.equal(result.action, 'kill');
  });
});

describe('Multiple policies and priority', () => {
  it('should list policies sorted by priority', () => {
    const engine = createPolicyEngine();
    engine.loadPolicy({ id: 'low', name: 'Low', priority: 1, rules: [] });
    engine.loadPolicy({ id: 'high', name: 'High', priority: 10, rules: [] });
    engine.loadPolicy({ id: 'mid', name: 'Mid', priority: 5, rules: [] });

    const list = engine.listPolicies();
    assert.equal(list[0].id, 'high');
    assert.equal(list[1].id, 'mid');
    assert.equal(list[2].id, 'low');
  });
});

describe('Disabled policy', () => {
  it('should skip disabled policy in drift evaluation', () => {
    const engine = createPolicyEngine();
    engine.loadPolicy({
      id: 'disabled-1',
      name: 'Disabled',
      enabled: false,
      rules: [{ field: 'type', operator: 'eq', value: 'any', score: 100 }],
      enforcement: { ladder: [{ threshold: 10, action: 'kill' }] }
    });

    const result = engine.evaluateDriftScore([{ type: 'any' }], 'disabled-1');
    assert.equal(result.score, 0);
    assert.equal(result.matched.length, 0);
  });
});
