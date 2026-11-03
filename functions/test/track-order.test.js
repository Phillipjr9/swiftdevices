'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidTrackRequest, toPublicTrackingSummary } = require('../index');
test('accepts only legacy Swift order IDs and plausible email values', () => {
  assert.equal(isValidTrackRequest('SW-123456', 'buyer@example.com'), true);
  assert.equal(isValidTrackRequest('SW-12345', 'buyer@example.com'), false);
  assert.equal(isValidTrackRequest('SW-123456<script>', 'buyer@example.com'), false);
  assert.equal(isValidTrackRequest('SW-123456', 'not-an-email'), false);
});
test('tracking response excludes customer PII and payment data', () => {
  const summary = toPublicTrackingSummary('SW-123456', {
    email: 'buyer@example.com', total: 999, shipping: { address: 'private address' },
    bankReceiptUrl: 'private receipt', status: 'shipped', trackingCarrier: 'ups',
    trackingNumber: '1Z123', items: [{ name: 'Phone', qty: 1, price: 999 }],
  });
  assert.deepEqual(Object.keys(summary).sort(), ['createdAt','items','orderNumber','status','trackingCarrier','trackingNumber'].sort());
  assert.equal(summary.items[0].name, 'Phone');
  assert.equal(summary.items[0].qty, 1);
});
