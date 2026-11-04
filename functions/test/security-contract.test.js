'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { toPublicReview, toPublicQuestion } = require('../index');

test('Firestore rules are deployed from source and deny client order writes', () => {
  const config = JSON.parse(read('firebase.json'));
  const rulesPath = path.join(root, config.firestore.rules);
  assert.ok(fs.existsSync(rulesPath));
  const rules = fs.readFileSync(rulesPath, 'utf8');
  assert.match(rules, /match \/orders\/\{orderId\}/);
  assert.match(rules, /allow create, delete: if false;/);
  assert.match(rules, /request\.auth\.token\.admin == true/);
});

test('checkout calls the trusted order function and the payment-return page cannot mutate order state', () => {
  const storefront = read('public/index.html');
  const paymentReturn = read('public/payment-success.html');
  assert.match(storefront, /httpsCallable\('placeOrder'\)/);
  assert.match(paymentReturn, /httpsCallable\('getOrderPaymentStatus'\)/);
  assert.doesNotMatch(paymentReturn, /collection\(['"]orders['"]\)/);
  assert.doesNotMatch(paymentReturn, /FieldValue\.serverTimestamp\(\)/);
});

test('admin page has no public email allowlist and depends on a verified admin claim', () => {
  const admin = read('public/admin.html');
  assert.match(admin, /tokenResult\.claims\.admin === true/);
  assert.doesNotMatch(admin, /ADMIN_EMAILS|adminEmails|allowedAdmins\s*=\s*\[/i);
});

test('function-call pages explicitly allow callable-function endpoints in their CSP meta policy', () => {
  for (const file of ['public/index.html', 'public/admin.html', 'public/giftcards.html', 'public/payment-success.html']) {
    assert.match(read(file), /connect-src[^>]*https:\/\/\*\.cloudfunctions\.net/);
  }
});

test('raw review and question documents are admin-only; public display data is projected by callables', () => {
  const rules = read('firestore.rules');
  const functions = read('functions/index.js');
  const storefront = read('public/index.html');
  assert.match(rules, /match \/reviews\/\{reviewId\} \{\s+allow read: if isAdmin\(\);/);
  assert.match(rules, /match \/productQA\/\{questionId\} \{\s+allow read: if isAdmin\(\);/);
  assert.match(functions, /exports\.listPublicReviews = onCall/);
  assert.match(functions, /exports\.listProductQuestions = onCall/);
  assert.match(functions, /enforcePublicReadRateLimit\(request, 'public_reviews'\)/);
  assert.match(functions, /enforcePublicReadRateLimit\(request, 'public_questions'\)/);
  assert.match(functions, /const PUBLIC_READ_RATE_LIMIT = 60/);
  assert.doesNotMatch(storefront, /collection\(['"]reviews['"]\)\.(where|orderBy)/);
  assert.doesNotMatch(storefront, /collection\(['"]productQA['"]\)\.(where|orderBy)/);
});

test('account bills are built from the signed-in user’s orders and distinguish paid receipts from pending statements', () => {
  const storefront = read('public/index.html');
  assert.match(storefront, /collection\(['"]orders['"]\)\.where\('uid',\s*'==',\s*uid\)/);
  assert.match(storefront, /function printUserOrderBill\(orderId\)/);
  assert.match(storefront, /order\.paymentStatus === 'paid'/);
  assert.match(storefront, /PAYMENT PENDING — THIS IS NOT A PAID RECEIPT/);
  assert.match(storefront, /escapeHTML\(item\.name \|\| 'Item'\)/);
  assert.match(storefront, /var safeDisplayName = escapeHTML\(displayName\)/);
  assert.match(storefront, /escapeHTML\(\[a\.street, a\.city, a\.state, a\.zip\]/);
  assert.match(storefront, /Print \/ Save bill/);
});

test('public review and Q&A projections omit email and account identifiers', () => {
  const review = toPublicReview({ productId: 116, name: 'Buyer', email: 'private@example.com', userId: 'uid-secret', rating: 5, comment: 'Great', date: '2026-10-01' });
  assert.equal(review.name, 'Buyer');
  assert.equal(review.verified, false);
  assert.equal(Object.hasOwn(review, 'email'), false);
  assert.equal(Object.hasOwn(review, 'userId'), false);
  const question = toPublicQuestion({ productId: 116, userName: 'Buyer', userEmail: 'private@example.com', question: 'Question', answer: '', createdAt: '2026-10-01' });
  assert.equal(question.question, 'Question');
  assert.equal(Object.hasOwn(question, 'userEmail'), false);
});
