'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN_ROLES, hasAdminRole, isAuthorizedAdmin } = require('../admin-roles');

test('admin roles are limited to the supported least-privilege set', () => {
  assert.deepEqual(ADMIN_ROLES, ['orders', 'catalog', 'finance', 'support']);
  for (const role of ADMIN_ROLES) {
    assert.equal(hasAdminRole({ adminRole: role }, role), true);
    assert.equal(isAuthorizedAdmin({ adminRole: role }), true);
    assert.equal(hasAdminRole({ adminRole: role }, 'finance'), role === 'finance');
  }
  assert.equal(isAuthorizedAdmin({ adminRole: 'superuser' }), false);
  assert.equal(isAuthorizedAdmin({}), false);
  assert.equal(isAuthorizedAdmin(null), false);
});

test('legacy admin claim remains full owner access across all roles', () => {
  const owner = { admin: true };
  assert.equal(isAuthorizedAdmin(owner), true);
  for (const role of ADMIN_ROLES) assert.equal(hasAdminRole(owner, role), true);
});
