'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { createTenantManager } = require('../../control-plane/lib/tenants');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), 'clawcc-tenant-test-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Tenant Manager - Create and Get', () => {
  it('should create a tenant and retrieve it', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'Acme Corp', slug: 'acme-corp' });
    assert.ok(tenant.id);
    assert.equal(tenant.name, 'Acme Corp');
    assert.equal(tenant.slug, 'acme-corp');
    assert.equal(tenant.status, 'active');
    const got = tm.getTenant(tenant.id);
    assert.equal(got.name, 'Acme Corp');
  });

  it('should get tenant by slug', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'Test', slug: 'test-org' });
    const got = tm.getTenantBySlug('test-org');
    assert.equal(got.id, tenant.id);
  });

  it('should return null for non-existent tenant', () => {
    const tm = createTenantManager();
    assert.equal(tm.getTenant('no-such-id'), null);
    assert.equal(tm.getTenantBySlug('no-such-slug'), null);
  });
});

describe('Tenant Manager - List and Update', () => {
  it('should list tenants with status filter', () => {
    const tm = createTenantManager();
    tm.createTenant({ name: 'A', slug: 'a' });
    const t2 = tm.createTenant({ name: 'B', slug: 'b' });
    tm.suspendTenant(t2.id);
    const active = tm.listTenants({ status: 'active' });
    assert.equal(active.length, 1);
    assert.equal(active[0].slug, 'a');
  });

  it('should update tenant fields', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'Old', slug: 'old' });
    const updated = tm.updateTenant(tenant.id, { name: 'New' });
    assert.equal(updated.name, 'New');
    assert.equal(updated.slug, 'old'); // unchanged
    assert.ok(updated.updatedAt >= tenant.updatedAt);
  });

  it('should throw when updating non-existent tenant', () => {
    const tm = createTenantManager();
    assert.throws(() => tm.updateTenant('nope', { name: 'x' }), /not found/);
  });
});

describe('Tenant Manager - Slug validation and uniqueness', () => {
  it('should reject invalid slugs', () => {
    const tm = createTenantManager();
    assert.throws(() => tm.createTenant({ name: 'T', slug: '-bad' }), /alphanumeric/);
    assert.throws(() => tm.createTenant({ name: 'T', slug: 'BAD SLUG' }), /alphanumeric/);
    assert.throws(() => tm.createTenant({ name: 'T', slug: '' }), /required/);
  });

  it('should reject duplicate slugs', () => {
    const tm = createTenantManager();
    tm.createTenant({ name: 'A', slug: 'unique' });
    assert.throws(() => tm.createTenant({ name: 'B', slug: 'unique' }), /already in use/);
  });

  it('should allow single character slug', () => {
    const tm = createTenantManager();
    const t = tm.createTenant({ name: 'X', slug: 'x' });
    assert.equal(t.slug, 'x');
  });
});

describe('Tenant Manager - Status transitions', () => {
  it('should suspend a tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'sus' });
    const suspended = tm.suspendTenant(tenant.id);
    assert.equal(suspended.status, 'suspended');
  });

  it('should activate a suspended tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'act' });
    tm.suspendTenant(tenant.id);
    const activated = tm.activateTenant(tenant.id);
    assert.equal(activated.status, 'active');
  });

  it('should archive a tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'arc' });
    const archived = tm.archiveTenant(tenant.id);
    assert.equal(archived.status, 'archived');
  });

  it('should throw when suspending non-existent tenant', () => {
    const tm = createTenantManager();
    assert.throws(() => tm.suspendTenant('nope'), /not found/);
  });
});

describe('Tenant Manager - Delete', () => {
  it('should delete a tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'del' });
    assert.ok(tm.deleteTenant(tenant.id));
    assert.equal(tm.getTenant(tenant.id), null);
    assert.equal(tm.getTenantBySlug('del'), null);
  });

  it('should return false for non-existent delete', () => {
    const tm = createTenantManager();
    assert.equal(tm.deleteTenant('nope'), false);
  });
});

describe('Tenant Manager - Quota checking', () => {
  it('should allow quota for active tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'quota' });
    const result = tm.checkQuota(tenant.id, 'node');
    assert.equal(result.allowed, true);
  });

  it('should deny quota for suspended tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'quotas' });
    tm.suspendTenant(tenant.id);
    const result = tm.checkQuota(tenant.id, 'node');
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('suspended'));
  });

  it('should throw for non-existent tenant quota check', () => {
    const tm = createTenantManager();
    assert.throws(() => tm.checkQuota('nope', 'node'), /not found/);
  });
});

describe('Tenant Manager - Scoped data directory', () => {
  it('should return tenant-specific data dir', () => {
    const tm = createTenantManager({ dataDir: '/data' });
    const tenant = tm.createTenant({ name: 'T', slug: 'scoped' });
    const dir = tm.getScopedDataDir(tenant.id);
    assert.ok(dir.includes(tenant.id));
    assert.ok(dir.startsWith('/data/tenants/'));
  });

  it('should return null when no dataDir', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'nodir' });
    assert.equal(tm.getScopedDataDir(tenant.id), null);
  });
});

describe('Tenant Manager - Stats', () => {
  it('should return stats for a tenant', () => {
    const tm = createTenantManager();
    const tenant = tm.createTenant({ name: 'T', slug: 'stats' });
    const stats = tm.getTenantStats(tenant.id);
    assert.equal(typeof stats.nodeCount, 'number');
    assert.equal(typeof stats.storageUsed, 'number');
  });

  it('should throw for non-existent tenant stats', () => {
    const tm = createTenantManager();
    assert.throws(() => tm.getTenantStats('nope'), /not found/);
  });
});

describe('Tenant Manager - Persistence', () => {
  let tmpDir;
  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should save and load tenants from disk', () => {
    tmpDir = makeTmpDir();
    const tm1 = createTenantManager({ dataDir: tmpDir });
    tm1.createTenant({ name: 'Persisted', slug: 'persist' });

    const tm2 = createTenantManager({ dataDir: tmpDir });
    const all = tm2.listTenants();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, 'Persisted');
    assert.ok(tm2.getTenantBySlug('persist'));
  });
});
