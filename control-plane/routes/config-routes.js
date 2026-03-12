'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerConfigRoutes(router, config, modules) {
  const { auth, audit, configManager } = modules;

  // GET /api/system/config - Export config (admin, secrets redacted)
  router.get('/api/system/config', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    const exported = configManager.exportConfig();
    audit.log({ actor: authResult.user.username, action: 'config.exported', target: 'system', detail: 'Config exported (secrets redacted)' });
    res.json(200, { success: true, config: exported });
  });

  // POST /api/system/config/import - Import config (admin + step-up)
  router.post('/api/system/config/import', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason || 'Step-up authentication required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body || !body.config) return res.error(400, 'config object is required');

    const result = configManager.importConfig(body.config);
    audit.log({ actor: authResult.user.username, action: 'config.imported', target: 'system', detail: JSON.stringify({ applied: result.applied.length, warnings: result.warnings.length }) });
    res.json(200, { success: true, ...result });
  });

  // POST /api/system/config/validate - Validate config (admin)
  router.post('/api/system/config/validate', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body || !body.config) return res.error(400, 'config object is required');

    const result = configManager.validateConfig(body.config);
    res.json(200, { success: true, ...result });
  });

  // GET /api/system/config/diff - Preview changes (admin)
  router.get('/api/system/config/diff', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');

    // For GET, read newConfig from query param (base64-encoded JSON)
    const url = new URL(req.url, 'http://localhost');
    const encoded = url.searchParams.get('config');
    if (!encoded) return res.error(400, 'config query parameter is required (base64 JSON)');

    let newConfig;
    try {
      newConfig = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      return res.error(400, 'Invalid base64 JSON in config parameter');
    }

    const changes = configManager.getDiff(newConfig);
    res.json(200, { success: true, changes });
  });

  // GET /api/system/config/schema - Get config schema (viewer+)
  router.get('/api/system/config/schema', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const schema = configManager.getConfigSchema();
    res.json(200, { success: true, schema });
  });
}

module.exports = { registerConfigRoutes };
