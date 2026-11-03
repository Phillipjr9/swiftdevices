'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCouponDiscount,
  calculatePromoDiscount,
  BANK_ONLY_THRESHOLD,
  isValidOrderNumber,
  isPaymentMethodAllowed,
  selectCryptoWallet,
  validateOrderInput,
} = require('../index');

test('order numbers accept secure new IDs and legacy IDs, but reject malformed values', () => {
  assert.equal(isValidOrderNumber('SW-123456'), true);
  assert.equal(isValidOrderNumber('SW-ABCDEFGHIJKLMNOPQRST'), true);
  assert.equal(isValidOrderNumber('SW-short'), false);
  assert.equal(isValidOrderNumber('SW-123456<script>'), false);
});

test('order input requires supported products, bounded quantities, delivery details and payment methods', () => {
  const input = {
    items: [{ id: 116, qty: 2 }], paymentMethod: 'bank', email: 'buyer@example.com',
    shipping: { firstName: 'Ada', lastName: 'Lovelace', address: '1 Main St', city: 'Hudson', state: 'NY', zip: '12534' },
  };
  assert.equal(validateOrderInput(input), true);
  assert.equal(validateOrderInput({ ...input, items: [{ id: 9999, qty: 1 }] }), false);
  assert.equal(validateOrderInput({ ...input, items: [{ id: 116, qty: 11 }] }), false);
  assert.equal(validateOrderInput({ ...input, paymentMethod: 'card' }), false);
  assert.equal(validateOrderInput({ ...input, email: 'not-an-email' }), false);
});

test('high-value orders require the configured bank-transfer threshold', () => {
  assert.equal(BANK_ONLY_THRESHOLD, 20000);
  assert.equal(isPaymentMethodAllowed(19999.99, 'crypto'), true);
  assert.equal(isPaymentMethodAllowed(20000, 'crypto'), false);
  assert.equal(isPaymentMethodAllowed(20000, 'bank'), true);
  assert.equal(validateOrderInput({
    items: [{ id: 116, qty: 2 }], paymentMethod: 'crypto', email: 'buyer@example.com',
    shipping: { firstName: 'Ada', lastName: 'Lovelace', address: '1 Main St', city: 'Hudson', state: 'NY', zip: '12534', country: 'NG' },
  }), false);
});

test('crypto wallet selection always uses a configured destination', () => {
  const wallets = [
    { coin: 'BTC', address: 'btc-server-address', network: 'Bitcoin' },
    { coin: 'ETH', address: 'eth-server-address', network: 'Ethereum' },
  ];
  assert.equal(selectCryptoWallet(wallets, 'ETH').address, 'eth-server-address');
  assert.equal(selectCryptoWallet(wallets, 'SOL').address, 'btc-server-address');
  assert.equal(selectCryptoWallet([], 'BTC'), null);
});

test('server promo discount honors active window and a maximum percentage', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  assert.equal(calculatePromoDiscount(100, {
    enabled: true, discount: 10, startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-04T00:00:00Z',
  }, now), 10);
  assert.equal(calculatePromoDiscount(100, {
    enabled: true, discount: 100, startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-04T00:00:00Z',
  }, now), 0);
  assert.equal(calculatePromoDiscount(100, {
    enabled: true, discount: 10, startDate: '2026-11-04T00:00:00Z', endDate: '2026-11-05T00:00:00Z',
  }, now), 0);
});

test('coupon discounts honor assignment, minimums, expiration and caps', () => {
  const coupon = { active: true, type: 'percent', value: 25, minOrder: 20, assignedTo: ['buyer@example.com'] };
  assert.equal(calculateCouponDiscount(100, coupon, 'buyer@example.com'), 25);
  assert.equal(calculateCouponDiscount(10, coupon, 'buyer@example.com'), 0);
  assert.equal(calculateCouponDiscount(100, coupon, 'other@example.com'), 0);
  assert.equal(calculateCouponDiscount(100, { ...coupon, value: 150 }, 'buyer@example.com'), 100);
  assert.equal(calculateCouponDiscount(100, { ...coupon, expires: 'not-a-date' }, 'buyer@example.com'), 0);
});
