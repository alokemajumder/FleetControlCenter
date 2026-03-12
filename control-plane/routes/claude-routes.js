'use strict';

const { authenticate } = require('../middleware/auth-middleware');

// Validate that an id is safe (alphanumeric, dash, underscore only)
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function isSafeId(id) {
  if (typeof id !== 'string') return false;
  if (id.length === 0 || id.length > 255) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return SAFE_ID_RE.test(id);
}

function registerClaudeRoutes(router, config, modules) {
  const { auth, claudeIntegration } = modules;

  if (!claudeIntegration) return;

  // GET /api/claude/discover
  router.get('/api/claude/discover', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const info = claudeIntegration.discover();
    res.json(200, { success: true, ...info });
  });

  // GET /api/claude/settings
  router.get('/api/claude/settings', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const settings = claudeIntegration.getSettings();
    if (settings === null) return res.json(200, { success: true, settings: null });
    res.json(200, { success: true, settings });
  });

  // GET /api/claude/projects
  router.get('/api/claude/projects', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const projects = claudeIntegration.getProjects();
    res.json(200, { success: true, projects });
  });

  // GET /api/claude/projects/:id
  router.get('/api/claude/projects/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const id = req.params.id;
    if (!isSafeId(id)) return res.error(400, 'Invalid project ID');
    const detail = claudeIntegration.getProjectDetail(id);
    if (!detail) return res.error(404, 'Project not found');
    res.json(200, { success: true, project: detail });
  });

  // GET /api/claude/projects/:id/memory
  router.get('/api/claude/projects/:id/memory', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const id = req.params.id;
    if (!isSafeId(id)) return res.error(400, 'Invalid project ID');
    const memory = claudeIntegration.getProjectMemory(id);
    res.json(200, { success: true, memory });
  });

  // GET /api/claude/projects/:id/sessions
  router.get('/api/claude/projects/:id/sessions', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const id = req.params.id;
    if (!isSafeId(id)) return res.error(400, 'Invalid project ID');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const sessions = claudeIntegration.getSessions(id, { limit, offset });
    res.json(200, { success: true, sessions });
  });

  // GET /api/claude/projects/:id/sessions/:sessionId
  router.get('/api/claude/projects/:id/sessions/:sessionId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const id = req.params.id;
    const sessionId = req.params.sessionId;
    if (!isSafeId(id)) return res.error(400, 'Invalid project ID');
    if (!isSafeId(sessionId)) return res.error(400, 'Invalid session ID');
    const summary = claudeIntegration.getSessionSummary(id, sessionId);
    if (!summary) return res.error(404, 'Session not found');
    res.json(200, { success: true, summary });
  });

  // GET /api/claude/recent
  router.get('/api/claude/recent', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const recent = claudeIntegration.getRecentActivity(limit);
    res.json(200, { success: true, recent });
  });

  // GET /api/claude/stats
  router.get('/api/claude/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const stats = claudeIntegration.getStats();
    res.json(200, { success: true, stats });
  });
}

module.exports = { registerClaudeRoutes };
