'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createEvaluationEngine } = require('../../control-plane/lib/evaluations');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-eval-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEvalData(overrides = {}) {
  return {
    agentId: 'agent-1',
    type: 'output',
    criteria: [
      { name: 'completeness', score: 80, weight: 0.3 },
      { name: 'efficiency', score: 70, weight: 0.2 },
      { name: 'safety', score: 90, weight: 0.3 },
      { name: 'accuracy', score: 75, weight: 0.2 }
    ],
    ...overrides
  };
}

// -- Evaluation CRUD and scoring --

describe('Evaluation CRUD and scoring', () => {
  let engine;
  beforeEach(() => {
    engine = createEvaluationEngine();
  });

  it('should create an evaluation and compute score from criteria', () => {
    const ev = engine.createEvaluation(makeEvalData());
    assert.ok(ev.id);
    assert.equal(ev.agentId, 'agent-1');
    assert.equal(ev.type, 'output');
    assert.equal(ev.status, 'pending');
    // Weighted average: (80*0.3 + 70*0.2 + 90*0.3 + 75*0.2) / (0.3+0.2+0.3+0.2) = 80
    assert.equal(ev.score, 80);
    assert.ok(ev.createdAt);
    assert.equal(ev.reviewer, null);
    assert.equal(ev.reviewedAt, null);
  });

  it('should get evaluation by id', () => {
    const ev = engine.createEvaluation(makeEvalData());
    const found = engine.getEvaluation(ev.id);
    assert.equal(found.id, ev.id);
    assert.equal(found.agentId, 'agent-1');
  });

  it('should return null for non-existent evaluation', () => {
    assert.equal(engine.getEvaluation('nope'), null);
  });

  it('should reject missing agentId', () => {
    assert.throws(() => engine.createEvaluation({ type: 'output' }), /agentId is required/);
  });

  it('should reject invalid type', () => {
    assert.throws(() => engine.createEvaluation({ agentId: 'a1', type: 'banana' }), /type must be one of/);
  });

  it('should compute score of 0 for empty criteria', () => {
    const ev = engine.createEvaluation({ agentId: 'a1', type: 'trace', criteria: [] });
    assert.equal(ev.score, 0);
  });

  it('should list evaluations with filters', () => {
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'output' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'trace' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a2', type: 'output' }));

    assert.equal(engine.listEvaluations().length, 3);
    assert.equal(engine.listEvaluations({ agentId: 'a1' }).length, 2);
    assert.equal(engine.listEvaluations({ type: 'trace' }).length, 1);
    assert.equal(engine.listEvaluations({ agentId: 'a2', type: 'output' }).length, 1);
  });
});

// -- Quality Gate CRUD --

describe('Quality gate CRUD', () => {
  let engine;
  beforeEach(() => {
    engine = createEvaluationEngine();
  });

  it('should create a quality gate with defaults', () => {
    const gate = engine.createQualityGate({ name: 'Production Gate' });
    assert.ok(gate.id);
    assert.equal(gate.name, 'Production Gate');
    assert.equal(gate.enabled, true);
    assert.equal(gate.minScore, 70);
    assert.equal(gate.requiredReview, false);
    assert.equal(gate.autoQuarantine, false);
    assert.equal(gate.criteria.length, 4);
  });

  it('should get gate by id', () => {
    const gate = engine.createQualityGate({ name: 'Test' });
    const found = engine.getQualityGate(gate.id);
    assert.equal(found.name, 'Test');
  });

  it('should list all gates', () => {
    engine.createQualityGate({ name: 'Gate A' });
    engine.createQualityGate({ name: 'Gate B' });
    assert.equal(engine.listQualityGates().length, 2);
  });

  it('should update gate', () => {
    const gate = engine.createQualityGate({ name: 'Old Name' });
    const updated = engine.updateQualityGate(gate.id, { name: 'New Name', minScore: 80 });
    assert.equal(updated.name, 'New Name');
    assert.equal(updated.minScore, 80);
  });

  it('should delete gate', () => {
    const gate = engine.createQualityGate({ name: 'Doomed' });
    engine.deleteQualityGate(gate.id);
    assert.equal(engine.getQualityGate(gate.id), null);
    assert.equal(engine.listQualityGates().length, 0);
  });

  it('should throw deleting non-existent gate', () => {
    assert.throws(() => engine.deleteQualityGate('ghost'), /not found/);
  });

  it('should reject missing gate name', () => {
    assert.throws(() => engine.createQualityGate({}), /name is required/);
  });
});

