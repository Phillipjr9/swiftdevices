'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore');

let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-swiftdevices',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'orders/order-1'), { uid: 'customer-1', paymentStatus: 'paid' }),
      setDoc(doc(db, 'siteSettings/productOverrides'), { overrides: {} }),
      setDoc(doc(db, 'siteSettings/promoConfig'), { enabled: false }),
      setDoc(doc(db, 'siteSettings/coupons'), { codes: {} }),
      setDoc(doc(db, 'siteSettings/cryptoWallets'), { wallets: [] }),
      setDoc(doc(db, 'rewardsPoints/customer-1'), { points: 100 }),
      setDoc(doc(db, 'giftCards/card-1'), { code: 'card-1', balance: 50 }),
      setDoc(doc(db, 'contactMessages/message-1'), { email: 'customer@example.com' }),
      setDoc(doc(db, 'accountDeletionRequests/customer-1'), { status: 'pending', email: 'customer@example.com' }),
      setDoc(doc(db, 'tradeInRequests/trade-1'), { status: 'pending', uid: 'customer-1' }),
      setDoc(doc(db, 'reviews/review-1'), { userId: 'customer-1', comment: 'Review' }),
      setDoc(doc(db, 'blogPosts/post-1'), { published: false, title: 'Draft' }),
      setDoc(doc(db, 'subscribers/subscriber-1'), { email: 'customer@example.com' }),
      setDoc(doc(db, 'auditLog/entry-1'), { adminEmail: 'owner@example.com', action: 'seed', details: 'seed' }),
    ]);
  });
});

function staff(role) {
  return env.authenticatedContext(`staff-${role}`, { adminRole: role, email: `${role}@example.com` }).firestore();
}

function owner() {
  return env.authenticatedContext('owner', { admin: true, email: 'owner@example.com' }).firestore();
}

test('orders role can read orders but no staff role can directly modify order documents', async () => {
  const ordersDb = staff('orders');
  await assertSucceeds(getDocs(collection(ordersDb, 'orders')));
  await assertFails(getDoc(doc(staff('catalog'), 'orders/order-1')));
  await assertFails(updateDoc(doc(ordersDb, 'orders/order-1'), { status: 'shipped' }));
  await assertFails(deleteDoc(doc(staff('finance'), 'orders/order-1')));
});

test('catalog and finance roles can change only their settings domains', async () => {
  await assertSucceeds(updateDoc(doc(staff('catalog'), 'siteSettings/productOverrides'), { overrides: { item: { stock: 2 } } }));
  await assertSucceeds(updateDoc(doc(staff('catalog'), 'siteSettings/promoConfig'), { enabled: true }));
  await assertFails(updateDoc(doc(staff('catalog'), 'siteSettings/coupons'), { codes: {} }));
  await assertSucceeds(updateDoc(doc(staff('finance'), 'siteSettings/coupons'), { codes: {} }));
  await assertSucceeds(updateDoc(doc(staff('finance'), 'siteSettings/cryptoWallets'), { wallets: [] }));
  await assertFails(updateDoc(doc(staff('finance'), 'siteSettings/productOverrides'), { overrides: {} }));
});

test('finance, support, and catalog data remain isolated by role', async () => {
  await assertSucceeds(getDoc(doc(staff('finance'), 'rewardsPoints/customer-1')));
  await assertFails(getDoc(doc(staff('support'), 'rewardsPoints/customer-1')));
  await assertSucceeds(getDoc(doc(staff('support'), 'contactMessages/message-1')));
  await assertSucceeds(getDoc(doc(staff('support'), 'accountDeletionRequests/customer-1')));
  await assertFails(getDoc(doc(staff('finance'), 'contactMessages/message-1')));
  await assertFails(getDoc(doc(staff('catalog'), 'contactMessages/message-1')));
  await assertSucceeds(getDoc(doc(staff('catalog'), 'blogPosts/post-1')));
  await assertFails(getDoc(doc(staff('support'), 'blogPosts/post-1')));
});

test('audit logs can be created by staff but read only by owners', async () => {
  const db = staff('orders');
  await assertSucceeds(setDoc(doc(db, 'auditLog/staff-entry'), {
    adminEmail: 'orders@example.com', action: 'order_update', details: 'Updated order status',
  }));
  await assertFails(getDocs(collection(db, 'auditLog')));
  await assertSucceeds(getDoc(doc(owner(), 'auditLog/entry-1')));
});

test('legacy admin claim retains owner access', async () => {
  await assertSucceeds(getDoc(doc(owner(), 'contactMessages/message-1')));
  await assertSucceeds(getDoc(doc(owner(), 'rewardsPoints/customer-1')));
  await assertSucceeds(getDoc(doc(owner(), 'blogPosts/post-1')));
  await assertSucceeds(getDoc(doc(owner(), 'auditLog/entry-1')));
});


test('manual checkout pricing is publicly readable but only an Owner can write it', async () => {
  const publicDb = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(publicDb, 'siteSettings/checkoutPricing')));
  await assertSucceeds(setDoc(doc(owner(), 'siteSettings/checkoutPricing'), { enabled: true, taxRate: 0.05, shippingCost: 10 }));
  await assertFails(setDoc(doc(staff('finance'), 'siteSettings/checkoutPricing'), { enabled: true, taxRate: 0.05, shippingCost: 10 }));
  await assertFails(setDoc(doc(staff('catalog'), 'siteSettings/checkoutPricing'), { enabled: false, taxRate: 0, shippingCost: 0 }));
});
