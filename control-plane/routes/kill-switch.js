'use strict';
const crypto = require('crypto');
const { authenticate, requireStepUp } = require('../middleware/auth-middleware');
const { queueCommand } = require('../lib/fleet-commands');

function registerKillSwitchRoutes(router, config, modules) {
  const { auth, audit, events, receipts, snapshots, index } = modules;

  function getFleetNodes() {
    if (index) return index.getFleetNodes(config.dataDir);
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(config.dataDir, 'fleet', 'nodes.json');
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return {}; }
  }

  function getSessionsSnapshot() {
    const data = snapshots.load(config.dataDir, 'sessions');
    return data && data.sessions ? data.sessions : {};
  }

  function queueKillForNode(nodeId, killId, user, sessionId) {
    const command = {
      id: crypto.randomUUID(),
      action: 'kill-session',
      args: { killId, sessionId: sessionId || '*', reason: 'kill-switch' },
      requestedBy: user.username,
      ts: new Date().toISOString()
    };
    return queueCommand(nodeId, command);
  }

  async function performKill(type, target, user, res) {
    const killId = crypto.randomUUID();
    const ts = new Date().toISOString();

    audit.log({ actor: user.username, action: 'kill.' + type, target, detail: 'Kill switch activated', reason: 'Manual kill by ' + user.username });

    events.ingest({ ts, nodeId: type === 'node' ? target : null, sessionId: type === 'session' ? target : null, type: 'session.ended', severity: 'critical', payload: { reason: 'kill-switch', killId, killedBy: user.username, scope: type } });

    // Queue kill commands to the appropriate node agent(s)
    const commandsQueued = [];

    if (type === 'session') {
      // Find which node owns this session from snapshot data
      const sessions = getSessionsSnapshot();
      const session = sessions[target];
      if (session && session.nodeId) {
        const result = queueKillForNode(session.nodeId, killId, user, target);
        if (result.queued) commandsQueued.push(session.nodeId);
      } else {
        // Session node unknown - broadcast to all nodes
        const nodes = getFleetNodes();
        for (const nodeId of Object.keys(nodes)) {
          const result = queueKillForNode(nodeId, killId, user, target);
          if (result.queued) commandsQueued.push(nodeId);
        }
      }
    } else if (type === 'node') {
      // Kill all sessions on the target node
      const result = queueKillForNode(target, killId, user, null);
      if (result.queued) commandsQueued.push(target);
    } else if (type === 'global') {
      // Kill all sessions on all nodes
      const nodes = getFleetNodes();
      for (const nodeId of Object.keys(nodes)) {
        const result = queueKillForNode(nodeId, killId, user, null);
        if (result.queued) commandsQueued.push(nodeId);
      }
    }

    let bundle = null;
    try { bundle = receipts.exportBundle(config.dataDir, type === 'session' ? target : null, { killId }); } catch {}

    res.json(200, { success: true, killId, type, target, commandsQueued, evidenceBundle: bundle ? bundle.bundleId || killId : killId, timestamp: ts });
  }

  router.post('/api/kill/session/:sessionId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    try {
      await performKill('session', req.params.sessionId, authResult.user, res);
    } catch (err) {
      res.error(500, 'Kill operation failed: ' + err.message);
    }
  });

  router.post('/api/kill/node/:nodeId', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    try {
      await performKill('node', req.params.nodeId, authResult.user, res);
    } catch (err) {
      res.error(500, 'Kill operation failed: ' + err.message);
    }
  });

  router.post('/api/kill/global', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');
    if ((authResult.user.role || '').toLowerCase() !== 'admin') return res.error(403, 'Admin required');
    const stepUp = requireStepUp(req, auth, config);
    if (!stepUp.authorized) return res.error(403, stepUp.reason);
    try {
      await performKill('global', 'all', authResult.user, res);
    } catch (err) {
      res.error(500, 'Kill operation failed: ' + err.message);
    }
  });
}

module.exports = { registerKillSwitchRoutes };
