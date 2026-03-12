'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerProjectRoutes(router, config, modules) {
  const { auth, audit, projectManager } = modules;

  function isOperatorOrAdmin(user) {
    const role = (user.role || '').toLowerCase();
    return role === 'admin' || role === 'operator';
  }

  // GET /api/projects - List projects (viewer+)
  router.get('/api/projects', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const filters = {};
    if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');
    if (url.searchParams.get('tag')) filters.tag = url.searchParams.get('tag');
    if (url.searchParams.get('search')) filters.search = url.searchParams.get('search');

    const projects = projectManager.listProjects(filters);
    res.json(200, { success: true, projects });
  });

  // POST /api/projects - Create project (operator+)
  router.post('/api/projects', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const project = projectManager.createProject({ ...body, createdBy: authResult.user.username });
      audit.log({ actor: authResult.user.username, action: 'project.created', target: project.id, detail: JSON.stringify({ name: project.name }) });
      res.json(201, { success: true, project });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/projects/:id - Get project (viewer+)
  router.get('/api/projects/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const project = projectManager.getProject(req.params.id);
    if (!project) return res.error(404, 'Project not found');
    res.json(200, { success: true, project });
  });

  // PUT /api/projects/:id - Update project (operator+)
  router.put('/api/projects/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const project = projectManager.updateProject(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'project.updated', target: req.params.id, detail: JSON.stringify(body) });
      res.json(200, { success: true, project });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // DELETE /api/projects/:id - Delete project (admin only)
  router.delete('/api/projects/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    try {
      projectManager.deleteProject(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'project.deleted', target: req.params.id });
      res.json(200, { success: true });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/projects/:id/archive - Archive project (operator+)
  router.post('/api/projects/:id/archive', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    try {
      const project = projectManager.archiveProject(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'project.archived', target: req.params.id });
      res.json(200, { success: true, project });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/projects/:id/activate - Activate project (operator+)
  router.post('/api/projects/:id/activate', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    try {
      const project = projectManager.activateProject(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'project.activated', target: req.params.id });
      res.json(200, { success: true, project });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/projects/:id/agents/:agentId - Assign agent (operator+)
  router.post('/api/projects/:id/agents/:agentId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    try {
      const project = projectManager.assignAgent(req.params.id, req.params.agentId);
      audit.log({ actor: authResult.user.username, action: 'project.agent.assigned', target: req.params.id, detail: JSON.stringify({ agentId: req.params.agentId }) });
      res.json(200, { success: true, project });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // DELETE /api/projects/:id/agents/:agentId - Remove agent (operator+)
  router.delete('/api/projects/:id/agents/:agentId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user)) return res.error(403, 'Operator or admin required');

    try {
      const project = projectManager.removeAgent(req.params.id, req.params.agentId);
      audit.log({ actor: authResult.user.username, action: 'project.agent.removed', target: req.params.id, detail: JSON.stringify({ agentId: req.params.agentId }) });
      res.json(200, { success: true, project });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/projects/:id/stats - Project stats (viewer+)
  router.get('/api/projects/:id/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const stats = projectManager.getProjectStats(req.params.id);
      res.json(200, { success: true, stats });
    } catch (err) {
      res.error(404, err.message);
    }
  });
}

module.exports = { registerProjectRoutes };
