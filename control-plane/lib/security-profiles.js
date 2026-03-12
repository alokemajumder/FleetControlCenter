'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BUILT_IN_IDS = new Set(['minimal', 'standard', 'strict']);

const BUILT_IN_PROFILES = {
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    description: 'Log everything, alert nothing. Good for development.',
    rules: {
      authFailureAction: 'log',
      rateLimitAction: 'log',
      injectionAttemptAction: 'log',
      secretLeakAction: 'log',
      suspiciousPatternAction: 'log',
      maxAuthFailuresPerHour: 100,
      maxRateLimitHitsPerMinute: 100,
      blockDurationMs: 0,
      alertCooldownMs: 0,
      autoQuarantineOnInjection: false
    }
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'Log + alert on high-severity events.',
    rules: {
      authFailureAction: 'log+alert',
      rateLimitAction: 'log+throttle',
      injectionAttemptAction: 'log+alert',
      secretLeakAction: 'log+alert',
      suspiciousPatternAction: 'log',
      maxAuthFailuresPerHour: 20,
      maxRateLimitHitsPerMinute: 30,
      blockDurationMs: 300000,
      alertCooldownMs: 60000,
      autoQuarantineOnInjection: false
    }
  },
  strict: {
    id: 'strict',
    name: 'Strict',
    description: 'Log + alert + block/quarantine on all events.',
    rules: {
      authFailureAction: 'log+alert+block',
      rateLimitAction: 'log+throttle+block',
      injectionAttemptAction: 'log+alert+quarantine',
      secretLeakAction: 'log+alert+block',
      suspiciousPatternAction: 'log+alert+block',
      maxAuthFailuresPerHour: 5,
      maxRateLimitHitsPerMinute: 10,
      blockDurationMs: 3600000,
      alertCooldownMs: 30000,
      autoQuarantineOnInjection: true
    }
  }
};

const EVENT_TYPE_TO_RULE = {
  'auth.failure': 'authFailureAction',
  'rate.limit': 'rateLimitAction',
  'injection.attempt': 'injectionAttemptAction',
  'secret.leak': 'secretLeakAction',
  'suspicious.pattern': 'suspiciousPatternAction'
};

const MAX_SECURITY_EVENTS = 10000;

function createSecurityProfileManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const securityDir = dataDir ? path.join(dataDir, 'security') : null;
  const profilePath = securityDir ? path.join(securityDir, 'profile.json') : null;
  const eventsPath = securityDir ? path.join(securityDir, 'events.jsonl') : null;

  let activeProfileId = 'standard';
  const customProfiles = new Map();
  const securityEvents = [];

  // Load persisted state
  if (profilePath) {
    try {
      const data = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (data.activeProfileId) activeProfileId = data.activeProfileId;
      if (data.customProfiles) {
        for (const p of data.customProfiles) {
          customProfiles.set(p.id, p);
        }
      }
    } catch { /* no persisted state yet */ }
  }

  // Load persisted events
  if (eventsPath) {
    try {
      const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
      // Only load last MAX_SECURITY_EVENTS
      const start = Math.max(0, lines.length - MAX_SECURITY_EVENTS);
      for (let i = start; i < lines.length; i++) {
        try { securityEvents.push(JSON.parse(lines[i])); } catch { /* skip bad lines */ }
      }
    } catch { /* no events file yet */ }
  }

  function persist() {
    if (!profilePath) return;
    try {
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      const data = {
        activeProfileId,
        customProfiles: [...customProfiles.values()]
      };
      fs.writeFileSync(profilePath, JSON.stringify(data, null, 2));
    } catch { /* ignore write errors */ }
  }

  function appendEvent(event) {
    if (!eventsPath) return;
    try {
      fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
      fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
    } catch { /* ignore write errors */ }
  }

  function getProfile(id) {
    if (BUILT_IN_IDS.has(id)) return { ...BUILT_IN_PROFILES[id], rules: { ...BUILT_IN_PROFILES[id].rules } };
    const custom = customProfiles.get(id);
    if (custom) return { ...custom, rules: { ...custom.rules } };
    return null;
  }

  function getActiveProfile() {
    return getProfile(activeProfileId) || getProfile('standard');
  }

  function setActiveProfile(profileId) {
    if (!getProfile(profileId)) throw new Error('Profile not found: ' + profileId);
    activeProfileId = profileId;
    persist();
    return getActiveProfile();
  }

  function listProfiles() {
    const all = [];
    for (const id of BUILT_IN_IDS) {
      const p = getProfile(id);
      p.builtIn = true;
      p.active = id === activeProfileId;
      all.push(p);
    }
    for (const [id, p] of customProfiles) {
      all.push({ ...p, rules: { ...p.rules }, builtIn: false, active: id === activeProfileId });
    }
    return all;
  }

  function createCustomProfile(data) {
    if (!data || !data.id || !data.name || !data.rules) {
      throw new Error('Profile must have id, name, and rules');
    }
    if (BUILT_IN_IDS.has(data.id)) {
      throw new Error('Cannot create profile with built-in ID: ' + data.id);
    }
    if (customProfiles.has(data.id)) {
      throw new Error('Profile already exists: ' + data.id);
    }
    const profile = {
      id: data.id,
      name: data.name,
      description: data.description || '',
      rules: { ...BUILT_IN_PROFILES.standard.rules, ...data.rules }
    };
    customProfiles.set(profile.id, profile);
    persist();
    return { ...profile, rules: { ...profile.rules } };
  }

  function updateCustomProfile(id, updates) {
    if (BUILT_IN_IDS.has(id)) {
      throw new Error('Cannot modify built-in profile: ' + id);
    }
    const existing = customProfiles.get(id);
    if (!existing) throw new Error('Profile not found: ' + id);
    if (updates.name) existing.name = updates.name;
    if (updates.description !== undefined) existing.description = updates.description;
    if (updates.rules) existing.rules = { ...existing.rules, ...updates.rules };
    customProfiles.set(id, existing);
    persist();
    return { ...existing, rules: { ...existing.rules } };
  }

  function deleteCustomProfile(id) {
    if (BUILT_IN_IDS.has(id)) {
      throw new Error('Cannot delete built-in profile: ' + id);
    }
    if (!customProfiles.has(id)) throw new Error('Profile not found: ' + id);
    customProfiles.delete(id);
    if (activeProfileId === id) activeProfileId = 'standard';
    persist();
    return true;
  }

  function evaluateEvent(eventType, context = {}) {
    const profile = getActiveProfile();
    const ruleKey = EVENT_TYPE_TO_RULE[eventType];
    if (!ruleKey) {
      return { action: 'log', details: { reason: 'Unknown event type', eventType } };
    }

    const actionStr = profile.rules[ruleKey];
    const actions = actionStr.split('+');
    // Determine the highest-severity action
    let action = 'log';
    if (actions.includes('quarantine')) action = 'quarantine';
    else if (actions.includes('block')) action = 'block';
    else if (actions.includes('throttle')) action = 'throttle';
    else if (actions.includes('alert')) action = 'alert';

    const details = {
      profile: profile.id,
      rule: ruleKey,
      rawAction: actionStr,
      eventType,
      blockDurationMs: profile.rules.blockDurationMs,
      autoQuarantineOnInjection: profile.rules.autoQuarantineOnInjection
    };

    // Check thresholds for auth failures
    if (eventType === 'auth.failure' && context.failureCount !== undefined) {
      if (context.failureCount >= profile.rules.maxAuthFailuresPerHour) {
        action = 'block';
        details.thresholdExceeded = true;
        details.maxAuthFailuresPerHour = profile.rules.maxAuthFailuresPerHour;
      }
    }

    // Check thresholds for rate limit
    if (eventType === 'rate.limit' && context.hitCount !== undefined) {
      if (context.hitCount >= profile.rules.maxRateLimitHitsPerMinute) {
        action = 'block';
        details.thresholdExceeded = true;
        details.maxRateLimitHitsPerMinute = profile.rules.maxRateLimitHitsPerMinute;
      }
    }

    // Injection with auto-quarantine
    if (eventType === 'injection.attempt' && profile.rules.autoQuarantineOnInjection) {
      action = 'quarantine';
      details.autoQuarantineOnInjection = true;
    }

    return { action, details };
  }

  function recordSecurityEvent(event) {
    const record = {
      id: crypto.randomUUID(),
      type: event.type,
      action: event.action || 'log',
      timestamp: event.timestamp || new Date().toISOString(),
      details: event.details || {},
      source: event.source || 'system'
    };
    securityEvents.push(record);
    // Cap in-memory events
    while (securityEvents.length > MAX_SECURITY_EVENTS) {
      securityEvents.shift();
    }
    appendEvent(record);
    return record;
  }

  function getSecurityEvents(filters = {}) {
    let result = [...securityEvents];
    if (filters.type) {
      result = result.filter(e => e.type === filters.type);
    }
    if (filters.action) {
      result = result.filter(e => e.action === filters.action);
    }
    if (filters.since) {
      const since = new Date(filters.since).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= since);
    }
    const limit = filters.limit ? Math.min(Math.max(1, filters.limit), MAX_SECURITY_EVENTS) : 100;
    return result.slice(-limit);
  }

  function getSecurityStats() {
    const byType = {};
    const byAction = {};
    for (const e of securityEvents) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      byAction[e.action] = (byAction[e.action] || 0) + 1;
    }

    // Recent trend: events in last hour vs previous hour
    const now = Date.now();
    const lastHour = securityEvents.filter(e => now - new Date(e.timestamp).getTime() < 3600000).length;
    const prevHour = securityEvents.filter(e => {
      const age = now - new Date(e.timestamp).getTime();
      return age >= 3600000 && age < 7200000;
    }).length;

    return {
      totalEvents: securityEvents.length,
      byType,
      byAction,
      activeProfile: activeProfileId,
      recentTrend: { lastHour, prevHour, direction: lastHour > prevHour ? 'up' : lastHour < prevHour ? 'down' : 'stable' }
    };
  }

  return {
    getActiveProfile,
    setActiveProfile,
    getProfile,
    listProfiles,
    createCustomProfile,
    updateCustomProfile,
    deleteCustomProfile,
    evaluateEvent,
    recordSecurityEvent,
    getSecurityEvents,
    getSecurityStats
  };
}

module.exports = { createSecurityProfileManager, BUILT_IN_PROFILES, BUILT_IN_IDS };
