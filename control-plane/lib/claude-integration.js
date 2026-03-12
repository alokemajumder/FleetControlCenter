'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Fields that look like secrets/tokens and should be redacted from settings
const SENSITIVE_KEYS = new Set([
  'token', 'secret', 'password', 'apiKey', 'api_key', 'apiSecret',
  'api_secret', 'credential', 'credentials', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'privateKey', 'private_key',
  'authorization', 'auth_token', 'authToken', 'sessionToken', 'session_token'
]);

// Validate that an id segment is safe (no path traversal)
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function isSafeId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 256 && SAFE_ID_RE.test(id);
}

function redactObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactObject(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

function createClaudeIntegration(opts = {}) {
  const claudeDir = opts.claudeDir || path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');

  let watcher = null;
  let watchTimeout = null;

  function discover() {
    try {
      const exists = fs.existsSync(claudeDir);
      if (!exists) {
        return { installed: false, version: null, configPath: claudeDir, projectCount: 0 };
      }
      // Try to read version from settings or package info
      let version = null;
      try {
        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
        version = settings.version || settings.cliVersion || null;
      } catch { /* no settings */ }

      let projectCount = 0;
      try {
        const entries = fs.readdirSync(projectsDir);
        projectCount = entries.filter(e => {
          try { return fs.statSync(path.join(projectsDir, e)).isDirectory(); } catch { return false; }
        }).length;
      } catch { /* no projects dir */ }

      return { installed: true, version, configPath: claudeDir, projectCount };
    } catch {
      return { installed: false, version: null, configPath: claudeDir, projectCount: 0 };
    }
  }

  function getSettings() {
    try {
      const settingsPath = path.join(claudeDir, 'settings.json');
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return redactObject(raw);
    } catch {
      return null;
    }
  }

  function getProjects() {
    try {
      const entries = fs.readdirSync(projectsDir);
      const projects = [];
      for (const entry of entries) {
        const entryPath = path.join(projectsDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (!stat.isDirectory()) continue;
        } catch { continue; }

        const hasClaudeMd = fs.existsSync(path.join(entryPath, 'CLAUDE.md'));
        const hasMemory = fs.existsSync(path.join(entryPath, 'memory', 'MEMORY.md'));

        // Count JSONL session files
        let sessionCount = 0;
        let lastActivity = null;
        try {
          const files = fs.readdirSync(entryPath);
          for (const f of files) {
            if (f.endsWith('.jsonl')) {
              sessionCount++;
              try {
                const fstat = fs.statSync(path.join(entryPath, f));
                if (!lastActivity || fstat.mtimeMs > lastActivity) {
                  lastActivity = fstat.mtimeMs;
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }

        projects.push({
          id: entry,
          path: entryPath,
          hasClaudeMd,
          hasMemory,
          sessionCount,
          lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null
        });
      }
      return projects;
    } catch {
      return [];
    }
  }

  function getProjectDetail(projectId) {
    if (!isSafeId(projectId)) return null;
    const projPath = path.join(projectsDir, projectId);
    try {
      if (!fs.existsSync(projPath) || !fs.statSync(projPath).isDirectory()) return null;
    } catch { return null; }

    let claudeMd = null;
    try { claudeMd = fs.readFileSync(path.join(projPath, 'CLAUDE.md'), 'utf8'); } catch { /* missing */ }

    let memory = null;
    try { memory = fs.readFileSync(path.join(projPath, 'memory', 'MEMORY.md'), 'utf8'); } catch { /* missing */ }

    let sessionCount = 0;
    try {
      const files = fs.readdirSync(projPath);
      sessionCount = files.filter(f => f.endsWith('.jsonl')).length;
    } catch { /* skip */ }

    return { id: projectId, path: projPath, claudeMd, memory, sessionCount };
  }

  function getProjectMemory(projectId) {
    if (!isSafeId(projectId)) return null;
    const memPath = path.join(projectsDir, projectId, 'memory', 'MEMORY.md');
    try {
      return fs.readFileSync(memPath, 'utf8');
    } catch {
      return null;
    }
  }

  function getSessions(projectId, opts = {}) {
    if (!isSafeId(projectId)) return [];
    const projPath = path.join(projectsDir, projectId);
    try {
      const files = fs.readdirSync(projPath);
      const sessions = [];
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const filePath = path.join(projPath, f);
        try {
          const stat = fs.statSync(filePath);
          const id = path.basename(f, '.jsonl');
          sessions.push({
            id,
            filename: f,
            sizeBytes: stat.size,
            lastModified: stat.mtime.toISOString()
          });
        } catch { /* skip */ }
      }
      // Sort by lastModified descending
      sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      const limit = opts.limit || 100;
      const offset = opts.offset || 0;
      return sessions.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }

  function getSessionSummary(projectId, sessionId) {
    if (!isSafeId(projectId) || !isSafeId(sessionId)) return null;
    const filePath = path.join(projectsDir, projectId, sessionId + '.jsonl');
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      let messageCount = 0;
      let toolUseCount = 0;
      const models = new Set();
      let startTime = null;
      let endTime = null;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          messageCount++;
          if (entry.model) models.add(entry.model);
          if (entry.type === 'tool_use' || entry.tool_use || entry.toolUse) toolUseCount++;
          const ts = entry.timestamp || entry.ts || entry.createdAt;
          if (ts) {
            if (!startTime || ts < startTime) startTime = ts;
            if (!endTime || ts > endTime) endTime = ts;
          }
        } catch { /* skip malformed lines */ }
      }

      let duration = null;
      if (startTime && endTime) {
        const s = new Date(startTime).getTime();
        const e = new Date(endTime).getTime();
        if (!isNaN(s) && !isNaN(e)) duration = e - s;
      }

      return {
        messageCount,
        toolUseCount,
        duration,
        models: Array.from(models),
        startTime,
        endTime
      };
    } catch {
      return null;
    }
  }

  function getRecentActivity(limit = 20) {
    const projects = getProjects();
    const allSessions = [];
    for (const proj of projects) {
      const sessions = getSessions(proj.id, { limit: 50 });
      for (const s of sessions) {
        allSessions.push({ ...s, projectId: proj.id });
      }
    }
    allSessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    return allSessions.slice(0, limit);
  }

  function getStats() {
    const projects = getProjects();
    let totalSessions = 0;
    let totalSizeBytes = 0;
    let oldestSession = null;
    let newestSession = null;

    for (const proj of projects) {
      const sessions = getSessions(proj.id, { limit: 10000 });
      totalSessions += sessions.length;
      for (const s of sessions) {
        totalSizeBytes += s.sizeBytes;
        if (!oldestSession || s.lastModified < oldestSession) oldestSession = s.lastModified;
        if (!newestSession || s.lastModified > newestSession) newestSession = s.lastModified;
      }
    }

    return {
      totalProjects: projects.length,
      totalSessions,
      totalSizeBytes,
      oldestSession,
      newestSession
    };
  }

  function watchForChanges(callback) {
    if (watcher) return; // already watching
    try {
      watcher = fs.watch(projectsDir, { recursive: true }, (eventType, filename) => {
        // Debounce: only fire callback after 5s of quiet
        if (watchTimeout) clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
          try { callback({ eventType, filename }); } catch { /* ignore callback errors */ }
        }, 5000);
      });
      watcher.on('error', () => { /* ignore watch errors */ });
    } catch { /* dir may not exist */ }
  }

  function stopWatching() {
    if (watchTimeout) {
      clearTimeout(watchTimeout);
      watchTimeout = null;
    }
    if (watcher) {
      try { watcher.close(); } catch { /* ignore */ }
      watcher = null;
    }
  }

  return {
    discover,
    getSettings,
    getProjects,
    getProjectDetail,
    getProjectMemory,
    getSessions,
    getSessionSummary,
    getRecentActivity,
    getStats,
    watchForChanges,
    stopWatching
  };
}

module.exports = { createClaudeIntegration };
