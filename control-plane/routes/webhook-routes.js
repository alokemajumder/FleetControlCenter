'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');

function registerWebhookRoutes(router, config, modules) {
  const { auth, audit, webhookManager } = modules;

  // List all webhooks
  router.get('/api/webhooks', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const list = webhookManager.listWebhooks();
    // Mask secrets in response
    const safe = list.map(wh => ({ ...wh, secret: wh.secret ? wh.secret.slice(0, 6) + '...' : null }));
    res.json(200, { success: true, webhooks: safe });
  });

  // Create webhook
  router.post('/api/webhooks', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    try {
      const webhook = webhookManager.createWebhook(body);
      audit.log({ actor: authResult.user.username, action: 'webhook.created', target: webhook.id, detail: JSON.stringify({ name: webhook.name, url: webhook.url }) });
      res.json(201, { success: true, webhook });
    } catch (err) {
      return res.error(400, err.message);
    }
  });

  // Get webhook details
  router.get('/api/webhooks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const webhook = webhookManager.getWebhook(req.params.id);
    if (!webhook) return res.error(404, 'Webhook not found');
    res.json(200, { success: true, webhook });
  });

  // Update webhook
  router.put('/api/webhooks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }
    try {
      const webhook = webhookManager.updateWebhook(req.params.id, body);
      audit.log({ actor: authResult.user.username, action: 'webhook.updated', target: req.params.id, detail: JSON.stringify(body) });
      res.json(200, { success: true, webhook });
    } catch (err) {
      if (err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });

  // Delete webhook
  router.delete('/api/webhooks/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    try {
      webhookManager.deleteWebhook(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'webhook.deleted', target: req.params.id });
      res.json(200, { success: true });
    } catch (err) {
      if (err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });

  // Enable webhook
  router.post('/api/webhooks/:id/enable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const webhook = webhookManager.enableWebhook(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'webhook.enabled', target: req.params.id });
      res.json(200, { success: true, webhook });
    } catch (err) {
      if (err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });

  // Disable webhook
  router.post('/api/webhooks/:id/disable', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const webhook = webhookManager.disableWebhook(req.params.id);
      audit.log({ actor: authResult.user.username, action: 'webhook.disabled', target: req.params.id });
      res.json(200, { success: true, webhook });
    } catch (err) {
      if (err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });

  // Test webhook (send ping)
  router.post('/api/webhooks/:id/test', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const delivery = await webhookManager.testWebhook(req.params.id);
      res.json(200, { success: true, delivery });
    } catch (err) {
      if (err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });

  // Get delivery history
  router.get('/api/webhooks/:id/deliveries', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const webhook = webhookManager.getWebhook(req.params.id);
    if (!webhook) return res.error(404, 'Webhook not found');
    const limit = Math.min(Math.max(1, parseInt(req.query.limit || '50', 10)), 200);
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const result = webhookManager.getDeliveries(req.params.id, { limit, offset });
    res.json(200, { success: true, ...result });
  });

  // Retry a failed delivery
  router.post('/api/webhooks/:id/deliveries/:deliveryId/retry', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    try {
      const delivery = await webhookManager.retry(req.params.deliveryId);
      audit.log({ actor: authResult.user.username, action: 'webhook.delivery.retried', target: req.params.deliveryId });
      res.json(200, { success: true, delivery });
    } catch (err) {
      if (err.message === 'Delivery not found' || err.message === 'Webhook not found') return res.error(404, err.message);
      return res.error(400, err.message);
    }
  });
}

module.exports = { registerWebhookRoutes };