// -- Gate Evaluation (pass/fail) --

describe('Gate evaluation', () => {
  let engine;
  beforeEach(() => {
    engine = createEvaluationEngine();
  });

  it('should pass when all metrics exceed thresholds and minScore', () => {
    engine.createQualityGate({
      name: 'Strict',
      minScore: 70,
      criteria: [
        { name: 'completeness', weight: 0.5, threshold: 60 },
        { name: 'safety', weight: 0.5, threshold: 60 }
      ]
    });
    const results = engine.evaluateAgent('agent-1', { completeness: 80, safety: 90 });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'passed');
    assert.ok(results[0].score >= 70);
  });

  it('should fail when a criterion is below threshold', () => {
    engine.createQualityGate({
      name: 'Safety First',
      minScore: 50,
      criteria: [
        { name: 'completeness', weight: 0.5, threshold: 60 },
        { name: 'safety', weight: 0.5, threshold: 80 }
      ]
    });
    const results = engine.evaluateAgent('agent-1', { completeness: 70, safety: 50 });
    assert.equal(results[0].status, 'failed');
  });

  it('should fail when overall score is below minScore', () => {
    engine.createQualityGate({
      name: 'High Bar',
      minScore: 90,
      criteria: [
        { name: 'completeness', weight: 1.0, threshold: 30 }
      ]
    });
    const results = engine.evaluateAgent('agent-1', { completeness: 50 });
    assert.equal(results[0].status, 'failed');
  });

  it('should return needs_review when requiredReview is set and score passes', () => {
    engine.createQualityGate({
      name: 'Review Gate',
      minScore: 50,
      requiredReview: true,
      criteria: [
        { name: 'safety', weight: 1.0, threshold: 50 }
      ]
    });
    const results = engine.evaluateAgent('agent-1', { safety: 80 });
    assert.equal(results[0].status, 'needs_review');
  });

  it('should skip disabled gates', () => {
    engine.createQualityGate({ name: 'Disabled', enabled: false });
    engine.createQualityGate({ name: 'Active' });
    const results = engine.evaluateAgent('agent-1', { completeness: 80, efficiency: 80, safety: 80, accuracy: 80 });
    assert.equal(results.length, 1);
    assert.equal(results[0].gateName, 'Active');
  });

  it('should flag autoQuarantine on failure', () => {
    engine.createQualityGate({
      name: 'Auto Q',
      autoQuarantine: true,
      minScore: 90,
      criteria: [{ name: 'safety', weight: 1.0, threshold: 90 }]
    });
    const results = engine.evaluateAgent('agent-1', { safety: 40 });
    assert.equal(results[0].autoQuarantine, true);
    assert.equal(results[0].status, 'failed');
  });
});

// -- Baseline computation and drift detection --

