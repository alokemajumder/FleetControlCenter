'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerSchedulerRoutes(router, config, modules) {
  const { auth, audit, scheduler } = modules;

  function isOperatorOrAdmin(role) {
    const r = (role || '').toLowerCase();
    return r === 'admin' || r === 'operator';
  }

  function isAdmin(role) {
    return (role || '').toLowerCase() === 'admin';
  }

  // GET /api/scheduler/jobs - List jobs with optional filters
  router.get('/api/scheduler/jobs', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const url = new URL(req.url, 'http://localhost');
    const filters = {};
    if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');
    if (url.searchParams.get('enabled')) filters.enabled = url.searchParams.get('enabled');

    const jobs = scheduler.listJobs(filters);
    res.json(200, { success: true, jobs });
  });

  // POST /api/scheduler/jobs - Create job (operator+)
  router.post('/api/scheduler/jobs', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const job = scheduler.createJob({ ...body, createdBy: authResult.user.username });
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.created', target: job.id, detail: job.name + ' (' + job.schedule + ')' });
      res.json(201, { success: true, job });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/scheduler/jobs/:id - Get job
  router.get('/api/scheduler/jobs/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const job = scheduler.getJob(req.params.id);
    if (!job) return res.error(404, 'Job not found');
    res.json(200, { success: true, job });
  });

  // PUT /api/scheduler/jobs/:id - Update job (operator+)
  router.put('/api/scheduler/jobs/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    try {
      const job = scheduler.updateJob(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.updated', target: req.params.id, detail: JSON.stringify(body) });
      res.json(200, { success: true, job });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // DELETE /api/scheduler/jobs/:id - Delete job (admin)
  router.delete('/api/scheduler/jobs/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user.role)) return res.error(403, 'Admin required');

    try {
      const job = scheduler.deleteJob(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.deleted', target: req.params.id, detail: job.name });
      res.json(200, { success: true, job });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/scheduler/jobs/:id/run - Manual trigger (operator+)
  router.post('/api/scheduler/jobs/:id/run', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    try {
      const result = scheduler.runJob(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.triggered', target: req.params.id });
      res.json(200, { success: true, result });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // POST /api/scheduler/jobs/:id/pause - Pause (operator+)
  router.post('/api/scheduler/jobs/:id/pause', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    try {
      const job = scheduler.pauseJob(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.paused', target: req.params.id });
      res.json(200, { success: true, job });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // POST /api/scheduler/jobs/:id/resume - Resume (operator+)
  router.post('/api/scheduler/jobs/:id/resume', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isOperatorOrAdmin(authResult.user.role)) return res.error(403, 'Insufficient permissions');

    try {
      const job = scheduler.resumeJob(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'scheduler.job.resumed', target: req.params.id });
      res.json(200, { success: true, job });
    } catch (err) {
      res.error(err.message.includes('not found') ? 404 : 400, err.message);
    }
  });

  // GET /api/scheduler/jobs/:id/history - Run history
  router.get('/api/scheduler/jobs/:id/history', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const history = scheduler.getHistory(req.params.id);
      res.json(200, { success: true, history });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/scheduler/parse - Parse NL expression (viewer+ - preview without creating)
  router.post('/api/scheduler/parse', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.expression) return res.error(400, 'Expression is required');

    try {
      const parsed = scheduler.parseSchedule(body.expression);
      const nextRun = scheduler.computeNextRun(parsed.cronExpression, new Date());
      res.json(200, { success: true, ...parsed, nextRunAt: nextRun ? nextRun.getTime() : null });
    } catch (err) {
      res.error(400, err.message);
    }
  });
}

module.exports = { registerSchedulerRoutes };
