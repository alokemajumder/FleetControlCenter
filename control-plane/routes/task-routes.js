'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerTaskRoutes(router, config, modules) {
  const { auth, audit, taskManager } = modules;

  function isOperatorOrAdmin(role) {
    const r = (role || '').toLowerCase();
    return r === 'admin' || r === 'operator';
  }

  function isAdmin(role) {
    return (role || '').toLowerCase() === 'admin';
  }

  // GET /api/tasks - List tasks with filters
  router.get('/api/tasks', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const filters = {};
    if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');
    if (url.searchParams.get('priority')) filters.priority = url.searchParams.get('priority');
    if (url.searchParams.get('assignee')) filters.assignee = url.searchParams.get('assignee');
    if (url.searchParams.get('tag')) filters.tag = url.searchParams.get('tag');
    if (url.searchParams.get('search')) filters.search = url.searchParams.get('search');

    const tasks = taskManager.listTasks(filters);
    res.json(200, { success: true, tasks });
  });

  // GET /api/tasks/board - Kanban board view
  router.get('/api/tasks/board', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const board = taskManager.getByStatus();
    res.json(200, { success: true, board });
  });

  // GET /api/tasks/stats - Task statistics
  router.get('/api/tasks/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const stats = taskManager.getStats();
    res.json(200, { success: true, stats });
  });

  // GET /api/tasks/assignee/:id - Tasks by assignee
  router.get('/api/tasks/assignee/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const tasks = taskManager.getTasksByAssignee(req.params.id);
    res.json(200, { success: true, tasks });
  });

  // GET /api/tasks/session/:id - Tasks by session
  router.get('/api/tasks/session/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const tasks = taskManager.getTasksBySession(req.params.id);
    res.json(200, { success: true, tasks });
  });

  // POST /api/tasks - Create task
  router.post('/api/tasks', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const task = taskManager.createTask({ ...body, createdBy: authResult.user.username });
      audit.log({ actor: authResult.user.username, action: 'task.created', target: task.id, detail: task.title });
      res.json(201, { success: true, task });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/tasks/:id - Get task
  router.get('/api/tasks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const task = taskManager.getTask(req.params.id);
    if (!task) return res.error(404, 'Task not found');
    res.json(200, { success: true, task });
  });

  // PUT /api/tasks/:id - Update task
  router.put('/api/tasks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const task = taskManager.updateTask(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'task.updated', target: req.params.id, detail: JSON.stringify(body) });
      res.json(200, { success: true, task });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // POST /api/tasks/:id/move - Move task to status
  router.post('/api/tasks/:id/move', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.status) return res.error(400, 'status is required');

    try {
      const task = taskManager.moveTask(req.params.id, body.status);
      audit.log({ actor: authResult.user.username, action: 'task.moved', target: req.params.id, detail: body.status });
      res.json(200, { success: true, task });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // POST /api/tasks/:id/assign - Assign task
  router.post('/api/tasks/:id/assign', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const task = taskManager.assignTask(req.params.id, body.assignee, body.assigneeType);
      audit.log({ actor: authResult.user.username, action: 'task.assigned', target: req.params.id, detail: body.assignee || 'unassigned' });
      res.json(200, { success: true, task });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // POST /api/tasks/:id/comments - Add comment (viewer+ can comment)
  router.post('/api/tasks/:id/comments', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const comment = taskManager.addComment(req.params.id, { ...body, author: authResult.user.username });
      res.json(201, { success: true, comment });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // GET /api/tasks/:id/comments - Get comments
  router.get('/api/tasks/:id/comments', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const comments = taskManager.getComments(req.params.id);
      res.json(200, { success: true, comments });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // DELETE /api/tasks/:id - Archive task (admin only)
  router.delete('/api/tasks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user.role)) return res.error(403, 'Admin required');

    try {
      const task = taskManager.deleteTask(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'task.archived', target: req.params.id });
      res.json(200, { success: true, task });
    } catch (err) {
      res.error(404, err.message);
    }
  });
}

module.exports = { registerTaskRoutes };
