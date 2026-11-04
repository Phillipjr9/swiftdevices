'use strict';

const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { ADMIN_ROLES } = require('../admin-roles');

async function main() {
  const [, , emailArg, actionArg = 'grant', roleArg] = process.argv;
  const email = String(emailArg || '').trim().toLowerCase();
  const action = actionArg.toLowerCase();
  const role = String(roleArg || '').toLowerCase();
  const validAction = ['grant', 'revoke'].includes(action)
    || (['grant-role', 'revoke-role'].includes(action) && ADMIN_ROLES.includes(role));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validAction) {
    console.error('Usage: GCLOUD_PROJECT=your-project-id node scripts/set-admin-claim.js email grant|revoke|grant-role|revoke-role [orders|catalog|finance|support]');
    process.exitCode = 2;
    return;
  }
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  if (!projectId) {
    console.error('Set GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT) to the exact Firebase project before changing claims.');
    process.exitCode = 2;
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = { ...user.customClaims };
  if (action === 'grant') {
    claims.admin = true;
    delete claims.adminRole;
  } else if (action === 'revoke') {
    delete claims.admin;
    delete claims.adminRole;
  } else if (action === 'grant-role') {
    if (claims.admin === true) throw new Error('This account is already an owner. Revoke the owner claim before assigning a staff role.');
    claims.adminRole = role;
  } else if (claims.adminRole === role) {
    delete claims.adminRole;
  }
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`Updated ${email}: ${action}${role ? ` (${role})` : ''}. The user must refresh/sign in again for the token to update.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
