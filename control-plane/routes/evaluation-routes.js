'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerEvaluationRoutes(router, config, modules) {
  const { auth, audit, evaluationEngine } = modules;

  // GET /api/evaluations - List evaluations with optional filters
  router.get('/api/evaluations', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const filters = {};
    if (url.searchParams.get('agentId')) filters.agentId = url.searchParams.get('agentId');
    if (url.searchParams.get('type')) filters.type = url.searchParams.get('type');
    if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');
    if (url.searchParams.get('sessionId')) filters.sessionId = url.searchParams.get('sessionId');

    const evaluations = evaluationEngine.listEvaluations(filters);
    res.json(200, { success: true, evaluations });
  });

  // POST /api/evaluations - Create evaluation (operator+)
  router.post('/api/evaluations', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const evaluation = evaluationEngine.createEvaluation(body);
      audit.log({ actor: authResult.user.username, action: 'evaluation.created', target: evaluation.id, detail: JSON.stringify({ agentId: body.agentId, type: body.type }) });
      res.json(201, { success: true, evaluation });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/evaluations/fleet/scorecard - Fleet scorecard (must be before :id)
  router.get('/api/evaluations/fleet/scorecard', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const scorecard = evaluationEngine.getFleetScorecard();
    res.json(200, { success: true, scorecard });
  });

  // GET /api/evaluations/agent/:agentId/scorecard - Agent scorecard
  router.get('/api/evaluations/agent/:agentId/scorecard', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const scorecard = evaluationEngine.getAgentScorecard(req.params.agentId);
      res.json(200, { success: true, scorecard });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/evaluations/agent/:agentId/optimize - Optimization hints
  router.get('/api/evaluations/agent/:agentId/optimize', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const result = evaluationEngine.getOptimizationHints(req.params.agentId);
      res.json(200, { success: true, ...result });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/evaluations/agent/:agentId/drift - Drift detection
  router.get('/api/evaluations/agent/:agentId/drift', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const currentMetrics = {};
    // Accept metrics as query params
    for (const key of ['avgScore', 'errorRate', 'avgResponseTime', 'avgTokensPerSession', 'avgToolCalls']) {
      const val = url.searchParams.get(key);
      if (val !== null) currentMetrics[key] = parseFloat(val);
    }

    try {
      const drift = evaluationEngine.detectDrift(req.params.agentId, currentMetrics);
      res.json(200, { success: true, drift });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/evaluations/agent/:agentId/evaluate - Run evaluation against all gates
  router.post('/api/evaluations/agent/:agentId/evaluate', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const results = evaluationEngine.evaluateAgent(req.params.agentId, body.metrics || body);
      audit.log({ actor: authResult.user.username, action: 'evaluation.gate-check', target: req.params.agentId, detail: JSON.stringify({ gateResults: results.length }) });
      res.json(200, { success: true, results });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/evaluations/:id - Get evaluation
  router.get('/api/evaluations/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const evaluation = evaluationEngine.getEvaluation(req.params.id);
    if (!evaluation) return res.error(404, 'Evaluation not found');
    res.json(200, { success: true, evaluation });
  });

  // POST /api/evaluations/:id/review - Review evaluation (operator+)
  router.post('/api/evaluations/:id/review', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.status) return res.error(400, 'status is required');

    try {
      const evaluation = evaluationEngine.reviewEvaluation(req.params.id, authResult.user.username, body.status, body.notes);
      audit.log({ actor: authResult.user.username, action: 'evaluation.reviewed', target: req.params.id, detail: JSON.stringify({ status: body.status }) });
      res.json(200, { success: true, evaluation });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/quality-gates - List quality gates
  router.get('/api/quality-gates', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const gates = evaluationEngine.listQualityGates();
    res.json(200, { success: true, gates });
  });

  // POST /api/quality-gates - Create gate (admin)
  router.post('/api/quality-gates', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const gate = evaluationEngine.createQualityGate(body);
      audit.log({ actor: authResult.user.username, action: 'quality-gate.created', target: gate.id, detail: JSON.stringify({ name: body.name }) });
      res.json(201, { success: true, gate });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // PUT /api/quality-gates/:id - Update gate (admin)
  router.put('/api/quality-gates/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const gate = evaluationEngine.updateQualityGate(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'quality-gate.updated', target: req.params.id, detail: JSON.stringify(body) });
      res.json(200, { success: true, gate });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // DELETE /api/quality-gates/:id - Delete gate (admin)
  router.delete('/api/quality-gates/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    try {
      evaluationEngine.deleteQualityGate(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'quality-gate.deleted', target: req.params.id });
      res.json(200, { success: true });
    } catch (err) {
      res.error(404, err.message);
    }
  });
}

module.exports = { registerEvaluationRoutes };
