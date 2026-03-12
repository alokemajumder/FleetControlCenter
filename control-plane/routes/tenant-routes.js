'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerTenantRoutes(router, config, modules) {
  const { auth, audit, tenantManager } = modules;

  if (!tenantManager) return;

  // GET /api/tenants - List tenants (admin only)
  router.get('/api/tenants', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const url = new (require('url').URL)(req.url, 'http://localhost');
    const status = url.searchParams.get('status');
    const tenantsList = tenantManager.listTenants(status ? { status } : {});
    res.json(200, { success: true, tenants: tenantsList });
  });

  // POST /api/tenants - Create tenant (admin + step-up)
  router.post('/api/tenants', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason || 'Step-up required');
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    if (!body.name || !body.slug) return res.error(400, 'name and slug required');
    try {
      const tenant = tenantManager.createTenant({ ...body, owner: body.owner || authResult.user.username });
      audit.log({ actor: authResult.user.username, action: 'tenant.create', target: tenant.id, detail: tenant.slug });
      res.json(201, { success: true, tenant });
    } catch (err) {
      res.error(400, err.message);
    }
  });

  // GET /api/tenants/:id - Get tenant (admin or tenant owner)
  router.get('/api/tenants/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const tenant = tenantManager.getTenant(req.params.id);
    if (!tenant) return res.error(404, 'Tenant not found');
    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && tenant.owner !== authResult.user.username) return res.error(403, 'Forbidden');
    res.json(200, { success: true, tenant });
  });

  // PUT /api/tenants/:id - Update tenant (admin + step-up)
  router.put('/api/tenants/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason || 'Step-up required');
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    try {
      const tenant = tenantManager.updateTenant(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'tenant.update', target: tenant.id });
      res.json(200, { success: true, tenant });
    } catch (err) {
      res.error(err.message === 'Tenant not found' ? 404 : 400, err.message);
    }
  });

  // POST /api/tenants/:id/suspend - Suspend tenant (admin)
  router.post('/api/tenants/:id/suspend', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const tenant = tenantManager.suspendTenant(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'tenant.suspend', target: tenant.id });
      res.json(200, { success: true, tenant });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/tenants/:id/activate - Activate tenant (admin)
  router.post('/api/tenants/:id/activate', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const tenant = tenantManager.activateTenant(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'tenant.activate', target: tenant.id });
      res.json(200, { success: true, tenant });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // POST /api/tenants/:id/archive - Archive tenant (admin)
  router.post('/api/tenants/:id/archive', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const tenant = tenantManager.archiveTenant(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'tenant.archive', target: tenant.id });
      res.json(200, { success: true, tenant });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // DELETE /api/tenants/:id - Delete tenant (admin + step-up)
  router.delete('/api/tenants/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason || 'Step-up required');
    const deleted = tenantManager.deleteTenant(req.params.id);
    if (!deleted) return res.error(404, 'Tenant not found');
    audit.log({ actor: authResult.user.username, action: 'tenant.delete', target: req.params.id });
    res.json(200, { success: true });
  });

  // GET /api/tenants/:id/stats - Tenant statistics (admin or owner)
  router.get('/api/tenants/:id/stats', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const tenant = tenantManager.getTenant(req.params.id);
    if (!tenant) return res.error(404, 'Tenant not found');
    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && tenant.owner !== authResult.user.username) return res.error(403, 'Forbidden');
    try {
      const stats = tenantManager.getTenantStats(req.params.id);
      res.json(200, { success: true, stats });
    } catch (err) {
      res.error(404, err.message);
    }
  });

  // GET /api/tenants/:id/quota - Check quota status (admin or owner)
  router.get('/api/tenants/:id/quota', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    const tenant = tenantManager.getTenant(req.params.id);
    if (!tenant) return res.error(404, 'Tenant not found');
    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && tenant.owner !== authResult.user.username) return res.error(403, 'Forbidden');
    const quota = {
      node: tenantManager.checkQuota(req.params.id, 'node'),
      session: tenantManager.checkQuota(req.params.id, 'session'),
      event: tenantManager.checkQuota(req.params.id, 'event')
    };
    res.json(200, { success: true, quota, config: tenant.config });
  });
}

module.exports = { registerTenantRoutes };
