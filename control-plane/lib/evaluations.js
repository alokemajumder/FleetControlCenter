'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VALID_TYPES = new Set(['output', 'trace', 'component', 'drift']);
const VALID_STATUSES = new Set(['pending', 'passed', 'failed', 'needs_review']);
const MAX_EVALUATIONS = 5000;
const DEBOUNCE_MS = 5000;

function createEvaluationEngine(opts = {}) {
  const dataDir = opts.dataDir || null;
  const evalsDir = dataDir ? path.join(dataDir, 'evaluations') : null;

  // In-memory stores
  const evaluations = new Map();
  const qualityGates = new Map();
  const baselines = new Map();
  let saveTimer = null;

  // Ensure directory exists
  if (evalsDir) {
    fs.mkdirSync(evalsDir, { recursive: true });
  }

  // Load persisted data on init
  if (evalsDir) {
    _loadFile('evaluations.json', evaluations);
    _loadFile('gates.json', qualityGates);
    _loadFile('baselines.json', baselines);
  }

  function _loadFile(filename, targetMap) {
    try {
      const filePath = path.join(evalsDir, filename);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object') {
        for (const [id, item] of Object.entries(data)) {
          targetMap.set(id, item);
        }
      }
    } catch { /* no persisted data yet */ }
  }

  function _persist() {
    if (!evalsDir) return;
    _saveFile('evaluations.json', evaluations);
    _saveFile('gates.json', qualityGates);
    _saveFile('baselines.json', baselines);
  }

  function _saveFile(filename, sourceMap) {
    const obj = {};
    for (const [id, item] of sourceMap) {
      obj[id] = item;
    }
    const tmpPath = path.join(evalsDir, filename + '.tmp');
    const finalPath = path.join(evalsDir, filename);
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2));
      fs.renameSync(tmpPath, finalPath);
    } catch { /* ignore write errors */ }
  }

  function scheduleSave() {
    if (!evalsDir) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      _persist();
    }, DEBOUNCE_MS);
  }

  function _computeScore(criteria) {
    if (!criteria || criteria.length === 0) return 0;
    let totalWeight = 0;
    let weightedSum = 0;
    for (const c of criteria) {
      const weight = typeof c.weight === 'number' ? c.weight : 1;
      const score = typeof c.score === 'number' ? c.score : 0;
      weightedSum += score * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  // --- Evaluation CRUD ---

  function createEvaluation(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Evaluation data is required');
    }
    if (!data.agentId) {
      throw new Error('agentId is required');
    }
    if (!data.type || !VALID_TYPES.has(data.type)) {
      throw new Error('type must be one of: ' + [...VALID_TYPES].join(', '));
    }

    const id = data.id || crypto.randomUUID();
    const criteria = Array.isArray(data.criteria) ? data.criteria : [];
    const score = _computeScore(criteria);

    const evaluation = {
      id,
      agentId: data.agentId,
      sessionId: data.sessionId || null,
      type: data.type,
      score,
      status: data.status || 'pending',
      criteria,
      reviewer: null,
      reviewedAt: null,
      notes: data.notes || '',
      // Optional performance metrics used by computeBaseline / detectDrift
      tokensUsed: typeof data.tokensUsed === 'number' ? data.tokensUsed : null,
      responseTime: typeof data.responseTime === 'number' ? data.responseTime : null,
      errorCount: typeof data.errorCount === 'number' ? data.errorCount : null,
      toolCallCount: typeof data.toolCallCount === 'number' ? data.toolCallCount : null,
      createdAt: data.createdAt || Date.now()
    };

    // Enforce max evaluations - remove oldest
    if (evaluations.size >= MAX_EVALUATIONS) {
      let oldestId = null;
      let oldestTime = Infinity;
      for (const [eid, ev] of evaluations) {
        if (ev.createdAt < oldestTime) {
          oldestTime = ev.createdAt;
          oldestId = eid;
        }
      }
      if (oldestId) evaluations.delete(oldestId);
    }

    evaluations.set(id, evaluation);
    scheduleSave();
    return evaluation;
  }

  function getEvaluation(id) {
    return evaluations.get(id) || null;
  }

  function listEvaluations(filters = {}) {
    let result = [...evaluations.values()];
    if (filters.agentId) {
      result = result.filter(e => e.agentId === filters.agentId);
    }
    if (filters.sessionId) {
      result = result.filter(e => e.sessionId === filters.sessionId);
    }
    if (filters.type) {
      result = result.filter(e => e.type === filters.type);
    }
    if (filters.status) {
      result = result.filter(e => e.status === filters.status);
    }
    return result;
  }

  function reviewEvaluation(id, reviewerId, status, notes) {
    const evaluation = evaluations.get(id);
    if (!evaluation) throw new Error('Evaluation not found: ' + id);
    if (!VALID_STATUSES.has(status)) {
      throw new Error('Invalid status: ' + status);
    }
    evaluation.reviewer = reviewerId;
    evaluation.reviewedAt = Date.now();
    evaluation.status = status;
    if (notes !== undefined) evaluation.notes = notes;
    scheduleSave();
    return evaluation;
  }

  // --- Quality Gate CRUD ---

  function createQualityGate(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Quality gate data is required');
    }
    if (!data.name) {
      throw new Error('name is required');
    }

    const id = data.id || crypto.randomUUID();

    const gate = {
      id,
      name: data.name,
      description: data.description || '',
      enabled: data.enabled !== false,
      minScore: typeof data.minScore === 'number' ? data.minScore : 70,
      requiredReview: data.requiredReview === true,
      autoQuarantine: data.autoQuarantine === true,
      criteria: Array.isArray(data.criteria) ? data.criteria : [
        { name: 'completeness', weight: 0.3, threshold: 60 },
        { name: 'efficiency', weight: 0.2, threshold: 50 },
        { name: 'safety', weight: 0.3, threshold: 80 },
        { name: 'accuracy', weight: 0.2, threshold: 60 }
      ]
    };

    qualityGates.set(id, gate);
    scheduleSave();
    return gate;
  }

  function getQualityGate(id) {
    return qualityGates.get(id) || null;
  }

  function listQualityGates() {
    return [...qualityGates.values()];
  }

  function updateQualityGate(id, updates) {
    const gate = qualityGates.get(id);
    if (!gate) throw new Error('Quality gate not found: ' + id);

    const allowedFields = ['name', 'description', 'enabled', 'minScore', 'requiredReview', 'autoQuarantine', 'criteria'];
    for (const key of Object.keys(updates)) {
      if (allowedFields.includes(key)) {
        gate[key] = updates[key];
      }
    }
    scheduleSave();
    return gate;
  }

  function deleteQualityGate(id) {
    const existed = qualityGates.delete(id);
    if (!existed) throw new Error('Quality gate not found: ' + id);
    scheduleSave();
    return true;
  }

  // --- Gate Evaluation ---

  function evaluateAgent(agentId, metrics) {
    if (!agentId) throw new Error('agentId is required');
    if (!metrics || typeof metrics !== 'object') throw new Error('metrics are required');

    const gates = [...qualityGates.values()].filter(g => g.enabled);
    const results = [];

    for (const gate of gates) {
      const criteriaResults = [];
      let allCriteriaMet = true;

      for (const criterion of gate.criteria) {
        const metricValue = typeof metrics[criterion.name] === 'number' ? metrics[criterion.name] : 0;
        const passed = metricValue >= (criterion.threshold || 0);
        if (!passed) allCriteriaMet = false;
        criteriaResults.push({
          name: criterion.name,
          score: metricValue,
          weight: criterion.weight,
          threshold: criterion.threshold || 0,
          passed,
          details: passed ? 'Met threshold' : 'Below threshold (' + metricValue + ' < ' + (criterion.threshold || 0) + ')'
        });
      }

      const overallScore = _computeScore(criteriaResults);
      const scorePassed = overallScore >= gate.minScore;
      let status;
      if (scorePassed && allCriteriaMet) {
        status = gate.requiredReview ? 'needs_review' : 'passed';
      } else {
        status = 'failed';
      }

      const evaluation = createEvaluation({
        agentId,
        type: 'component',
        criteria: criteriaResults,
        status,
        notes: 'Auto-evaluated against gate: ' + gate.name
      });

      results.push({
        gateId: gate.id,
        gateName: gate.name,
        evaluationId: evaluation.id,
        score: overallScore,
        status,
        autoQuarantine: gate.autoQuarantine && status === 'failed',
        criteria: criteriaResults
      });
    }

    return results;
  }

  // --- Baseline ---

  function computeBaseline(agentId, evalList) {
    if (!agentId) throw new Error('agentId is required');
    const evals = evalList || listEvaluations({ agentId });
    if (evals.length === 0) {
      throw new Error('No evaluations found for baseline computation');
    }

    let totalScore = 0;
    let totalTokens = 0;
    let totalToolCalls = 0;
    let totalResponseTime = 0;
    let totalErrors = 0;
    let tokenCount = 0;
    let toolCallCount = 0;
    let responseTimeCount = 0;
    let count = evals.length;

    for (const ev of evals) {
      totalScore += ev.score || 0;
      // Accumulate explicit performance metrics when present
      if (typeof ev.tokensUsed === 'number') {
        totalTokens += ev.tokensUsed;
        tokenCount++;
      }
      if (typeof ev.responseTime === 'number') {
        totalResponseTime += ev.responseTime;
        responseTimeCount++;
      }
      if (typeof ev.errorCount === 'number') {
        totalErrors += ev.errorCount;
      }
      if (typeof ev.toolCallCount === 'number') {
        totalToolCalls += ev.toolCallCount;
        toolCallCount++;
      }
    }

    const baseline = {
      agentId,
      metrics: {
        avgTokensPerSession: tokenCount > 0 ? Math.round(totalTokens / tokenCount) : 0,
        avgToolCalls: toolCallCount > 0 ? Math.round(totalToolCalls / toolCallCount) : 0,
        avgResponseTime: responseTimeCount > 0 ? Math.round(totalResponseTime / responseTimeCount) : 0,
        errorRate: count > 0 ? totalErrors / count : 0,
        avgScore: count > 0 ? Math.round(totalScore / count) : 0
      },
      sampleSize: count,
      computedAt: Date.now()
    };

    baselines.set(agentId, baseline);
    scheduleSave();
    return baseline;
  }

  function getBaseline(agentId) {
    return baselines.get(agentId) || null;
  }

  function detectDrift(agentId, currentMetrics) {
    if (!agentId) throw new Error('agentId is required');
    if (!currentMetrics || typeof currentMetrics !== 'object') {
      throw new Error('currentMetrics are required');
    }

    const baseline = baselines.get(agentId);
    if (!baseline) {
      return { hasDrift: false, reason: 'No baseline available', factors: [] };
    }

    const factors = [];
    const bm = baseline.metrics;

    // Score drift
    if (bm.avgScore > 0 && typeof currentMetrics.avgScore === 'number') {
      const diff = bm.avgScore - currentMetrics.avgScore;
      const pct = Math.abs(diff) / bm.avgScore * 100;
      if (pct > 15) {
        factors.push({
          name: 'score',
          baseline: bm.avgScore,
          current: currentMetrics.avgScore,
          deviation: Math.round(pct),
          direction: diff > 0 ? 'decreased' : 'increased'
        });
      }
    }

    // Error rate drift
    if (typeof currentMetrics.errorRate === 'number') {
      const diff = currentMetrics.errorRate - (bm.errorRate || 0);
      if (diff > 0.1) {
        factors.push({
          name: 'errorRate',
          baseline: bm.errorRate,
          current: currentMetrics.errorRate,
          deviation: Math.round(diff * 100),
          direction: 'increased'
        });
      }
    }

    // Response time drift
    if (bm.avgResponseTime > 0 && typeof currentMetrics.avgResponseTime === 'number') {
      const diff = currentMetrics.avgResponseTime - bm.avgResponseTime;
      const pct = Math.abs(diff) / bm.avgResponseTime * 100;
      if (pct > 25) {
        factors.push({
          name: 'responseTime',
          baseline: bm.avgResponseTime,
          current: currentMetrics.avgResponseTime,
          deviation: Math.round(pct),
          direction: diff > 0 ? 'increased' : 'decreased'
        });
      }
    }

    // Token usage drift
    if (bm.avgTokensPerSession > 0 && typeof currentMetrics.avgTokensPerSession === 'number') {
      const diff = currentMetrics.avgTokensPerSession - bm.avgTokensPerSession;
      const pct = Math.abs(diff) / bm.avgTokensPerSession * 100;
      if (pct > 20) {
        factors.push({
          name: 'tokenUsage',
          baseline: bm.avgTokensPerSession,
          current: currentMetrics.avgTokensPerSession,
          deviation: Math.round(pct),
          direction: diff > 0 ? 'increased' : 'decreased'
        });
      }
    }

    // Tool calls drift
    if (bm.avgToolCalls > 0 && typeof currentMetrics.avgToolCalls === 'number') {
      const diff = currentMetrics.avgToolCalls - bm.avgToolCalls;
      const pct = Math.abs(diff) / bm.avgToolCalls * 100;
      if (pct > 30) {
        factors.push({
          name: 'toolCalls',
          baseline: bm.avgToolCalls,
          current: currentMetrics.avgToolCalls,
          deviation: Math.round(pct),
          direction: diff > 0 ? 'increased' : 'decreased'
        });
      }
    }

    return {
      agentId,
      hasDrift: factors.length > 0,
      driftScore: Math.min(100, factors.length * 25),
      factors,
      baseline: bm,
      current: currentMetrics,
      computedAt: Date.now()
    };
  }

  // --- Scorecards ---

  function getAgentScorecard(agentId) {
    if (!agentId) throw new Error('agentId is required');
    const evals = listEvaluations({ agentId });
    if (evals.length === 0) {
      return {
        agentId,
        avgScore: 0,
        passRate: 0,
        totalEvaluations: 0,
        byType: {},
        trend: []
      };
    }

    let totalScore = 0;
    let passedCount = 0;
    const byType = {};

    for (const ev of evals) {
      totalScore += ev.score;
      if (ev.status === 'passed') passedCount++;
      if (!byType[ev.type]) {
        byType[ev.type] = { count: 0, avgScore: 0, totalScore: 0 };
      }
      byType[ev.type].count++;
      byType[ev.type].totalScore += ev.score;
    }

    for (const t of Object.values(byType)) {
      t.avgScore = t.count > 0 ? Math.round(t.totalScore / t.count) : 0;
      delete t.totalScore;
    }

    // Compute trend: last 10 evaluations scores
    const sorted = [...evals].sort((a, b) => a.createdAt - b.createdAt);
    const trend = sorted.slice(-10).map(e => ({ score: e.score, createdAt: e.createdAt, type: e.type }));

    return {
      agentId,
      avgScore: Math.round(totalScore / evals.length),
      passRate: Math.round((passedCount / evals.length) * 100),
      totalEvaluations: evals.length,
      byType,
      trend
    };
  }

  function getFleetScorecard() {
    const allEvals = [...evaluations.values()];
    if (allEvals.length === 0) {
      return {
        totalEvaluations: 0,
        avgScore: 0,
        passRate: 0,
        agentCount: 0,
        byType: {},
        topAgents: [],
        bottomAgents: []
      };
    }

    let totalScore = 0;
    let passedCount = 0;
    const byType = {};
    const agentScores = {};

    for (const ev of allEvals) {
      totalScore += ev.score;
      if (ev.status === 'passed') passedCount++;
      if (!byType[ev.type]) {
        byType[ev.type] = { count: 0, totalScore: 0 };
      }
      byType[ev.type].count++;
      byType[ev.type].totalScore += ev.score;

      if (!agentScores[ev.agentId]) {
        agentScores[ev.agentId] = { total: 0, count: 0 };
      }
      agentScores[ev.agentId].total += ev.score;
      agentScores[ev.agentId].count++;
    }

    for (const t of Object.values(byType)) {
      t.avgScore = t.count > 0 ? Math.round(t.totalScore / t.count) : 0;
      delete t.totalScore;
    }

    const agentAvgs = Object.entries(agentScores).map(([agentId, s]) => ({
      agentId,
      avgScore: Math.round(s.total / s.count),
      evaluations: s.count
    })).sort((a, b) => b.avgScore - a.avgScore);

    return {
      totalEvaluations: allEvals.length,
      avgScore: Math.round(totalScore / allEvals.length),
      passRate: Math.round((passedCount / allEvals.length) * 100),
      agentCount: Object.keys(agentScores).length,
      byType,
      topAgents: agentAvgs.slice(0, 5),
      bottomAgents: agentAvgs.slice(-5).reverse()
    };
  }

  // --- Optimization Hints ---

  function getOptimizationHints(agentId) {
    if (!agentId) throw new Error('agentId is required');
    const evals = listEvaluations({ agentId });
    const baseline = baselines.get(agentId);
    const hints = [];

    // Analyze evaluation patterns
    const recentEvals = evals.slice(-20);
    if (recentEvals.length === 0) {
      return { agentId, hints: [{ category: 'data', message: 'Insufficient evaluation data', impact: 'low', suggestion: 'Run more evaluations to generate optimization hints' }] };
    }

    const avgScore = recentEvals.reduce((sum, e) => sum + e.score, 0) / recentEvals.length;
    const failedEvals = recentEvals.filter(e => e.status === 'failed');
    const failRate = failedEvals.length / recentEvals.length;

    // Check individual criteria across evaluations
    const criteriaScores = {};
    for (const ev of recentEvals) {
      for (const c of (ev.criteria || [])) {
        if (!criteriaScores[c.name]) criteriaScores[c.name] = [];
        criteriaScores[c.name].push(c.score || 0);
      }
    }

    // High fail rate
    if (failRate > 0.3) {
      hints.push({
        category: 'reliability',
        message: 'High evaluation failure rate (' + Math.round(failRate * 100) + '%)',
        impact: 'high',
        suggestion: 'Review failed evaluations and identify common failure patterns'
      });
    }

    // Low efficiency scores
    if (criteriaScores.efficiency) {
      const avgEfficiency = criteriaScores.efficiency.reduce((s, v) => s + v, 0) / criteriaScores.efficiency.length;
      if (avgEfficiency < 50) {
        hints.push({
          category: 'efficiency',
          message: 'Token efficiency below fleet average',
          impact: 'medium',
          suggestion: 'Optimize prompts and reduce unnecessary tool calls'
        });
      }
    }

    // Low safety scores
    if (criteriaScores.safety) {
      const avgSafety = criteriaScores.safety.reduce((s, v) => s + v, 0) / criteriaScores.safety.length;
      if (avgSafety < 70) {
        hints.push({
          category: 'safety',
          message: 'Error rate elevated, check tool configurations',
          impact: 'high',
          suggestion: 'Review agent safety policies and tighten allowlists'
        });
      }
    }

    // Low completeness scores
    if (criteriaScores.completeness) {
      const avgComplete = criteriaScores.completeness.reduce((s, v) => s + v, 0) / criteriaScores.completeness.length;
      if (avgComplete < 60) {
        hints.push({
          category: 'completeness',
          message: 'Consider breaking complex tasks into subtasks',
          impact: 'medium',
          suggestion: 'Use task decomposition to improve completion rates'
        });
      }
    }

    // Low accuracy scores
    if (criteriaScores.accuracy) {
      const avgAccuracy = criteriaScores.accuracy.reduce((s, v) => s + v, 0) / criteriaScores.accuracy.length;
      if (avgAccuracy < 60) {
        hints.push({
          category: 'accuracy',
          message: 'Response time above p90, investigate bottlenecks',
          impact: 'medium',
          suggestion: 'Improve tool selection and reduce retry loops'
        });
      }
    }

    // Baseline drift hint
    if (baseline && avgScore < baseline.metrics.avgScore * 0.8) {
      hints.push({
        category: 'drift',
        message: 'Quality score has drifted below baseline (' + Math.round(avgScore) + ' vs ' + baseline.metrics.avgScore + ')',
        impact: 'high',
        suggestion: 'Compare recent behavior with baseline and identify regression causes'
      });
    }

    if (hints.length === 0) {
      hints.push({
        category: 'status',
        message: 'Agent performing within acceptable parameters',
        impact: 'low',
        suggestion: 'Continue monitoring'
      });
    }

    return { agentId, hints };
  }

  function destroy() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    _persist();
  }

  return {
    createEvaluation,
    getEvaluation,
    listEvaluations,
    reviewEvaluation,
    createQualityGate,
    getQualityGate,
    listQualityGates,
    updateQualityGate,
    deleteQualityGate,
    evaluateAgent,
    computeBaseline,
    getBaseline,
    detectDrift,
    getAgentScorecard,
    getFleetScorecard,
    getOptimizationHints,
    destroy
  };
}

module.exports = { createEvaluationEngine };
