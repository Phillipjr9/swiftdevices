'use strict';

const ADMIN_ROLES = Object.freeze(['orders', 'catalog', 'finance', 'support']);

function isOwner(token) {
  return Boolean(token && token.admin === true);
}

function hasAdminRole(token, role) {
  return isOwner(token) || Boolean(token && token.adminRole === role && ADMIN_ROLES.includes(role));
}

function isAuthorizedAdmin(token) {
  return isOwner(token) || Boolean(token && ADMIN_ROLES.includes(token.adminRole));
}

module.exports = { ADMIN_ROLES, hasAdminRole, isAuthorizedAdmin };
