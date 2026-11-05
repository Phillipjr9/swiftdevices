'use strict';

const MAX_TAX_RATE = 0.2;
const MAX_SHIPPING_COST = 10000;

function normalizeCheckoutPricing(data) {
  if (!data || data.enabled !== true) return null;
  const taxRate = Number(data.taxRate);
  const shippingCost = Number(data.shippingCost);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > MAX_TAX_RATE
      || !Number.isFinite(shippingCost) || shippingCost < 0 || shippingCost > MAX_SHIPPING_COST) return null;
  return { enabled: true, taxRate, shippingCost };
}

function calculateCheckoutTotals(taxableMerchandise, pricing) {
  if (!pricing || pricing.enabled !== true) throw new Error('Checkout pricing is not configured.');
  const taxable = Math.max(0, Number(taxableMerchandise) || 0);
  const tax = Math.round(taxable * pricing.taxRate * 100) / 100;
  const total = Math.round((taxable + tax + pricing.shippingCost) * 100) / 100;
  return { tax, taxRate: pricing.taxRate, shippingCost: pricing.shippingCost, total };
}

module.exports = { MAX_SHIPPING_COST, MAX_TAX_RATE, calculateCheckoutTotals, normalizeCheckoutPricing };
