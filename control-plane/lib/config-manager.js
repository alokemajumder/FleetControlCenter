'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Secret field names that should be redacted on export
const SECRET_FIELDS = new Set([
  'sessionSecret', 'defaultAdminPassword', 'password', 'secret',
  'apiKey', 'token', 'privateKey', 'httpsKeyPath', 'httpsCertPath'
]);

const CONFIG_SCHEMA = {
  host: { type: 'string', default: '0.0.0.0', description: 'Bind address' },
  port: { type: 'number', default: 3400, description: 'Listen port (1-65535)' },
  mode: { type: 'string', default: 'local', description: 'Run mode: local, production' },
  dataDir: { type: 'string', default: './data', description: 'Data directory path' },
  httpsEnabled: { type: 'boolean', default: false, description: 'Enable HTTPS' },
  httpsKeyPath: { type: 'string', default: '', description: 'Path to TLS private key' },
  httpsCertPath: { type: 'string', default: '', description: 'Path to TLS certificate' },
  sessionSecret: { type: 'string', default: '', description: 'Session signing secret' },
  auth: {
    type: 'object', description: 'Authentication settings', default: {},
    properties: {
      lockoutAttempts: { type: 'number', default: 5, description: 'Failed login attempts before lockout' },
      lockoutDurationMs: { type: 'number', default: 900000, description: 'Lockout duration in ms' },
      sessionTtlMs: { type: 'number', default: 86400000, description: 'Session TTL in ms' },
      stepUpWindowMs: { type: 'number', default: 300000, description: 'Step-up auth window in ms' },
      defaultAdminPassword: { type: 'string', default: 'changeme', description: 'Default admin password' }
    }
  },
  cors: {
    type: 'object', description: 'CORS settings', default: {},
    properties: {
      origins: { type: 'array', default: [], description: 'Allowed CORS origins' }
    }
  },
  security: {
    type: 'object', description: 'Security settings', default: {},
    properties: {
      rateLimitWindowMs: { type: 'number', default: 60000, description: 'Rate limit window in ms' },
      rateLimitMaxRequests: { type: 'number', default: 100, description: 'Max requests per window' },
      requestTimeoutMs: { type: 'number', default: 30000, description: 'Request timeout in ms' }
    }
  },
  fleet: {
    type: 'object', description: 'Fleet settings', default: {},
    properties: {
      heartbeatTimeoutMs: { type: 'number', default: 60000, description: 'Node heartbeat timeout' },
      signatureMaxAge: { type: 'number', default: 300000, description: 'Signature max age in ms' }
    }
  },
  events: {
    type: 'object', description: 'Event store settings', default: {},
    properties: {
      snapshotIntervalMs: { type: 'number', default: 60000, description: 'Snapshot rebuild interval in ms' }
    }
  }
};

function createConfigManager(opts = {}) {
  const currentConfig = opts.config || {};

  function redactSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => redactSecrets(item));

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SECRET_FIELDS.has(key) && value && typeof value === 'string') {
        result[key] = '***';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = redactSecrets(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function exportConfig() {
    return redactSecrets({ ...currentConfig });
  }

  function validateConfig(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Config must be an object'] };
    }

    // Validate port
    if (config.port !== undefined) {
      if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
        errors.push('port must be a number between 1 and 65535');
      }
    }

    // Validate host
    if (config.host !== undefined && typeof config.host !== 'string') {
      errors.push('host must be a string');
    }

    // Validate mode
    if (config.mode !== undefined && typeof config.mode !== 'string') {
      errors.push('mode must be a string');
    }

    // Validate httpsEnabled
    if (config.httpsEnabled !== undefined && typeof config.httpsEnabled !== 'boolean') {
      errors.push('httpsEnabled must be a boolean');
    }

    // If HTTPS enabled, require cert paths
    if (config.httpsEnabled === true) {
      if (!config.httpsKeyPath) errors.push('httpsKeyPath is required when httpsEnabled is true');
      if (!config.httpsCertPath) errors.push('httpsCertPath is required when httpsEnabled is true');
    }

    // Validate auth sub-fields
    if (config.auth && typeof config.auth === 'object') {
      if (config.auth.lockoutAttempts !== undefined && (typeof config.auth.lockoutAttempts !== 'number' || config.auth.lockoutAttempts < 1)) {
        errors.push('auth.lockoutAttempts must be a positive number');
      }
      if (config.auth.sessionTtlMs !== undefined && (typeof config.auth.sessionTtlMs !== 'number' || config.auth.sessionTtlMs < 1000)) {
        errors.push('auth.sessionTtlMs must be at least 1000ms');
      }
    }

    // Validate security sub-fields
    if (config.security && typeof config.security === 'object') {
      if (config.security.rateLimitMaxRequests !== undefined && (typeof config.security.rateLimitMaxRequests !== 'number' || config.security.rateLimitMaxRequests < 1)) {
        errors.push('security.rateLimitMaxRequests must be a positive number');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function importConfig(configData) {
    const validation = validateConfig(configData);
    if (!validation.valid) {
      return { applied: [], warnings: validation.errors };
    }

    const applied = [];
    const warnings = [];

    // Merge top-level fields (skip redacted secrets)
    for (const [key, value] of Object.entries(configData)) {
      if (value === '***') {
        warnings.push('Skipped redacted field: ' + key);
        continue;
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Merge nested objects
        if (!currentConfig[key] || typeof currentConfig[key] !== 'object') {
          currentConfig[key] = {};
        }
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue === '***') {
            warnings.push('Skipped redacted field: ' + key + '.' + subKey);
            continue;
          }
          const oldValue = currentConfig[key][subKey];
          if (oldValue !== subValue) {
            currentConfig[key][subKey] = subValue;
            applied.push({ field: key + '.' + subKey, oldValue, newValue: subValue });
          }
        }
      } else {
        const oldValue = currentConfig[key];
        if (oldValue !== value) {
          currentConfig[key] = value;
          applied.push({ field: key, oldValue, newValue: value });
        }
      }
    }

    return { applied, warnings };
  }

  function getDiff(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') return [];

    const changes = [];

    function compareObjects(oldObj, newObj, prefix) {
      for (const [key, newValue] of Object.entries(newObj)) {
        const fullKey = prefix ? prefix + '.' + key : key;
        const oldValue = oldObj ? oldObj[key] : undefined;

        if (newValue === '***') continue; // skip redacted

        if (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) {
          compareObjects(oldValue || {}, newValue, fullKey);
        } else if (oldValue !== newValue) {
          changes.push({ field: fullKey, oldValue, newValue });
        }
      }
    }

    compareObjects(currentConfig, newConfig, '');
    return changes;
  }

  function getConfigSchema() {
    return CONFIG_SCHEMA;
  }

  function resetToDefaults() {
    const defaults = {};
    function extractDefaults(schema, target) {
      for (const [key, def] of Object.entries(schema)) {
        if (def.type === 'object' && def.properties) {
          target[key] = {};
          extractDefaults(def.properties, target[key]);
        } else if (def.default !== undefined) {
          target[key] = def.default;
        }
      }
    }
    extractDefaults(CONFIG_SCHEMA, defaults);
    return defaults;
  }

  return {
    exportConfig,
    importConfig,
    validateConfig,
    getDiff,
    getConfigSchema,
    resetToDefaults
  };
}

module.exports = { createConfigManager };