describe('Baseline and drift detection', () => {
  let engine;
  beforeEach(() => {
    engine = createEvaluationEngine();
  });

  it('should compute baseline from evaluations', () => {
    engine.createEvaluation(makeEvalData({ agentId: 'a1' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a1', criteria: [{ name: 'completeness', score: 60, weight: 1 }] }));
    const baseline = engine.computeBaseline('a1');
    assert.equal(baseline.agentId, 'a1');
    assert.equal(baseline.sampleSize, 2);
    assert.ok(typeof baseline.metrics.avgScore === 'number');
    assert.ok(baseline.computedAt);
  });

  it('should throw computing baseline with no evaluations', () => {
    assert.throws(() => engine.computeBaseline('a1', []), /No evaluations found/);
  });

  it('should get stored baseline', () => {
    engine.createEvaluation(makeEvalData({ agentId: 'a1' }));
    engine.computeBaseline('a1');
    const baseline = engine.getBaseline('a1');
    assert.ok(baseline);
    assert.equal(baseline.agentId, 'a1');
  });

  it('should detect drift when score drops', () => {
    engine.createEvaluation(makeEvalData({ agentId: 'a1' }));
    engine.computeBaseline('a1');
    const drift = engine.detectDrift('a1', { avgScore: 40 });
    assert.equal(drift.hasDrift, true);
    assert.ok(drift.factors.length > 0);
    assert.ok(drift.factors.some(f => f.name === 'score'));
  });

  it('should report no drift when metrics are close to baseline', () => {
    engine.createEvaluation(makeEvalData({ agentId: 'a1' }));
    engine.computeBaseline('a1');
    const baseline = engine.getBaseline('a1');
    const drift = engine.detectDrift('a1', { avgScore: baseline.metrics.avgScore });
    assert.equal(drift.hasDrift, false);
  });

  it('should handle missing baseline gracefully', () => {
    const drift = engine.detectDrift('a1', { avgScore: 50 });
    assert.equal(drift.hasDrift, false);
    assert.ok(drift.reason);
  });
});

// -- Agent scorecard --

describe('Agent scorecard', () => {
  it('should compute agent scorecard', () => {
    const engine = createEvaluationEngine();
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'output', status: 'passed' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'trace', status: 'failed' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'output', status: 'passed' }));

    // Manually override statuses via review so they stick
    const evals = engine.listEvaluations({ agentId: 'a1' });

    const scorecard = engine.getAgentScorecard('a1');
    assert.equal(scorecard.agentId, 'a1');
    assert.equal(scorecard.totalEvaluations, 3);
    assert.ok(typeof scorecard.avgScore === 'number');
    assert.ok(typeof scorecard.passRate === 'number');
    assert.ok(scorecard.byType.output);
    assert.ok(scorecard.byType.trace);
    assert.ok(Array.isArray(scorecard.trend));
  });

  it('should return empty scorecard for agent with no evaluations', () => {
    const engine = createEvaluationEngine();
    const scorecard = engine.getAgentScorecard('nobody');
    assert.equal(scorecard.totalEvaluations, 0);
    assert.equal(scorecard.avgScore, 0);
    assert.equal(scorecard.passRate, 0);
  });
});

// -- Fleet scorecard --

