'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerSkillsHubRoutes(router, config, modules) {
  const { auth, audit, skillsHub } = modules;

  // GET /api/skills-hub - List skills with optional filters
  router.get('/api/skills-hub', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const filters = {};
    if (req.query.category) filters.category = req.query.category;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.search) filters.search = req.query.search;
    if (req.query.source) filters.source = req.query.source;
    const skills = skillsHub.listSkills(filters);
    res.json(200, { success: true, skills });
  });

  // GET /api/skills-hub/stats - Hub statistics
  router.get('/api/skills-hub/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const stats = skillsHub.getSkillStats();
    res.json(200, { success: true, stats });
  });

  // GET /api/skills-hub/categories - Categories with counts
  router.get('/api/skills-hub/categories', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const categories = skillsHub.getCategories();
    res.json(200, { success: true, categories });
  });

  // GET /api/skills-hub/recommended - Recommended skills
  router.get('/api/skills-hub/recommended', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const recommended = skillsHub.getRecommended();
    res.json(200, { success: true, skills: recommended });
  });

  // GET /api/skills-hub/search - Search skills
  router.get('/api/skills-hub/search', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const results = skillsHub.searchSkills(req.query.q || '');
    res.json(200, { success: true, skills: results });
  });

  // GET /api/skills-hub/:id - Skill detail
  router.get('/api/skills-hub/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const skill = skillsHub.getSkill(req.params.id);
    if (!skill) return res.error(404, 'Skill not found');
    res.json(200, { success: true, skill });
  });

  // POST /api/skills-hub/:id/install - Install skill (operator+)
  router.post('/api/skills-hub/:id/install', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    try {
      const skill = skillsHub.installSkill(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.installed', target: req.params.id });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/:id/uninstall - Uninstall skill (operator+)
  router.post('/api/skills-hub/:id/uninstall', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    try {
      const skill = skillsHub.uninstallSkill(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.uninstalled', target: req.params.id });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/:id/enable - Enable skill (operator+)
  router.post('/api/skills-hub/:id/enable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    try {
      const skill = skillsHub.enableSkill(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.enabled', target: req.params.id });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/:id/disable - Disable skill (operator+)
  router.post('/api/skills-hub/:id/disable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    try {
      const skill = skillsHub.disableSkill(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.disabled', target: req.params.id });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/:id/scan - Run security scan (operator+)
  router.post('/api/skills-hub/:id/scan', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!auth.checkPermission(authResult.user, 'action:safe')) return res.error(403, 'Insufficient permissions');
    try {
      const result = skillsHub.scanSkill(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.scanned', target: req.params.id, detail: JSON.stringify({ score: result.score, passed: result.passed }) });
      res.json(200, { success: true, scan: result });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/:id/quarantine - Quarantine skill (admin + step-up)
  router.post('/api/skills-hub/:id/quarantine', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    try {
      const skill = skillsHub.quarantineSkill(req.params.id, body.reason || '');
      audit.log({ actor: authResult.user.username, action: 'skill-hub.quarantined', target: req.params.id, detail: body.reason || '' });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // POST /api/skills-hub/import - Import skill definition (admin)
  router.post('/api/skills-hub/import', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    try {
      const skill = skillsHub.importSkill(body);
      audit.log({ actor: authResult.user.username, action: 'skill-hub.imported', target: skill.id });
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/skills-hub/:id/export - Export skill (viewer+)
  router.get('/api/skills-hub/:id/export', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    try {
      const skill = skillsHub.exportSkill(req.params.id);
      res.json(200, { success: true, skill });
    } catch (err) {
      res.error(400, err.message);
    }
  });
}

module.exports = { registerSkillsHubRoutes };
