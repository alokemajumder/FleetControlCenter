'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, verifyNodeSignature } = require('../middleware/auth-middleware');

function registerAgentRoutes(router, config, modules) {
  const { auth, audit, agentTracker, crypto: cryptoMod } = modules;

  // GET /api/agents - List all agents with optional filters
  router.get('/api/agents', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const filters = {};
    if (url.searchParams.get('type')) filters.type = url.searchParams.get('type');
    if (url.searchParams.get('nodeId')) filters.nodeId = url.searchParams.get('nodeId');
    if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');

    const agents = agentTracker.listAgents(filters);
    res.json(200, { success: true, agents });
  });

  // GET /api/agents/summary - Fleet-wide agent summary
  router.get('/api/agents/summary', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const summary = agentTracker.getFleetSummary();
    res.json(200, { success: true, summary });
  });

  // GET /api/agents/type/:type - Agents by type with aggregated metrics
  router.get('/api/agents/type/:type', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const agents = agentTracker.getAgentsByType(req.params.type);
    let totalSessions = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let errorCount = 0;
    for (const a of agents) {
      totalSessions += a.metrics.totalSessions || 0;
      totalTokens += a.metrics.totalTokens || 0;
      totalCost += a.metrics.totalCost || 0;
      errorCount += a.metrics.errorCount || 0;
    }
    res.json(200, {
      success: true,
      type: req.params.type,
      count: agents.length,
      agents,
      aggregated: { totalSessions, totalTokens, totalCost, errorCount }
    });
  });

  // GET /api/agents/node/:nodeId - Agents by node
  router.get('/api/agents/node/:nodeId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const agents = agentTracker.getAgentsByNode(req.params.nodeId);
    res.json(200, { success: true, nodeId: req.params.nodeId, agents });
  });

  // GET /api/agents/:agentId - Get specific agent
  router.get('/api/agents/:agentId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const agent = agentTracker.getAgent(req.params.agentId);
    if (!agent) return res.error(404, 'Agent not found');
    res.json(200, { success: true, agent });
  });

  // POST /api/agents - Register a new agent (HMAC node auth)
  router.post('/api/agents', async (req, res) => {
    // Accept either HMAC node auth or admin session auth
    const sigResult = verifyNodeSignature(req, config, cryptoMod);
    let isAdmin = false;
    if (!sigResult.valid) {
      const authResult = authenticate(req, auth);
      if (!authResult.authenticated) return res.error(401, 'Not authenticated');
      if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
      isAdmin = true;
    }

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.type || !body.nodeId) return res.error(400, 'type and nodeId are required');

    try {
      const agentId = agentTracker.registerAgent(body);
      audit.log({ actor: isAdmin ? 'admin' : ('node:' + (sigResult.nodeId || body.nodeId)), action: 'agent.registered', target: agentId, detail: JSON.stringify({ type: body.type, nodeId: body.nodeId }) });
      res.json(201, { success: true, agentId });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // PUT /api/agents/:agentId - Update agent (admin only)
  router.put('/api/agents/:agentId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const agent = agentTracker.updateAgent(req.params.agentId, body);
      audit.log({ actor: authResult.user.username, action: 'agent.updated', target: req.params.agentId, detail: JSON.stringify(body) });
      res.json(200, { success: true, agent });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/agents/:agentId/heartbeat - Agent heartbeat (HMAC auth)
  router.post('/api/agents/:agentId/heartbeat', async (req, res) => {
    const sigResult = verifyNodeSignature(req, config, cryptoMod);
    let isAdmin = false;
    if (!sigResult.valid) {
      const authResult = authenticate(req, auth);
      if (!authResult.authenticated) return res.error(401, 'Not authenticated');
      if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin or HMAC auth required');
      isAdmin = true;
    }

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const agent = agentTracker.heartbeat(req.params.agentId, body.metrics || {});
      res.json(200, { success: true, agent });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // DELETE /api/agents/:agentId - Remove agent (admin only)
  router.delete('/api/agents/:agentId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    try {
      agentTracker.removeAgent(req.params.agentId);
      audit.log({ actor: authResult.user.username, action: 'agent.removed', target: req.params.agentId });
      res.json(200, { success: true });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // GET /api/agents/:agentId/timeline - Agent event timeline
  router.get('/api/agents/:agentId/timeline', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    try {
      const timeline = agentTracker.getAgentTimeline(req.params.agentId, { limit });
      res.json(200, { success: true, timeline });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // GET /api/agents/:agentId/metrics - Agent metrics
  router.get('/api/agents/:agentId/metrics', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const metrics = agentTracker.getAgentMetrics(req.params.agentId);
      res.json(200, { success: true, metrics });
    } catch (err) {
      res.error(404, err.message);
    }
  });
  // GET /api/agents/:agentId/soul - Get SOUL content (viewer+)
  router.get('/api/agents/:agentId/soul', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const soul = agentTracker.getSoul(req.params.agentId);
      const exported = agentTracker.exportSoul(req.params.agentId);
      res.json(200, { success: true, ...exported });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // PUT /api/agents/:agentId/soul - Update SOUL content (operator+)
  router.put('/api/agents/:agentId/soul', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'operator') return res.error(403, 'Operator or admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.content && body.content !== '') return res.error(400, 'content is required');

    try {
      agentTracker.setSoul(req.params.agentId, body.content);
      audit.log({ actor: authResult.user.username, action: 'agent.soul.updated', target: req.params.agentId });
      const exported = agentTracker.exportSoul(req.params.agentId);
      res.json(200, { success: true, ...exported });
    } catch (err) {
      res.error(404, err.message);
    }
  });
}

module.exports = { registerAgentRoutes };
