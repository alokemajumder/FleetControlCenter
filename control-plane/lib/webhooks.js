'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const MAX_DELIVERIES_PER_WEBHOOK = 1000;

function createWebhookManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const webhooksDir = dataDir ? path.join(dataDir, 'webhooks') : null;
  const webhooks = new Map();
  const deliveries = new Map(); // webhookId -> Delivery[]

  // Load persisted webhooks from disk
  function _loadWebhooks() {
    if (!webhooksDir) return;
    try {
      const filePath = path.join(webhooksDir, 'webhooks.json');
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const wh of data) {
        webhooks.set(wh.id, wh);
      }
    } catch { /* no file yet */ }
  }

  // Persist webhooks to disk
  function _saveWebhooks() {
    if (!webhooksDir) return;
    try {
      fs.mkdirSync(webhooksDir, { recursive: true });
      const filePath = path.join(webhooksDir, 'webhooks.json');
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify([...webhooks.values()], null, 2));
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      console.error('Webhook save error:', err.message);
    }
  }

  // Load deliveries for a webhook from disk
  function _loadDeliveries(webhookId) {
    if (deliveries.has(webhookId)) return deliveries.get(webhookId);
    const list = [];
    if (webhooksDir) {
      try {
        const filePath = path.join(webhooksDir, 'deliveries-' + webhookId + '.jsonl');
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try { list.push(JSON.parse(line)); } catch { /* skip bad lines */ }
        }
      } catch { /* no file yet */ }
    }
    deliveries.set(webhookId, list);
    return list;
  }

  // Append a delivery to disk
  function _appendDelivery(webhookId, delivery) {
    const list = _loadDeliveries(webhookId);
    list.push(delivery);
    // Trim to last MAX_DELIVERIES_PER_WEBHOOK
    while (list.length > MAX_DELIVERIES_PER_WEBHOOK) {
      list.shift();
    }
    if (webhooksDir) {
      try {
        fs.mkdirSync(webhooksDir, { recursive: true });
        const filePath = path.join(webhooksDir, 'deliveries-' + webhookId + '.jsonl');
        fs.appendFileSync(filePath, JSON.stringify(delivery) + '\n');
      } catch (err) {
        console.error('Delivery append error:', err.message);
      }
    }
  }

  // Update a delivery on disk (rewrite the JSONL file)
  function _persistDeliveries(webhookId) {
    if (!webhooksDir) return;
    const list = deliveries.get(webhookId) || [];
    try {
      fs.mkdirSync(webhooksDir, { recursive: true });
      const filePath = path.join(webhooksDir, 'deliveries-' + webhookId + '.jsonl');
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, list.map(d => JSON.stringify(d)).join('\n') + (list.length ? '\n' : ''));
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      console.error('Delivery persist error:', err.message);
    }
  }

  // Initialize
  _loadWebhooks();

  function createWebhook(data) {
    if (!data.name) throw new Error('Webhook name is required');
    if (!data.url) throw new Error('Webhook URL is required');
    // Validate URL format
    try {
      const parsed = new URL(data.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('URL must use http or https protocol');
      }
    } catch (err) {
      if (err.message === 'URL must use http or https protocol') throw err;
      throw new Error('Invalid URL: ' + data.url);
    }
    if (!data.events || !Array.isArray(data.events) || data.events.length === 0) {
      throw new Error('At least one event type is required');
    }

    const now = Date.now();
    const webhook = {
      id: crypto.randomUUID(),
      name: data.name,
      url: data.url,
      secret: data.secret || crypto.randomBytes(32).toString('hex'),
      events: data.events,
      enabled: data.enabled !== false,
      retryPolicy: {
        maxRetries: (data.retryPolicy && data.retryPolicy.maxRetries) || 3,
        backoffMs: (data.retryPolicy && data.retryPolicy.backoffMs) || 1000
      },
      circuitBreaker: {
        failureThreshold: (data.circuitBreaker && data.circuitBreaker.failureThreshold) || 5,
        resetTimeMs: (data.circuitBreaker && data.circuitBreaker.resetTimeMs) || 60000,
        state: 'closed',
        lastFailureAt: null
      },
      createdAt: now,
      updatedAt: now,
      stats: {
        totalDeliveries: 0,
        successCount: 0,
        failureCount: 0,
        lastDeliveryAt: null,
        lastStatus: null,
        consecutiveFailures: 0
      }
    };

    webhooks.set(webhook.id, webhook);
    _saveWebhooks();
    return webhook;
  }

  function getWebhook(id) {
    return webhooks.get(id) || null;
  }

  function listWebhooks() {
    return [...webhooks.values()];
  }

  function updateWebhook(id, updates) {
    const webhook = webhooks.get(id);
    if (!webhook) throw new Error('Webhook not found');

    // Only allow updating certain fields
    const allowed = ['name', 'url', 'events', 'enabled', 'retryPolicy', 'circuitBreaker'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        if (key === 'url') {
          try {
            const parsed = new URL(updates.url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              throw new Error('URL must use http or https protocol');
            }
          } catch (err) {
            if (err.message === 'URL must use http or https protocol') throw err;
            throw new Error('Invalid URL: ' + updates.url);
          }
        }
        webhook[key] = updates[key];
      }
    }
    webhook.updatedAt = Date.now();
    _saveWebhooks();
    return webhook;
  }

  function deleteWebhook(id) {
    const existed = webhooks.delete(id);
    if (!existed) throw new Error('Webhook not found');
    deliveries.delete(id);
    // Remove deliveries file
    if (webhooksDir) {
      try {
        const filePath = path.join(webhooksDir, 'deliveries-' + id + '.jsonl');
        fs.unlinkSync(filePath);
      } catch { /* file may not exist */ }
    }
    _saveWebhooks();
    return true;
  }

  function enableWebhook(id) {
    const webhook = webhooks.get(id);
    if (!webhook) throw new Error('Webhook not found');
    webhook.enabled = true;
    webhook.updatedAt = Date.now();
    _saveWebhooks();
    return webhook;
  }

  function disableWebhook(id) {
    const webhook = webhooks.get(id);
    if (!webhook) throw new Error('Webhook not found');
    webhook.enabled = false;
    webhook.updatedAt = Date.now();
    _saveWebhooks();
    return webhook;
  }

  function _checkCircuitBreaker(webhook) {
    const cb = webhook.circuitBreaker;
    if (cb.state === 'closed') return true;
    if (cb.state === 'open') {
      // Check if reset time has elapsed -> transition to half-open
      if (cb.lastFailureAt && Date.now() - cb.lastFailureAt >= cb.resetTimeMs) {
        cb.state = 'half-open';
        _saveWebhooks();
        return true;
      }
      return false;
    }
    if (cb.state === 'half-open') {
      // Allow one delivery attempt
      return true;
    }
    return false;
  }

  function _updateCircuitBreaker(webhook, success) {
    const cb = webhook.circuitBreaker;
    if (success) {
      webhook.stats.consecutiveFailures = 0;
      if (cb.state === 'half-open') {
        cb.state = 'closed';
      }
    } else {
      webhook.stats.consecutiveFailures++;
      cb.lastFailureAt = Date.now();
      if (cb.state === 'half-open') {
        cb.state = 'open';
      } else if (webhook.stats.consecutiveFailures >= cb.failureThreshold) {
        cb.state = 'open';
      }
    }
    _saveWebhooks();
  }

  function _signPayload(body, secret) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  function deliver(delivery) {
    const webhook = webhooks.get(delivery.webhookId);
    if (!webhook) {
      delivery.status = 'failed';
      delivery.error = 'Webhook not found';
      return Promise.resolve(delivery);
    }

    if (!_checkCircuitBreaker(webhook)) {
      delivery.status = 'failed';
      delivery.error = 'Circuit breaker is open';
      delivery.lastAttemptAt = Date.now();
      _updateDeliveryInList(delivery);
      return Promise.resolve(delivery);
    }

    const bodyStr = JSON.stringify(delivery.payload);
    const signature = _signPayload(bodyStr, webhook.secret);

    return new Promise((resolve) => {
      try {
        const parsed = new URL(webhook.url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const reqOpts = {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'X-FCC-Event': delivery.event,
            'X-FCC-Delivery': delivery.id,
            'X-FCC-Signature': 'sha256=' + signature
          },
          timeout: 10000
        };

        const req = mod.request(reqOpts, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            delivery.attempts++;
            delivery.lastAttemptAt = Date.now();
            delivery.responseStatus = res.statusCode;
            delivery.responseBody = body.slice(0, 1024); // cap stored response

            const success = res.statusCode >= 200 && res.statusCode < 300;
            delivery.status = success ? 'success' : 'failed';

            webhook.stats.totalDeliveries++;
            webhook.stats.lastDeliveryAt = Date.now();
            webhook.stats.lastStatus = res.statusCode;
            if (success) {
              webhook.stats.successCount++;
            } else {
              webhook.stats.failureCount++;
            }
            _updateCircuitBreaker(webhook, success);
            _updateDeliveryInList(delivery);
            resolve(delivery);
          });
        });

        req.on('timeout', () => {
          req.destroy();
          delivery.attempts++;
          delivery.lastAttemptAt = Date.now();
          delivery.status = 'failed';
          delivery.error = 'Request timeout';
          webhook.stats.totalDeliveries++;
          webhook.stats.failureCount++;
          webhook.stats.lastDeliveryAt = Date.now();
          _updateCircuitBreaker(webhook, false);
          _updateDeliveryInList(delivery);
          resolve(delivery);
        });

        req.on('error', (err) => {
          delivery.attempts++;
          delivery.lastAttemptAt = Date.now();
          delivery.status = 'failed';
          delivery.error = err.message;
          webhook.stats.totalDeliveries++;
          webhook.stats.failureCount++;
          webhook.stats.lastDeliveryAt = Date.now();
          _updateCircuitBreaker(webhook, false);
          _updateDeliveryInList(delivery);
          resolve(delivery);
        });

        req.write(bodyStr);
        req.end();
      } catch (err) {
        delivery.attempts++;
        delivery.lastAttemptAt = Date.now();
        delivery.status = 'failed';
        delivery.error = err.message;
        _updateDeliveryInList(delivery);
        resolve(delivery);
      }
    });
  }

  function _updateDeliveryInList(delivery) {
    const list = deliveries.get(delivery.webhookId);
    if (list) {
      const idx = list.findIndex(d => d.id === delivery.id);
      if (idx >= 0) {
        list[idx] = delivery;
        _persistDeliveries(delivery.webhookId);
      }
    }
  }

  function _createDelivery(webhookId, eventType, payload) {
    const delivery = {
      id: crypto.randomUUID(),
      webhookId,
      event: eventType,
      payload,
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      responseStatus: null,
      responseBody: null,
      error: null,
      createdAt: Date.now()
    };
    _appendDelivery(webhookId, delivery);
    return delivery;
  }

  function dispatch(eventType, payload) {
    const matched = [];
    for (const webhook of webhooks.values()) {
      if (!webhook.enabled) continue;
      if (webhook.events.includes('*') || webhook.events.includes(eventType)) {
        const delivery = _createDelivery(webhook.id, eventType, payload);
        matched.push(delivery);
        // Fire and forget delivery with retry
        _deliverWithRetry(delivery, webhook);
      }
    }
    return matched;
  }

  async function _deliverWithRetry(delivery, webhook) {
    const maxRetries = webhook.retryPolicy.maxRetries;
    const backoffMs = webhook.retryPolicy.backoffMs;

    const result = await deliver(delivery);
    if (result.status === 'success') return result;

    // Retry with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (result.error === 'Circuit breaker is open') break;
      const delay = backoffMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      // Re-check circuit breaker before retry
      if (!_checkCircuitBreaker(webhook)) {
        result.error = 'Circuit breaker is open';
        _updateDeliveryInList(result);
        break;
      }
      const retryResult = await deliver(delivery);
      if (retryResult.status === 'success') return retryResult;
    }
    return result;
  }

  function retry(deliveryId) {
    // Find the delivery across all webhooks
    for (const [webhookId, list] of deliveries) {
      const delivery = list.find(d => d.id === deliveryId);
      if (delivery) {
        const webhook = webhooks.get(webhookId);
        if (!webhook) throw new Error('Webhook not found');
        delivery.status = 'pending';
        delivery.error = null;
        return _deliverWithRetry(delivery, webhook);
      }
    }
    throw new Error('Delivery not found');
  }

  function getDeliveries(webhookId, opts = {}) {
    const list = _loadDeliveries(webhookId);
    const limit = opts.limit || 50;
    const offset = opts.offset || 0;
    // Return most recent first
    const sorted = [...list].reverse();
    return {
      deliveries: sorted.slice(offset, offset + limit),
      total: list.length
    };
  }

  function testWebhook(id) {
    const webhook = webhooks.get(id);
    if (!webhook) throw new Error('Webhook not found');
    const payload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      message: 'This is a test ping from Fleet Control Center'
    };
    const delivery = _createDelivery(webhook.id, 'webhook.test', payload);
    return deliver(delivery);
  }

  return {
    createWebhook,
    getWebhook,
    listWebhooks,
    updateWebhook,
    deleteWebhook,
    enableWebhook,
    disableWebhook,
    dispatch,
    deliver,
    retry,
    getDeliveries,
    testWebhook,
    _checkCircuitBreaker,
    _updateCircuitBreaker,
    _signPayload
  };
}

module.exports = { createWebhookManager };
