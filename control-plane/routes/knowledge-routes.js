'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerKnowledgeRoutes(router, config, modules) {
  const { auth, audit, knowledgeGraph } = modules;

  if (!knowledgeGraph) return;

  // GET /api/knowledge/graph - Full graph (with optional ?type= filter)
  router.get('/api/knowledge/graph', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    if (type) {
      const filteredNodes = knowledgeGraph.listNodes({ type });
      const filteredEdges = knowledgeGraph.listEdges({});
      const nodeIds = new Set(filteredNodes.map(n => n.id));
      const relevantEdges = filteredEdges.filter(e => nodeIds.has(e.source) || nodeIds.has(e.target));
      return res.json(200, { success: true, graph: { nodes: filteredNodes, edges: relevantEdges } });
    }
    res.json(200, { success: true, graph: knowledgeGraph.toJSON() });
  });

  // GET /api/knowledge/nodes - List nodes
  router.get('/api/knowledge/nodes', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    const searchQ = url.searchParams.get('search');
    let nodes;
    if (searchQ) {
      nodes = knowledgeGraph.search(searchQ);
      if (type) nodes = nodes.filter(n => n.type === type);
    } else {
      nodes = knowledgeGraph.listNodes(type ? { type } : {});
    }
    res.json(200, { success: true, nodes });
  });

  // GET /api/knowledge/nodes/:id - Get single node
  router.get('/api/knowledge/nodes/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const node = knowledgeGraph.getNode(req.params.id);
    if (!node) return res.error(404, 'Node not found');
    res.json(200, { success: true, node });
  });

  // POST /api/knowledge/nodes - Add node (operator+)
  router.post('/api/knowledge/nodes', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    if (!body.id) return res.error(400, 'Node id is required');
    try {
      const node = knowledgeGraph.addNode(body);
      audit.log({ actor: authResult.user.username, action: 'knowledge.node.add', target: node.id });
      res.json(201, { success: true, node });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // DELETE /api/knowledge/nodes/:id - Remove node (admin)
  router.delete('/api/knowledge/nodes/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const removed = knowledgeGraph.removeNode(req.params.id);
    if (!removed) return res.error(404, 'Node not found');
    audit.log({ actor: authResult.user.username, action: 'knowledge.node.remove', target: req.params.id });
    res.json(200, { success: true });
  });

  // GET /api/knowledge/nodes/:id/neighbors - Get neighbors
  router.get('/api/knowledge/nodes/:id/neighbors', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const depth = parseInt(url.searchParams.get('depth')) || 1;
    const typesParam = url.searchParams.get('types');
    const types = typesParam ? typesParam.split(',') : null;
    const neighbors = knowledgeGraph.getNeighbors(req.params.id, { depth, types });
    res.json(200, { success: true, neighbors });
  });

  // GET /api/knowledge/nodes/:id/subgraph - Get subgraph
  router.get('/api/knowledge/nodes/:id/subgraph', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const depth = parseInt(url.searchParams.get('depth')) || 2;
    const subgraph = knowledgeGraph.getSubgraph(req.params.id, depth);
    res.json(200, { success: true, subgraph });
  });

  // GET /api/knowledge/edges - List edges
  router.get('/api/knowledge/edges', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const type = url.searchParams.get('type');
    const source = url.searchParams.get('source');
    const target = url.searchParams.get('target');
    const filters = {};
    if (type) filters.type = type;
    if (source) filters.source = source;
    if (target) filters.target = target;
    const edgeList = knowledgeGraph.listEdges(filters);
    res.json(200, { success: true, edges: edgeList });
  });

  // POST /api/knowledge/edges - Add edge (operator+)
  router.post('/api/knowledge/edges', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    if (!body.source || !body.target) return res.error(400, 'Edge source and target required');
    try {
      const edge = knowledgeGraph.addEdge(body);
      audit.log({ actor: authResult.user.username, action: 'knowledge.edge.add', target: edge.id });
      res.json(201, { success: true, edge });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // DELETE /api/knowledge/edges/:id - Remove edge (admin)
  router.delete('/api/knowledge/edges/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const removed = knowledgeGraph.removeEdge(req.params.id);
    if (!removed) return res.error(404, 'Edge not found');
    audit.log({ actor: authResult.user.username, action: 'knowledge.edge.remove', target: req.params.id });
    res.json(200, { success: true });
  });

  // GET /api/knowledge/stats - Graph statistics
  router.get('/api/knowledge/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const stats = knowledgeGraph.getStats();
    res.json(200, { success: true, stats });
  });

  // GET /api/knowledge/search - Search nodes
  router.get('/api/knowledge/search', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const q = url.searchParams.get('q') || '';
    const results = knowledgeGraph.search(q);
    res.json(200, { success: true, results });
  });

  // POST /api/knowledge/ingest - Ingest from events (admin)
  router.post('/api/knowledge/ingest', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const allEvents = modules.events.query(config.dataDir, {});
    const result = knowledgeGraph.ingestFromEvents(allEvents);
    audit.log({ actor: authResult.user.username, action: 'knowledge.ingest', target: 'graph', detail: JSON.stringify(result) });
    res.json(200, { success: true, ...result });
  });

  // GET /api/knowledge/clusters/:type - Get cluster by type
  router.get('/api/knowledge/clusters/:type', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const cluster = knowledgeGraph.getCluster(req.params.type);
    res.json(200, { success: true, cluster });
  });

  // GET /api/knowledge/top - Most connected nodes
  router.get('/api/knowledge/top', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit')) || 10;
    const top = knowledgeGraph.getMostConnected(limit);
    res.json(200, { success: true, top });
  });
}

module.exports = { registerKnowledgeRoutes };
