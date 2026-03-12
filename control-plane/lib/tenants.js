'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const VALID_STATUSES = ['active', 'suspended', 'archived'];

function createTenantManager(opts = {}) {
  const dataDir = opts.dataDir || null;
  const tenants = new Map();     // id -> Tenant
  const slugIndex = new Map();   // slug -> id

  // Load persisted tenants from disk
  if (dataDir) {
    const tenantsPath = path.join(dataDir, 'tenants', 'tenants.json');
    try {
      const raw = JSON.parse(fs.readFileSync(tenantsPath, 'utf8'));
      if (Array.isArray(raw)) {
        for (const t of raw) {
          if (t && t.id) {
            tenants.set(t.id, t);
            if (t.slug) slugIndex.set(t.slug, t.id);
          }
        }
      }
    } catch { /* no persisted tenants yet */ }
  }

  function _persist() {
    if (!dataDir) return;
    const dir = path.join(dataDir, 'tenants');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    const tenantsPath = path.join(dir, 'tenants.json');
    const tmpPath = tenantsPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify([...tenants.values()], null, 2));
      fs.renameSync(tmpPath, tenantsPath);
    } catch { /* ignore write errors */ }
  }

  function _validateSlug(slug) {
    if (!slug || typeof slug !== 'string') throw new Error('Slug is required');
    if (slug.length < 1 || slug.length > 63) throw new Error('Slug must be 1-63 characters');
    if (!SLUG_PATTERN.test(slug)) throw new Error('Slug must be alphanumeric with dashes, cannot start or end with dash');
    return true;
  }

  function createTenant(data) {
    if (!data || !data.name) throw new Error('Tenant name is required');
    if (!data.slug) throw new Error('Tenant slug is required');
    _validateSlug(data.slug);
    if (slugIndex.has(data.slug)) throw new Error('Slug already in use');

    const now = Date.now();
    const tenant = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      slug: data.slug,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      config: {
        maxNodes: (data.config && data.config.maxNodes) || 10,
        maxSessions: (data.config && data.config.maxSessions) || 1000,
        maxEventsPerDay: (data.config && data.config.maxEventsPerDay) || 10000,
        features: (data.config && data.config.features) || []
      },
      metadata: data.metadata || {},
      owner: data.owner || null
    };

    tenants.set(tenant.id, tenant);
    slugIndex.set(tenant.slug, tenant.id);

    // Create tenant-specific data directory
    if (dataDir) {
      const tenantDir = path.join(dataDir, 'tenants', tenant.id);
      try { fs.mkdirSync(tenantDir, { recursive: true }); } catch { /* exists */ }
    }

    _persist();
    return tenant;
  }

  function getTenant(id) {
    return tenants.get(id) || null;
  }

  function getTenantBySlug(slug) {
    const id = slugIndex.get(slug);
    if (!id) return null;
    return tenants.get(id) || null;
  }

  function listTenants(filters = {}) {
    let result = [...tenants.values()];
    if (filters.status) result = result.filter(t => t.status === filters.status);
    if (filters.owner) result = result.filter(t => t.owner === filters.owner);
    return result;
  }

  function updateTenant(id, updates) {
    const tenant = tenants.get(id);
    if (!tenant) throw new Error('Tenant not found');

    // If slug is changing, validate and update slug index
    if (updates.slug && updates.slug !== tenant.slug) {
      _validateSlug(updates.slug);
      if (slugIndex.has(updates.slug)) throw new Error('Slug already in use');
      slugIndex.delete(tenant.slug);
      slugIndex.set(updates.slug, id);
    }

    const updated = {
      ...tenant,
      ...updates,
      id: tenant.id,         // prevent id change
      createdAt: tenant.createdAt,  // prevent createdAt change
      updatedAt: Date.now()
    };

    // Merge config if provided
    if (updates.config) {
      updated.config = { ...tenant.config, ...updates.config };
    }

    tenants.set(id, updated);
    _persist();
    return updated;
  }

  function suspendTenant(id) {
    const tenant = tenants.get(id);
    if (!tenant) throw new Error('Tenant not found');
    tenant.status = 'suspended';
    tenant.updatedAt = Date.now();
    _persist();
    return tenant;
  }

  function activateTenant(id) {
    const tenant = tenants.get(id);
    if (!tenant) throw new Error('Tenant not found');
    tenant.status = 'active';
    tenant.updatedAt = Date.now();
    _persist();
    return tenant;
  }

  function archiveTenant(id) {
    const tenant = tenants.get(id);
    if (!tenant) throw new Error('Tenant not found');
    tenant.status = 'archived';
    tenant.updatedAt = Date.now();
    _persist();
    return tenant;
  }

  function deleteTenant(id) {
    const tenant = tenants.get(id);
    if (!tenant) return false;
    slugIndex.delete(tenant.slug);
    tenants.delete(id);
    _persist();
    return true;
  }

  function getTenantStats(id) {
    const tenant = tenants.get(id);
    if (!tenant) throw new Error('Tenant not found');

    let storageUsed = 0;
    if (dataDir) {
      const tenantDir = path.join(dataDir, 'tenants', id);
      try {
        const files = fs.readdirSync(tenantDir);
        for (const f of files) {
          try {
            const stat = fs.statSync(path.join(tenantDir, f));
            storageUsed += stat.size;
          } catch { /* skip */ }
        }
      } catch { /* dir doesn't exist */ }
    }

    return {
      nodeCount: 0,      // placeholder — would be populated from tenant-scoped event store
      sessionCount: 0,
      eventCount: 0,
      storageUsed
    };
  }

  function checkQuota(tenantId, resource) {
    const tenant = tenants.get(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    if (tenant.status === 'suspended') return { allowed: false, reason: 'Tenant is suspended' };
    if (tenant.status === 'archived') return { allowed: false, reason: 'Tenant is archived' };

    const limits = tenant.config || {};
    const stats = getTenantStats(tenantId);

    if (resource === 'node' && stats.nodeCount >= (limits.maxNodes || 10)) {
      return { allowed: false, reason: 'Node limit reached', current: stats.nodeCount, limit: limits.maxNodes || 10 };
    }
    if (resource === 'session' && stats.sessionCount >= (limits.maxSessions || 1000)) {
      return { allowed: false, reason: 'Session limit reached', current: stats.sessionCount, limit: limits.maxSessions || 1000 };
    }
    if (resource === 'event' && stats.eventCount >= (limits.maxEventsPerDay || 10000)) {
      return { allowed: false, reason: 'Daily event limit reached', current: stats.eventCount, limit: limits.maxEventsPerDay || 10000 };
    }

    return { allowed: true };
  }

  function getScopedDataDir(tenantId) {
    if (!dataDir) return null;
    return path.join(dataDir, 'tenants', tenantId);
  }

  return {
    createTenant,
    getTenant,
    getTenantBySlug,
    listTenants,
    updateTenant,
    suspendTenant,
    activateTenant,
    archiveTenant,
    deleteTenant,
    getTenantStats,
    checkQuota,
    getScopedDataDir
  };
}

module.exports = { createTenantManager };
