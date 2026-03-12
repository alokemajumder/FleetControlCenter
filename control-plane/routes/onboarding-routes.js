'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerOnboardingRoutes(router, config, modules) {
  const { auth, audit, doctor, onboarding } = modules;

  // Auth helper: during initial setup (not complete), no auth required.
  // After setup is complete, admin auth is required to access setup endpoints.
  function requireSetupAuth(req, opts = {}) {
    if (opts.alwaysRequireAdmin) {
      const authResult = authenticate(req, auth);
      if (!authResult.authenticated) return { allowed: false, status: 401, error: 'Not authenticated' };
      if ((authResult.user.role || '').toLowerCase() !== 'admin') return { allowed: false, status: 403, error: 'Admin required' };
      return { allowed: true, user: authResult.user };
    }
    if (!onboarding.isComplete()) {
      return { allowed: true, user: null };
    }
    // After setup is complete, require admin auth
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return { allowed: false, status: 401, error: 'Not authenticated' };
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return { allowed: false, status: 403, error: 'Admin required' };
    return { allowed: true, user: authResult.user };
  }

  // GET /api/setup/state
  router.get('/api/setup/state', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    const state = onboarding.getState();
    res.json(200, { success: true, state });
  });

  // POST /api/setup/start
  router.post('/api/setup/start', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    const state = onboarding.startSetup();
    if (check.user) {
      audit.log({ actor: check.user.username, action: 'setup.started', target: 'onboarding', detail: '' });
    }
    res.json(200, { success: true, state });
  });

  // POST /api/setup/step/:stepId
  router.post('/api/setup/step/:stepId', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    let body = {};
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    const stepId = req.params.stepId;
    try {
      const step = onboarding.completeStep(stepId, body);
      if (check.user) {
        audit.log({ actor: check.user.username, action: 'setup.step.completed', target: stepId, detail: '' });
      }
      res.json(200, { success: true, step });
    } catch (err) {
      res.json(400, { success: false, error: err.message });
    }
  });

  // POST /api/setup/skip/:stepId
  router.post('/api/setup/skip/:stepId', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    const stepId = req.params.stepId;
    try {
      const step = onboarding.skipStep(stepId);
      if (check.user) {
        audit.log({ actor: check.user.username, action: 'setup.step.skipped', target: stepId, detail: '' });
      }
      res.json(200, { success: true, step });
    } catch (err) {
      res.json(400, { success: false, error: err.message });
    }
  });

  // POST /api/setup/reset - Always requires admin
  router.post('/api/setup/reset', async (req, res) => {
    const check = requireSetupAuth(req, { alwaysRequireAdmin: true });
    if (!check.allowed) return res.error(check.status, check.error);
    const state = onboarding.resetSetup();
    audit.log({ actor: check.user.username, action: 'setup.reset', target: 'onboarding', detail: '' });
    res.json(200, { success: true, state });
  });

  // GET /api/setup/progress
  router.get('/api/setup/progress', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    const progress = onboarding.getProgress();
    res.json(200, { success: true, progress });
  });

  // POST /api/setup/scan
  router.post('/api/setup/scan', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    try {
      const results = onboarding.runSecurityScan(doctor);
      res.json(200, { success: true, results });
    } catch (err) {
      res.json(500, { success: false, error: err.message });
    }
  });

  // POST /api/setup/scan/fix
  router.post('/api/setup/scan/fix', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    try {
      const scanResults = onboarding.runSecurityScan(doctor);
      const fixResults = [];
      for (const item of scanResults.fixable) {
        if (item.fixId) {
          const fixResult = doctor.applyFix(item.fixId);
          fixResults.push({ checkId: item.id, ...fixResult });
        }
      }
      if (check.user) {
        audit.log({ actor: check.user.username, action: 'setup.scan.autofix', target: 'onboarding', detail: JSON.stringify({ fixed: fixResults.length }) });
      }
      res.json(200, { success: true, fixes: fixResults });
    } catch (err) {
      res.json(500, { success: false, error: err.message });
    }
  });

  // GET /api/setup/config
  router.get('/api/setup/config', async (req, res) => {
    const check = requireSetupAuth(req);
    if (!check.allowed) return res.error(check.status, check.error);
    const generatedConfig = onboarding.generateConfig();
    res.json(200, { success: true, config: generatedConfig });
  });
}

module.exports = { registerOnboardingRoutes };
