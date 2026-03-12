'use strict';

const { parseBody } = require('../middleware/security');
const { authenticate } = require('../middleware/auth-middleware');

function registerChannelRoutes(router, config, modules) {
  const { auth, audit, channelManager } = modules;

  // GET /api/channels/search - must be registered BEFORE /api/channels/:id
  router.get('/api/channels/search', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const q = req.query.q || '';
    if (!q) return res.json(200, { success: true, messages: [] });

    const limit = parseInt(req.query.limit, 10) || 50;
    const results = channelManager.searchMessages(q, { limit });
    res.json(200, { success: true, messages: results });
  });

  // GET /api/channels - List channels
  router.get('/api/channels', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.member) filters.member = req.query.member;
    if (req.query.archived !== undefined) filters.archived = req.query.archived === 'true';

    const channels = channelManager.listChannels(filters);
    res.json(200, { success: true, channels });
  });

  // POST /api/channels - Create channel (operator+ role)
  router.post('/api/channels', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'operator') {
      return res.error(403, 'Insufficient permissions: operator or admin role required');
    }

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.name) return res.error(400, 'Channel name is required');

    const channel = channelManager.createChannel({
      name: body.name,
      type: body.type || 'group',
      description: body.description || '',
      createdBy: authResult.user.username,
      members: body.members || []
    });

    audit.log({
      actor: authResult.user.username,
      action: 'channel.created',
      target: channel.id,
      detail: JSON.stringify({ name: channel.name, type: channel.type })
    });

    res.json(201, { success: true, channel });
  });

  // GET /api/channels/:id - Get channel details
  router.get('/api/channels/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    res.json(200, { success: true, channel });
  });

  // PUT /api/channels/:id - Update channel (admin or channel creator)
  router.put('/api/channels/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && channel.createdBy !== authResult.user.username) {
      return res.error(403, 'Only admin or channel creator can update');
    }

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.pinned !== undefined) updates.pinned = body.pinned;

    const updated = channelManager.updateChannel(req.params.id, updates);
    audit.log({
      actor: authResult.user.username,
      action: 'channel.updated',
      target: req.params.id,
      detail: JSON.stringify(updates)
    });

    res.json(200, { success: true, channel: updated });
  });

  // DELETE /api/channels/:id - Delete channel (admin only)
  router.delete('/api/channels/:id', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin') return res.error(403, 'Admin role required');

    const deleted = channelManager.deleteChannel(req.params.id);
    if (!deleted) return res.error(404, 'Channel not found');

    audit.log({
      actor: authResult.user.username,
      action: 'channel.deleted',
      target: req.params.id
    });

    res.json(200, { success: true });
  });

  // POST /api/channels/:id/archive - Archive channel (admin or creator)
  router.post('/api/channels/:id/archive', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    const role = (authResult.user.role || '').toLowerCase();
    if (role !== 'admin' && channel.createdBy !== authResult.user.username) {
      return res.error(403, 'Only admin or channel creator can archive');
    }

    const archived = channelManager.archiveChannel(req.params.id);
    audit.log({
      actor: authResult.user.username,
      action: 'channel.archived',
      target: req.params.id
    });

    res.json(200, { success: true, channel: archived });
  });

  // POST /api/channels/:id/join - Join channel
  router.post('/api/channels/:id/join', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    const member = {
      id: body.memberId || authResult.user.username,
      type: body.memberType || 'user'
    };

    const updated = channelManager.joinChannel(req.params.id, member);
    res.json(200, { success: true, channel: updated });
  });

  // POST /api/channels/:id/leave - Leave channel
  router.post('/api/channels/:id/leave', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    const memberId = body.memberId || authResult.user.username;
    const updated = channelManager.leaveChannel(req.params.id, memberId);
    res.json(200, { success: true, channel: updated });
  });

  // GET /api/channels/:id/messages - Get messages with pagination
  router.get('/api/channels/:id/messages', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    const opts = {};
    if (req.query.limit) opts.limit = parseInt(req.query.limit, 10);
    if (req.query.before) opts.before = parseInt(req.query.before, 10);
    if (req.query.after) opts.after = parseInt(req.query.after, 10);

    const messages = channelManager.getMessages(req.params.id, opts);
    res.json(200, { success: true, messages });
  });

  // POST /api/channels/:id/messages - Send message
  router.post('/api/channels/:id/messages', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    let body;
    try { body = await parseBody(req); } catch (err) { return res.error(400, err.message); }

    if (!body.content) return res.error(400, 'Message content is required');

    const msg = channelManager.sendMessage(req.params.id, {
      senderId: authResult.user.username,
      senderType: body.senderType || 'user',
      senderName: body.senderName || authResult.user.username,
      content: body.content,
      metadata: body.metadata || {},
      replyTo: body.replyTo || null
    });

    res.json(201, { success: true, message: msg });
  });

  // GET /api/channels/:id/stream - SSE stream for channel messages
  router.get('/api/channels/:id/stream', async (req, res) => {
    const authResult = authenticate(req, auth);
    if (!authResult.authenticated) return res.error(401, 'Not authenticated');

    const channel = channelManager.getChannel(req.params.id);
    if (!channel) return res.error(404, 'Channel not found');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(':ok\n\n');

    const channelId = req.params.id;

    const onMessage = (msg) => {
      try { res.write('data: ' + JSON.stringify(msg) + '\n\n'); } catch { /* ignore */ }
    };

    channelManager.subscribe(channelId, onMessage);

    const keepalive = setInterval(() => {
      try { res.write(':keepalive\n\n'); } catch { cleanup(); }
    }, 30000);

    const maxLifetime = setTimeout(() => { cleanup(); }, 3600000);

    function cleanup() {
      channelManager.unsubscribe(channelId, onMessage);
      clearInterval(keepalive);
      clearTimeout(maxLifetime);
      try { res.end(); } catch { /* ignore */ }
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
  });
}

module.exports = { registerChannelRoutes };
