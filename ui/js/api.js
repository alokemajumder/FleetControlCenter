'use strict';
const API = {
  baseUrl: '',

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.baseUrl + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // Auth
  login(username, password) { return this.post('/api/auth/login', { username, password }); },
  logout() { return this.post('/api/auth/logout'); },
  me() { return this.get('/api/auth/me'); },
  verifyMfa(code) { return this.post('/api/auth/mfa/verify', { code }); },
  setupMfa() { return this.post('/api/auth/mfa/setup'); },
  enableMfa(code) { return this.post('/api/auth/mfa/enable', { code }); },
  stepUp(code) { return this.post('/api/auth/step-up', { code }); },
  changePassword(oldPassword, newPassword) { return this.post('/api/auth/change-password', { oldPassword, newPassword }); },

  // Fleet
  getNodes() { return this.get('/api/fleet/nodes'); },
  getNode(id) { return this.get('/api/fleet/nodes/' + id); },
  getNodeSessions(id) { return this.get('/api/fleet/nodes/' + id + '/sessions'); },
  nodeAction(id, action, args) { return this.post('/api/fleet/nodes/' + id + '/action', { action, args }); },
  removeNode(id) { return this.del('/api/fleet/nodes/' + id); },
  getTopology() { return this.get('/api/fleet/topology'); },
  getBlastRadius(nodeId) { return this.get('/api/fleet/nodes/' + nodeId + '/blast-radius'); },

  // Sessions
  getSessions() { return this.get('/api/sessions'); },
  getSession(id) { return this.get('/api/sessions/' + id); },
  getSessionTimeline(id) { return this.get('/api/sessions/' + id + '/timeline'); },
  getSessionReceipt(id) { return this.get('/api/sessions/' + id + '/receipt'); },
  compareSessions(id, otherId) { return this.post('/api/sessions/' + id + '/compare', { otherSessionId: otherId }); },
  getSessionBlastRadius(id) { return this.get('/api/sessions/' + id + '/blast-radius'); },

  // Events
  queryEvents(params) { return this.get('/api/events/query?' + new URLSearchParams(params)); },
  getCausality(target) { return this.get('/api/events/causality?target=' + encodeURIComponent(target)); },
  getStreak() { return this.get('/api/events/streak'); },

  // Ops
  getHealth() { return this.get('/api/ops/health'); },
  getHealthHistory() { return this.get('/api/ops/health/history'); },
  getUsage() { return this.get('/api/ops/usage'); },
  getUsageBreakdown(params) { return this.get('/api/ops/usage/breakdown?' + new URLSearchParams(params)); },
  getMemory() { return this.get('/api/ops/memory'); },
  getFiles() { return this.get('/api/ops/workspace/files'); },
  getFile(path) { return this.get('/api/ops/workspace/file?path=' + encodeURIComponent(path)); },
  saveFile(path, content, reason) { return this.put('/api/ops/workspace/file', { path, content, reason }); },
  getGit() { return this.get('/api/ops/git'); },
  getCron() { return this.get('/api/ops/cron'); },
  runCron(jobId) { return this.post('/api/ops/cron/' + jobId + '/run'); },
  toggleCron(jobId) { return this.post('/api/ops/cron/' + jobId + '/toggle'); },
  getCronHistory() { return this.get('/api/ops/cron/history'); },
  getLogs(source, lines) { return this.get('/api/ops/logs?source=' + source + '&lines=' + (lines || 100)); },
  getTailscale() { return this.get('/api/ops/tailscale'); },

  // Governance
  getPolicies() { return this.get('/api/governance/policies'); },
  getPolicy(id) { return this.get('/api/governance/policies/' + id); },
  updatePolicy(id, policy) { return this.put('/api/governance/policies/' + id, policy); },
  simulatePolicy(policyId, sessionId) { return this.post('/api/governance/policies/simulate', { policyId, sessionId }); },
  getApprovals() { return this.get('/api/governance/approvals'); },
  grantApproval(id) { return this.post('/api/governance/approvals/' + id + '/grant'); },
  denyApproval(id) { return this.post('/api/governance/approvals/' + id + '/deny'); },
  getTripwires() { return this.get('/api/governance/tripwires'); },
  getTripwireTriggers() { return this.get('/api/governance/tripwires/triggers'); },
  getAuditLog(params) { return this.get('/api/governance/audit?' + new URLSearchParams(params)); },
  exportEvidence(params) { return this.post('/api/governance/evidence/export', params); },
  verifyEvidence(bundle) { return this.post('/api/governance/evidence/verify', bundle); },
  getSkills() { return this.get('/api/governance/skills'); },
  deploySkill(id) { return this.post('/api/governance/skills/' + id + '/deploy'); },
  rollbackSkill(id) { return this.post('/api/governance/skills/' + id + '/rollback'); },
  verifyReceipts(date) { return this.get('/api/governance/receipts/verify?date=' + date); },

  // Kill switch
  killSession(id) { return this.post('/api/kill/session/' + id); },
  killNode(id) { return this.post('/api/kill/node/' + id); },
  killGlobal() { return this.post('/api/kill/global'); },

  // Heatmap
  getHeatmap() { return this.get('/api/events/heatmap'); },

  // Session replay
  getSessionReplay(id) { return this.get('/api/sessions/' + id + '/replay'); },

  // Usage alerts & rolling windows
  getUsageAlerts() { return this.get('/api/ops/usage/alerts'); },
  getUsageRolling(window) { return this.get('/api/ops/usage/rolling?window=' + (window || '24h')); },

  // Push notifications
  subscribePush(subscription) { return this.post('/api/ops/notifications/subscribe', subscription); },
  testNotification() { return this.post('/api/ops/notifications/test'); },

  // Evidence ZIP export
  async exportEvidenceZip(params) {
    const res = await fetch(this.baseUrl + '/api/governance/evidence/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(params || {})
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'evidence-bundle.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
