'use strict';

const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerUpdaterRoutes(router, config, modules) {
  const { auth, audit, updater } = modules;

  // GET /api/system/version — current version info (no auth needed)
  router.get('/api/system/version', async (req, res) => {
    const version = updater.getCurrentVersion();
    res.json(200, { success: true, version });
  });

  // GET /api/system/updates — check for updates (viewer+)
  router.get('/api/system/updates', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    try {
      const result = await updater.checkForUpdates();
      res.json(200, { success: true, ...result });
    } catch (err) {
      res.error(500, 'Failed to check for updates: ' + err.message);
    }
  });

  // GET /api/system/updates/status — get cached update status (viewer+)
  router.get('/api/system/updates/status', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const status = updater.getUpdateStatus();
    res.json(200, { success: true, ...status });
  });

  // GET /api/system/can-update — check if self-update is possible (admin)
  router.get('/api/system/can-update', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    const result = updater.canSelfUpdate();
    res.json(200, { success: true, ...result });
  });

  // POST /api/system/update — perform self-update (admin + step-up)
  router.post('/api/system/update', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    // Step-up auth required
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, 'Step-up authentication required');

    audit.log({
      actor: authResult.user.username,
      action: 'system.update.started',
      target: 'control-plane',
      detail: 'Self-update initiated'
    });

    const result = updater.performUpdate();

    if (result.success) {
      audit.log({
        actor: authResult.user.username,
        action: 'system.update.completed',
        target: 'control-plane',
        detail: result.previousVersion + ' -> ' + result.newVersion
      });
    } else {
      audit.log({
        actor: authResult.user.username,
        action: 'system.update.failed',
        target: 'control-plane',
        detail: result.error || result.output
      });
    }

    res.json(result.success ? 200 : 500, { success: result.success, ...result });
  });

  // GET /api/system/changelog — get changelog (viewer+)
  router.get('/api/system/changelog', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const changelog = updater.getChangelog();
    res.json(200, { success: true, ...changelog });
  });
}

module.exports = { registerUpdaterRoutes };
