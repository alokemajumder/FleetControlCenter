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
  // Doctor & Backup
  getDoctor() { return this.get('/api/ops/doctor'); },
  fixDoctor(checkId) { return this.post('/api/ops/doctor/fix/' + checkId); },
  getBackups() { return this.get('/api/ops/backups'); },
  createBackup() { return this.post('/api/ops/backup'); },
  restoreBackup(id) { return this.post('/api/ops/restore/' + id); },
  deleteBackup(id) { return this.del('/api/ops/backup/' + id); },

  // Gateway
  getUpstreams() { return this.get('/api/gateway/upstreams'); },
  addUpstream(data) { return this.post('/api/gateway/upstreams', data); },
  updateUpstream(id, data) { return this.put('/api/gateway/upstreams/' + id, data); },
  removeUpstream(id) { return this.del('/api/gateway/upstreams/' + id); },
  getGatewayStatus() { return this.get('/api/gateway/status'); },
  getAggregateNodes() { return this.get('/api/gateway/aggregate/nodes'); },
  getAggregateSessions() { return this.get('/api/gateway/aggregate/sessions'); },

  // Agents
  getAgents(params) { return this.get('/api/agents' + (params ? '?' + new URLSearchParams(params) : '')); },
  getAgentSummary() { return this.get('/api/agents/summary'); },
  getAgent(id) { return this.get('/api/agents/' + id); },
  getAgentTimeline(id) { return this.get('/api/agents/' + id + '/timeline'); },
  getAgentMetrics(id) { return this.get('/api/agents/' + id + '/metrics'); },
  getAgentsByType(type) { return this.get('/api/agents/type/' + type); },

  // Channels
  getChannels() { return this.get('/api/channels'); },
  createChannel(data) { return this.post('/api/channels', data); },
  getChannelMessages(id, params) { return this.get('/api/channels/' + id + '/messages' + (params ? '?' + new URLSearchParams(params) : '')); },
  sendChannelMessage(id, data) { return this.post('/api/channels/' + id + '/messages', data); },
  joinChannel(id) { return this.post('/api/channels/' + id + '/join'); },
  leaveChannel(id) { return this.post('/api/channels/' + id + '/leave'); },

  // Knowledge Graph
  getKnowledgeGraph(params) { return this.get('/api/knowledge/graph' + (params ? '?' + new URLSearchParams(params) : '')); },
  getKnowledgeStats() { return this.get('/api/knowledge/stats'); },
  searchKnowledge(q) { return this.get('/api/knowledge/search?q=' + encodeURIComponent(q)); },
  ingestKnowledge() { return this.post('/api/knowledge/ingest'); },
  getKnowledgeTop(limit) { return this.get('/api/knowledge/top?limit=' + (limit || 10)); },

  // Setup
  getSetupState() { return this.get('/api/setup/state'); },
  startSetup() { return this.post('/api/setup/start'); },
  completeSetupStep(stepId, data) { return this.post('/api/setup/step/' + stepId, data); },
  getSetupProgress() { return this.get('/api/setup/progress'); },
  runSecurityScan() { return this.post('/api/setup/scan'); },

  // Tasks
  getTasks(params) { return this.get('/api/tasks' + (params ? '?' + new URLSearchParams(params) : '')); },
  getTaskBoard() { return this.get('/api/tasks/board'); },
  getTaskStats() { return this.get('/api/tasks/stats'); },
  createTask(data) { return this.post('/api/tasks', data); },
  updateTask(id, data) { return this.put('/api/tasks/' + id, data); },
  moveTask(id, status) { return this.post('/api/tasks/' + id + '/move', { status }); },
  assignTask(id, assignee, assigneeType) { return this.post('/api/tasks/' + id + '/assign', { assignee, assigneeType }); },
  addTaskComment(id, content) { return this.post('/api/tasks/' + id + '/comments', { content }); },
  getTaskComments(id) { return this.get('/api/tasks/' + id + '/comments'); },

  // Webhooks
  getWebhooks() { return this.get('/api/webhooks'); },
  createWebhook(data) { return this.post('/api/webhooks', data); },
  updateWebhook(id, data) { return this.put('/api/webhooks/' + id, data); },
  deleteWebhook(id) { return this.del('/api/webhooks/' + id); },
  testWebhook(id) { return this.post('/api/webhooks/' + id + '/test'); },
  getWebhookDeliveries(id) { return this.get('/api/webhooks/' + id + '/deliveries'); },
  retryDelivery(whId, delId) { return this.post('/api/webhooks/' + whId + '/deliveries/' + delId + '/retry'); },

  // Claude Code
  discoverClaude() { return this.get('/api/claude/discover'); },
  getClaudeProjects() { return this.get('/api/claude/projects'); },
  getClaudeProject(id) { return this.get('/api/claude/projects/' + id); },
  getClaudeMemory(id) { return this.get('/api/claude/projects/' + id + '/memory'); },
  getClaudeSessions(id) { return this.get('/api/claude/projects/' + id + '/sessions'); },
  getClaudeRecent() { return this.get('/api/claude/recent'); },
  getClaudeStats() { return this.get('/api/claude/stats'); },

  // Skills Hub
  getSkillsHub(params) { return this.get('/api/skills-hub' + (params ? '?' + new URLSearchParams(params) : '')); },
  getSkillsHubStats() { return this.get('/api/skills-hub/stats'); },
  getSkillsHubCategories() { return this.get('/api/skills-hub/categories'); },
  installSkill(id) { return this.post('/api/skills-hub/' + id + '/install'); },
  uninstallSkill(id) { return this.post('/api/skills-hub/' + id + '/uninstall'); },
  scanSkill(id) { return this.post('/api/skills-hub/' + id + '/scan'); },
  searchSkillsHub(q) { return this.get('/api/skills-hub/search?q=' + encodeURIComponent(q)); },

  // Evaluations
  getEvaluations(params) { return this.get('/api/evaluations' + (params ? '?' + new URLSearchParams(params) : '')); },
  getFleetScorecard() { return this.get('/api/evaluations/fleet/scorecard'); },
  getAgentScorecard(id) { return this.get('/api/evaluations/agent/' + id + '/scorecard'); },
  getAgentOptimize(id) { return this.get('/api/evaluations/agent/' + id + '/optimize'); },
  getQualityGates() { return this.get('/api/quality-gates'); },
  evaluateAgent(id) { return this.post('/api/evaluations/agent/' + id + '/evaluate'); },

  // Scheduler
  getSchedulerJobs(params) { return this.get('/api/scheduler/jobs' + (params ? '?' + new URLSearchParams(params) : '')); },
  createSchedulerJob(data) { return this.post('/api/scheduler/jobs', data); },
  updateSchedulerJob(id, data) { return this.put('/api/scheduler/jobs/' + id, data); },
  deleteSchedulerJob(id) { return this.del('/api/scheduler/jobs/' + id); },
  runSchedulerJob(id) { return this.post('/api/scheduler/jobs/' + id + '/run'); },
  pauseSchedulerJob(id) { return this.post('/api/scheduler/jobs/' + id + '/pause'); },
  resumeSchedulerJob(id) { return this.post('/api/scheduler/jobs/' + id + '/resume'); },
  getSchedulerHistory(id) { return this.get('/api/scheduler/jobs/' + id + '/history'); },
  parseSchedule(expression) { return this.post('/api/scheduler/parse', { expression }); },

  // Security
  getSecurityProfile() { return this.get('/api/security/profile'); },
  setSecurityProfile(profileId) { return this.put('/api/security/profile', { profileId }); },
  getSecurityProfiles() { return this.get('/api/security/profiles'); },
  getSecurityEvents(params) { return this.get('/api/security/events' + (params ? '?' + new URLSearchParams(params) : '')); },
  getSecurityStats() { return this.get('/api/security/stats'); },
  scanSecrets(text) { return this.post('/api/security/scan', { text }); },

  // Users (admin)
  getUsers() { return this.get('/api/users'); },
  createUser(data) { return this.post('/api/users', data); },
  deleteUser(id) { return this.del('/api/users/' + id); },
  setUserRole(id, role) { return this.post('/api/users/' + id + '/role', { role }); },
  createApiKey(userId) { return this.post('/api/users/' + userId + '/api-keys'); },
  listApiKeys(userId) { return this.get('/api/users/' + userId + '/api-keys'); },
  revokeApiKey(userId, prefix) { return this.del('/api/users/' + userId + '/api-keys/' + prefix); },

  // Projects
  getProjects(params) { return this.get('/api/projects' + (params ? '?' + new URLSearchParams(params) : '')); },
  createProject(data) { return this.post('/api/projects', data); },
  updateProject(id, data) { return this.put('/api/projects/' + id, data); },
  deleteProject(id) { return this.del('/api/projects/' + id); },

  // System config
  getSystemConfig() { return this.get('/api/system/config'); },
  importSystemConfig(data) { return this.post('/api/system/config/import', data); },
  validateSystemConfig(data) { return this.post('/api/system/config/validate', data); },

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
