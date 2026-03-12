'use strict';
const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerUserRoutes(router, config, modules) {
  const { auth, audit } = modules;

  function isAdmin(user) {
    return (user.role || '').toLowerCase() === 'admin';
  }

  function isSelfOrAdmin(user, targetUsername) {
    return isAdmin(user) || user.username === targetUsername;
  }

  // GET /api/users - List all users (admin only)
  router.get('/api/users', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    const users = auth.listAllUsers();
    res.json(200, { success: true, users });
  });

  // POST /api/users - Create user (admin + step-up)
  router.post('/api/users', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    if (!authResult.viaApiKey) {
      const stepUp = requireStepUp(req, auth, config);
      if (!stepUp.authorized) return res.error(403, stepUp.reason);
    }
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    const { username, password, role } = body;
    if (!username || !password) return res.error(400, 'Username and password required');
    if (password.length < 8) return res.error(400, 'Password must be at least 8 characters');
    try {
      const user = auth.createUser(username, password, role || 'viewer');
      audit.log({ actor: authResult.user.username, action: 'user.created', target: username, detail: JSON.stringify({ role: role || 'viewer' }) });
      res.json(201, { success: true, user });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // GET /api/users/:id - Get user details (admin only)
  router.get('/api/users/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    const username = req.params.id;
    try {
      const activity = auth.getUserActivity(username);
      const user = auth.loadUsers(config.dataDir).find(u => u.username === username);
      if (!user) return res.error(404, 'User not found');
      res.json(200, { success: true, user: { ...user, ...activity } });
    } catch (err) {
      return res.error(404, err.message);
    }
  });

  // PUT /api/users/:id - Update user (admin + step-up)
  router.put('/api/users/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    if (!authResult.viaApiKey) {
      const stepUp = requireStepUp(req, auth, config);
      if (!stepUp.authorized) return res.error(403, stepUp.reason);
    }
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    const username = req.params.id;
    try {
      if (body.role) {
        auth.setUserRole(username, body.role);
      }
      if (body.password) {
        if (body.password.length < 8) return res.error(400, 'Password must be at least 8 characters');
        auth.updatePassword(username, body.password);
      }
      audit.log({ actor: authResult.user.username, action: 'user.updated', target: username, detail: JSON.stringify({ fields: Object.keys(body) }) });
      const user = auth.loadUsers(config.dataDir).find(u => u.username === username);
      res.json(200, { success: true, user });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // DELETE /api/users/:id - Delete user (admin + step-up, cannot delete self)
  router.delete('/api/users/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    if (!authResult.viaApiKey) {
      const stepUp = requireStepUp(req, auth, config);
      if (!stepUp.authorized) return res.error(403, stepUp.reason);
    }
    const username = req.params.id;
    if (username === authResult.user.username) return res.error(400, 'Cannot delete self');
    try {
      auth.deleteUser(username);
      audit.log({ actor: authResult.user.username, action: 'user.deleted', target: username });
      res.json(200, { success: true });
    } catch (err) {
      return res.error(404, err.message);
    }
  });

  // POST /api/users/:id/role - Set role (admin + step-up)
  router.post('/api/users/:id/role', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    if (!authResult.viaApiKey) {
      const stepUp = requireStepUp(req, auth, config);
      if (!stepUp.authorized) return res.error(403, stepUp.reason);
    }
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    if (!body.role) return res.error(400, 'Role required');
    try {
      const result = auth.setUserRole(req.params.id, body.role);
      audit.log({ actor: authResult.user.username, action: 'user.role.changed', target: req.params.id, detail: JSON.stringify({ role: body.role }) });
      res.json(200, { success: true, user: result });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // POST /api/users/:id/disable - Disable user (admin)
  router.post('/api/users/:id/disable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    try {
      auth.disableUser(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'user.disabled', target: req.params.id });
      res.json(200, { success: true });
    } catch (err) {
      return res.error(404, err.message);
    }
  });

  // POST /api/users/:id/enable - Enable user (admin)
  router.post('/api/users/:id/enable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    try {
      auth.enableUser(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'user.enabled', target: req.params.id });
      res.json(200, { success: true });
    } catch (err) {
      return res.error(404, err.message);
    }
  });

  // GET /api/users/:id/activity - User activity (admin)
  router.get('/api/users/:id/activity', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isAdmin(authResult.user)) return res.error(403, 'Admin required');
    try {
      const activity = auth.getUserActivity(req.params.id);
      res.json(200, { success: true, activity });
    } catch (err) {
      return res.error(404, err.message);
    }
  });

  // POST /api/users/:id/api-keys - Create API key (admin or self)
  router.post('/api/users/:id/api-keys', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isSelfOrAdmin(authResult.user, req.params.id)) return res.error(403, 'Forbidden');
    try {
      const result = auth.createApiKey(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'user.apikey.created', target: req.params.id, detail: JSON.stringify({ prefix: result.prefix }) });
      res.json(201, { success: true, key: result.key, prefix: result.prefix });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // GET /api/users/:id/api-keys - List API keys (admin or self)
  router.get('/api/users/:id/api-keys', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isSelfOrAdmin(authResult.user, req.params.id)) return res.error(403, 'Forbidden');
    try {
      const keys = auth.listApiKeys(req.params.id);
      res.json(200, { success: true, keys });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // DELETE /api/users/:id/api-keys/:prefix - Revoke API key (admin or self)
  router.delete('/api/users/:id/api-keys/:prefix', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if (!isSelfOrAdmin(authResult.user, req.params.id)) return res.error(403, 'Forbidden');
    try {
      const revoked = auth.revokeApiKey(req.params.id, req.params.prefix);
      if (!revoked) return res.error(404, 'API key not found');
      audit.log({ actor: authResult.user.username, action: 'user.apikey.revoked', target: req.params.id, detail: JSON.stringify({ prefix: req.params.prefix }) });
      res.json(200, { success: true });
    } catch (err) {
      return res.error(400, err.message);
    }
  });
}

module.exports = { registerUserRoutes };
