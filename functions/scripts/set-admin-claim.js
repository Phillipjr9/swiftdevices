'use strict';

const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

async function main() {
  const [, , emailArg, actionArg = 'grant'] = process.argv;
  const email = String(emailArg || '').trim().toLowerCase();
  const action = actionArg.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['grant', 'revoke'].includes(action)) {
    console.error('Usage: GCLOUD_PROJECT=your-project-id node scripts/set-admin-claim.js admin@example.com [grant|revoke]');
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
  if (action === 'grant') claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${action === 'grant' ? 'Granted' : 'Revoked'} admin claim for ${email}. The user must refresh/sign in again for the token to update.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