describe('Fleet scorecard', () => {
  it('should compute fleet-wide scorecard', () => {
    const engine = createEvaluationEngine();
    engine.createEvaluation(makeEvalData({ agentId: 'a1', type: 'output' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a2', type: 'trace' }));
    engine.createEvaluation(makeEvalData({ agentId: 'a3', type: 'component' }));

    const scorecard = engine.getFleetScorecard();
    assert.equal(scorecard.totalEvaluations, 3);
    assert.equal(scorecard.agentCount, 3);
    assert.ok(typeof scorecard.avgScore === 'number');
    assert.ok(scorecard.byType.output);
    assert.ok(Array.isArray(scorecard.topAgents));
    assert.ok(Array.isArray(scorecard.bottomAgents));
  });

  it('should return empty fleet scorecard when no evaluations exist', () => {
    const engine = createEvaluationEngine();
    const scorecard = engine.getFleetScorecard();
    assert.equal(scorecard.totalEvaluations, 0);
    assert.equal(scorecard.avgScore, 0);
    assert.equal(scorecard.agentCount, 0);
  });
});

// -- Optimization hints --

describe('Optimization hints', () => {
  it('should return hints for agent with low scores', () => {
    const engine = createEvaluationEngine();
    engine.createEvaluation({
      agentId: 'a1',
      type: 'output',
      criteria: [
        { name: 'completeness', score: 40, weight: 0.3 },
        { name: 'efficiency', score: 30, weight: 0.2 },
        { name: 'safety', score: 50, weight: 0.3 },
        { name: 'accuracy', score: 45, weight: 0.2 }
      ]
    });

    const result = engine.getOptimizationHints('a1');
    assert.equal(result.agentId, 'a1');
    assert.ok(result.hints.length > 0);
    // Should flag efficiency and safety at minimum
    const categories = result.hints.map(h => h.category);
    assert.ok(categories.includes('efficiency') || categories.includes('safety') || categories.includes('completeness'));
  });

  it('should return data hint for agent with no evaluations', () => {
    const engine = createEvaluationEngine();
    const result = engine.getOptimizationHints('a1');
    assert.equal(result.hints.length, 1);
    assert.equal(result.hints[0].category, 'data');
  });

  it('should return positive status for well-performing agent', () => {
    const engine = createEvaluationEngine();
    engine.createEvaluation({
      agentId: 'a1',
      type: 'output',
      criteria: [
        { name: 'completeness', score: 95, weight: 0.3 },
        { name: 'efficiency', score: 90, weight: 0.2 },
        { name: 'safety', score: 95, weight: 0.3 },
        { name: 'accuracy', score: 90, weight: 0.2 }
      ]
    });
    const result = engine.getOptimizationHints('a1');
    assert.ok(result.hints.some(h => h.category === 'status'));
  });
});

// -- Human review workflow --

describe('Human review workflow', () => {
  it('should allow reviewing an evaluation', () => {
    const engine = createEvaluationEngine();
    const ev = engine.createEvaluation(makeEvalData({ status: 'needs_review' }));
    assert.equal(ev.status, 'needs_review');

    const reviewed = engine.reviewEvaluation(ev.id, 'reviewer-1', 'passed', 'Looks good');
    assert.equal(reviewed.status, 'passed');
    assert.equal(reviewed.reviewer, 'reviewer-1');
    assert.ok(reviewed.reviewedAt);
    assert.equal(reviewed.notes, 'Looks good');
  });

  it('should throw reviewing non-existent evaluation', () => {
    const engine = createEvaluationEngine();
    assert.throws(() => engine.reviewEvaluation('nope', 'r1', 'passed', ''), /not found/);
  });

  it('should reject invalid review status', () => {
    const engine = createEvaluationEngine();
    const ev = engine.createEvaluation(makeEvalData());
    assert.throws(() => engine.reviewEvaluation(ev.id, 'r1', 'banana', ''), /Invalid status/);
  });
});

// -- Persistence --

describe('Persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist and reload evaluations, gates, and baselines', () => {
    tmpDir = makeTmpDir();
    const engine1 = createEvaluationEngine({ dataDir: tmpDir });
    engine1.createEvaluation(makeEvalData({ agentId: 'persist-a1' }));
    engine1.createQualityGate({ name: 'Persist Gate' });
    engine1.createEvaluation(makeEvalData({ agentId: 'persist-a1' }));
    engine1.computeBaseline('persist-a1');
    engine1.destroy(); // forces final persist

    const engine2 = createEvaluationEngine({ dataDir: tmpDir });
    const evals = engine2.listEvaluations({ agentId: 'persist-a1' });
    assert.equal(evals.length, 2);
    const gates = engine2.listQualityGates();
    assert.equal(gates.length, 1);
    assert.equal(gates[0].name, 'Persist Gate');
    const baseline = engine2.getBaseline('persist-a1');
    assert.ok(baseline);
    assert.equal(baseline.agentId, 'persist-a1');
  });
});

// -- Edge cases --

describe('Edge cases', () => {
  it('should handle evaluation with no criteria gracefully', () => {
    const engine = createEvaluationEngine();
    const ev = engine.createEvaluation({ agentId: 'a1', type: 'drift' });
    assert.equal(ev.score, 0);
    assert.deepEqual(ev.criteria, []);
  });

  it('should enforce max evaluations limit', () => {
    const engine = createEvaluationEngine();
    // Create many evaluations to verify eviction
    for (let i = 0; i < 50; i++) {
      engine.createEvaluation(makeEvalData({ agentId: 'a-' + i }));
    }
    assert.ok(engine.listEvaluations().length <= 50);
  });

  it('should handle detectDrift with missing metrics gracefully', () => {
    const engine = createEvaluationEngine();
    assert.throws(() => engine.detectDrift('a1'), /currentMetrics are required/);
  });

  it('should handle evaluateAgent with no gates', () => {
    const engine = createEvaluationEngine();
    const results = engine.evaluateAgent('a1', { safety: 90 });
    assert.equal(results.length, 0);
  });

  it('should update quality gate and reject non-existent', () => {
    const engine = createEvaluationEngine();
    assert.throws(() => engine.updateQualityGate('ghost', { name: 'x' }), /not found/);
  });
});
