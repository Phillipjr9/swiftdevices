'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { createHash, randomBytes } = require('node:crypto');
const { hasAdminRole } = require('./admin-roles');

initializeApp();
const db = getFirestore();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 12;
const PUBLIC_READ_RATE_LIMIT = 60;

async function enforcePublicReadRateLimit(request, scope) {
  const ip = String(request.rawRequest?.ip || 'unknown').slice(0, 80);
  const rateId = createHash('sha256').update(ip).digest('hex');
  const rateRef = db.collection('_publicRateLimits').doc(`${scope}_${rateId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const now = Date.now();
    const data = snap.exists ? snap.data() : {};
    const windowStart = data.windowStart?.toMillis?.() || 0;
    const count = windowStart > now - RATE_WINDOW_MS ? Number(data.count || 0) : 0;
    if (count >= PUBLIC_READ_RATE_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few minutes and try again.');
    }
    tx.set(rateRef, {
      count: count + 1,
      windowStart: count ? data.windowStart : Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + RATE_WINDOW_MS * 2),
    });
  });
}

function isValidOrderNumber(orderNumber) {
  return /^SW-(?:\d{6}|[A-Za-z0-9_-]{20})$/.test(orderNumber);
}

function isValidTrackRequest(orderNumber, email) {
  return isValidOrderNumber(orderNumber) && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toPublicTrackingSummary(orderNumber, order) {
  return {
    orderNumber,
    status: String(order.status || 'confirmed').slice(0, 40),
    createdAt: order.createdAt?.toDate ? order.createdAt.toDate().toISOString() : null,
    trackingCarrier: String(order.trackingCarrier || '').slice(0, 40),
    trackingNumber: String(order.trackingNumber || '').slice(0, 80),
    items: Array.isArray(order.items) ? order.items.slice(0, 30).map((item) => ({
      name: String(item.name || 'Item').slice(0, 120),
      qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
    })) : [],
  };
}

/**
 * Privacy-preserving public order lookup. A low-entropy legacy order number is
 * not sufficient authorization: callers must also prove the order email.
 * Only fulfillment details required for tracking are returned.
 */
exports.trackOrder = onCall({ region: 'us-central1', maxInstances: 20 }, async (request) => {
  const orderNumber = String(request.data?.orderNumber || '').trim().toUpperCase();
  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!isValidTrackRequest(orderNumber, email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid order number and email address.');
  }

  const ip = String(request.rawRequest?.ip || 'unknown').slice(0, 80);
  const rateId = createHash('sha256').update(ip).digest('hex');
  const rateRef = db.collection('_publicRateLimits').doc(`track_${rateId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const now = Date.now();
    const data = snap.exists ? snap.data() : {};
    const since = data.windowStart?.toMillis?.() || 0;
    const count = since > now - RATE_WINDOW_MS ? (data.count || 0) : 0;
    if (count >= RATE_LIMIT) throw new HttpsError('resource-exhausted', 'Too many lookup attempts. Please try again in a few minutes.');
    tx.set(rateRef, { count: count + 1, windowStart: count ? data.windowStart : Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + RATE_WINDOW_MS * 2) });
  });

  const snap = await db.collection('orders').doc(orderNumber).get();
  const order = snap.exists ? snap.data() : null;
  const storedEmail = String(order?.email || order?.shipping?.email || '').trim().toLowerCase();
  // Keep missing order and incorrect email responses indistinguishable.
  if (!order || !storedEmail || storedEmail !== email) {
    throw new HttpsError('not-found', 'We could not find an order matching those details. Check them and try again.');
  }

  return toPublicTrackingSummary(orderNumber, order);
});


const CATALOG = require('./catalog.json');
const CATALOG_BY_ID = new Map(CATALOG.map((product) => [product.id, product]));
const configuredTaxRate = Number(process.env.CHECKOUT_TAX_RATE || 0.08);
const CHECKOUT_TAX_RATE = Number.isFinite(configuredTaxRate) && configuredTaxRate >= 0 && configuredTaxRate <= 0.2 ? configuredTaxRate : 0.08;
const BANK_ONLY_THRESHOLD = 20000;
const POINT_VALUE = 0.01;
const POINTS_PER_DOLLAR = 2;
const ORDER_RATE_LIMIT = 6;

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function calculateCouponDiscount(subtotal, coupon, email, now = new Date()) {
  if (!coupon || coupon.active !== true || !['percent', 'fixed'].includes(coupon.type)) return 0;
  if (coupon.expires) {
    const expiry = new Date(coupon.expires).getTime();
    if (!Number.isFinite(expiry) || expiry < now.getTime()) return 0;
  }
  if (Number(coupon.maxUses) > 0 && Number(coupon.used || 0) >= Number(coupon.maxUses)) return 0;
  if (subtotal < Number(coupon.minOrder || 0)) return 0;
  const assignedTo = Array.isArray(coupon.assignedTo) ? coupon.assignedTo.map((value) => String(value).toLowerCase()) : [];
  if (assignedTo.length && !assignedTo.includes(email.toLowerCase())) return 0;
  const amount = coupon.type === 'percent'
    ? subtotal * Number(coupon.value) / 100
    : Number(coupon.value);
  return Math.round(Math.max(0, Math.min(subtotal, amount)) * 100) / 100;
}

function selectCryptoWallet(wallets, requestedCoin) {
  const available = Array.isArray(wallets) ? wallets.filter((entry) => entry && cleanText(entry.coin, 12) && cleanText(entry.address, 180)) : [];
  const requested = cleanText(requestedCoin, 12).toUpperCase();
  return available.find((entry) => cleanText(entry.coin, 12).toUpperCase() === requested) || available[0] || null;
}

function activePromoRate(config, now = new Date()) {
  if (!config || config.enabled !== true) return 0;
  const discountPercent = Number(config.discount);
  const start = new Date(config.startDate).getTime();
  const end = new Date(config.endDate).getTime();
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 90
      || !Number.isFinite(start) || !Number.isFinite(end) || now.getTime() < start || now.getTime() >= end) return 0;
  return discountPercent / 100;
}

function calculatePromoDiscount(subtotal, config, now = new Date()) {
  return Math.round(Math.min(subtotal, subtotal * activePromoRate(config, now)) * 100) / 100;
}

function isPaymentMethodAllowed(total, method) {
  return Number(total) < BANK_ONLY_THRESHOLD || method === 'bank';
}

function calculateEarnedPoints(total) {
  const amount = Number(total);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount * POINTS_PER_DOLLAR) : 0;
}

function validateOrderInput(data) {
  const items = data?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) return false;
  if (!['crypto', 'bank'].includes(data.paymentMethod)) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(data.email, 254))) return false;
  if (data.shipping?.country && cleanText(data.shipping.country, 2).toUpperCase() !== 'US') return false;
  if (!data.shipping || !cleanText(data.shipping.firstName, 80) || !cleanText(data.shipping.lastName, 80)
      || !cleanText(data.shipping.address, 180) || !cleanText(data.shipping.city, 80)
      || !cleanText(data.shipping.state, 80) || !cleanText(data.shipping.zip, 20)) return false;
  return items.every((item) => Number.isInteger(Number(item.id)) && Number.isInteger(Number(item.qty))
    && Number(item.qty) >= 1 && Number(item.qty) <= 10 && CATALOG_BY_ID.has(Number(item.id)));
}

/** Server-authoritative order creation, pricing, coupon use, points and inventory reservation. */
exports.placeOrder = onCall({ region: 'us-central1', maxInstances: 20 }, async (request) => {
  const data = request.data || {};
  if (!validateOrderInput(data)) throw new HttpsError('invalid-argument', 'Check your items, contact details, shipping address, and payment method.');
  const email = cleanText(data.email, 254).toLowerCase();
  const checkoutKey = cleanText(data.checkoutKey, 80);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(checkoutKey)) throw new HttpsError('invalid-argument', 'Please retry checkout.');
  const uid = request.auth?.uid || null;
  const itemCounts = new Map();
  for (const item of data.items) {
    const id = Number(item.id);
    itemCounts.set(id, (itemCounts.get(id) || 0) + Number(item.qty));
  }
  for (const qty of itemCounts.values()) if (qty > 10) throw new HttpsError('invalid-argument', 'Maximum quantity is 10 per product.');

  const ip = String(request.rawRequest?.ip || 'unknown').slice(0, 80);
  const rateId = createHash('sha256').update(ip).digest('hex');
  const rateRef = db.collection('_publicRateLimits').doc(`order_${rateId}`);
  const requestId = createHash('sha256').update(`${uid || rateId}:${checkoutKey}`).digest('hex');
  const requestRef = db.collection('checkoutRequests').doc(requestId);
  const checkoutFingerprint = createHash('sha256').update(JSON.stringify({
    items: Array.from(itemCounts.entries()).sort((a, b) => a[0] - b[0]), email, paymentMethod: data.paymentMethod,
    couponCode: cleanText(data.couponCode, 40).toUpperCase(), pointsRedeemed: Number(data.pointsRedeemed || 0), shipping: data.shipping,
  })).digest('hex');
  const overridesRef = db.collection('siteSettings').doc('productOverrides');
  const couponRef = db.collection('siteSettings').doc('coupons');
  const promoRef = db.collection('siteSettings').doc('promoConfig');
  const pointsRef = uid ? db.collection('rewardsPoints').doc(uid) : null;
  const walletRef = db.collection('siteSettings').doc('cryptoWallets');
  // Use a cryptographically random ID and store the document under the exact
  // public order number so tracking, admin actions, and payment status agree.
  const orderNumber = `SW-${randomBytes(15).toString('base64url')}`;
  const orderRef = db.collection('orders').doc(orderNumber);
  const nowMs = Date.now();

  return db.runTransaction(async (tx) => {
    const [rateSnap, requestSnap, overridesSnap, couponsSnap, pointsSnap, walletSnap, promoSnap] = await Promise.all([
      tx.get(rateRef), tx.get(requestRef), tx.get(overridesRef), tx.get(couponRef), pointsRef ? tx.get(pointsRef) : Promise.resolve(null),
      data.paymentMethod === 'crypto' ? tx.get(walletRef) : Promise.resolve(null), tx.get(promoRef),
    ]);
    if (requestSnap.exists) {
      if (requestSnap.data().checkoutFingerprint !== checkoutFingerprint) {
        throw new HttpsError('failed-precondition', 'This checkout attempt has changed. Please retry with a fresh checkout.');
      }
      const existingNumber = requestSnap.data().orderNumber;
      const existingOrder = await tx.get(db.collection('orders').doc(existingNumber));
      if (existingOrder.exists) {
        const existing = existingOrder.data();
        return { orderNumber: existingNumber, subtotal: existing.subtotal, discount: existing.discount, couponDiscount: existing.couponDiscount || 0, promoDiscount: existing.promoDiscount || 0, pointsDiscount: existing.pointsDiscount || 0, pointsRedeemed: existing.pointsRedeemed || 0, items: existing.items || [], tax: existing.tax, total: existing.total, status: existing.status, cryptoCoin: existing.cryptoCoin || null, cryptoNetwork: existing.cryptoNetwork || null, cryptoWalletAddress: existing.cryptoWalletAddress || null };
      }
    }
    const rateData = rateSnap.exists ? rateSnap.data() : {};
    const windowStart = rateData.windowStart?.toMillis?.() || 0;
    const attemptCount = windowStart > nowMs - RATE_WINDOW_MS ? Number(rateData.count || 0) : 0;
    if (attemptCount >= ORDER_RATE_LIMIT) throw new HttpsError('resource-exhausted', 'Too many checkout attempts. Please try again later.');

    const overrides = overridesSnap.exists && overridesSnap.data().overrides ? { ...overridesSnap.data().overrides } : {};
    const lineItems = [];
    const promoConfig = promoSnap?.exists ? promoSnap.data() : null;
    const promoRate = activePromoRate(promoConfig, new Date(nowMs));
    let listSubtotal = 0;
    let subtotal = 0;
    for (const [id, qty] of itemCounts.entries()) {
      const product = CATALOG_BY_ID.get(id);
      const override = overrides[String(id)] || {};
      const price = Math.round(Number(override.price !== undefined ? override.price : product.price) * 100) / 100;
      const stock = Number(override.stock);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < qty) {
        throw new HttpsError('failed-precondition', `${product.name} is currently unavailable. Please refresh the catalog or contact support.`);
      }
      const effectivePrice = Math.round(price * (1 - promoRate) * 100) / 100;
      lineItems.push({ id, name: product.name, brand: product.brand, listPrice: price, price: effectivePrice, qty });
      listSubtotal += price * qty;
      subtotal += effectivePrice * qty;
      overrides[String(id)] = { ...override, stock: stock - qty };
    }
    listSubtotal = Math.round(listSubtotal * 100) / 100;
    subtotal = Math.round(subtotal * 100) / 100;
    const promoDiscount = Math.round((listSubtotal - subtotal) * 100) / 100;

    const couponCode = cleanText(data.couponCode, 40).toUpperCase();
    const couponDoc = couponsSnap?.exists ? couponsSnap.data().codes || {} : {};
    const coupon = couponCode ? couponDoc[couponCode] : null;
    if (couponCode && !coupon) throw new HttpsError('failed-precondition', 'That coupon is not valid.');
    const couponDiscount = couponCode ? calculateCouponDiscount(subtotal, coupon, email) : 0;
    if (couponCode && couponDiscount <= 0) throw new HttpsError('failed-precondition', 'That coupon is expired, restricted, or does not meet its order minimum.');
    const discount = couponDiscount;

    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (Number(data.pointsRedeemed || 0) > 0) {
      if (!uid || !pointsSnap?.exists) throw new HttpsError('failed-precondition', 'Sign in to redeem reward points.');
      const available = Math.max(0, Number(pointsSnap.data().points || 0));
      const requested = Math.min(available, Math.floor(Number(data.pointsRedeemed)));
      const amountAfterCoupon = Math.max(0, subtotal - discount);
      pointsRedeemed = Math.min(requested, Math.floor(amountAfterCoupon / POINT_VALUE));
      pointsDiscount = Math.round(pointsRedeemed * POINT_VALUE * 100) / 100;
    }
    const taxable = Math.max(0, subtotal - discount - pointsDiscount);
    const tax = Math.round(taxable * CHECKOUT_TAX_RATE * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;
    if (!isPaymentMethodAllowed(total, data.paymentMethod)) {
      throw new HttpsError('failed-precondition', 'Bank transfer is required for orders of $20,000 or more.');
    }
    const expectedTotal = data.expectedTotal === undefined ? null : Number(data.expectedTotal);
    if (data.expectedTotal !== undefined && (!Number.isFinite(expectedTotal) || expectedTotal < 0)) {
      throw new HttpsError('invalid-argument', 'Invalid expected order total.');
    }
    if (expectedTotal !== null && Math.abs(expectedTotal - total) >= 0.01) {
      throw new HttpsError('failed-precondition', 'Order totals changed. Review the updated total before placing your order.', {
        quote: { listSubtotal, subtotal, promoDiscount, couponDiscount, pointsDiscount, pointsRedeemed, tax, total, items: lineItems },
      });
    }
    const shipping = {
      firstName: cleanText(data.shipping.firstName, 80), lastName: cleanText(data.shipping.lastName, 80), email,
      address: cleanText(data.shipping.address, 180), city: cleanText(data.shipping.city, 80),
      state: cleanText(data.shipping.state, 80), zip: cleanText(data.shipping.zip, 20), country: cleanText(data.shipping.country || 'US', 2).toUpperCase(),
    };
    const order = {
      orderNumber, uid, email, shipping, items: lineItems, paymentMethod: data.paymentMethod,
      listSubtotal, subtotal, promoDiscount, couponDiscount, discount, coupon: couponCode || null, pointsDiscount, pointsRedeemed,
      tax, taxRate: CHECKOUT_TAX_RATE, shippingCost: 0, total,
      status: 'awaiting_payment', paymentStatus: 'pending',
      cryptoVerified: false, createdAt: Timestamp.now(),
      paymentExpiresAt: Timestamp.fromMillis(nowMs + 24 * 60 * 60 * 1000),
    };
    if (data.paymentMethod === 'crypto') {
      const wallets = walletSnap?.exists && Array.isArray(walletSnap.data().wallets) ? walletSnap.data().wallets : [];
      // The browser may request a coin, but can never supply or change the destination address.
      const wallet = selectCryptoWallet(wallets, data.cryptoCoin);
      if (!wallet) throw new HttpsError('failed-precondition', 'Crypto payment instructions are unavailable.');
      order.cryptoCoin = cleanText(wallet.coin, 12).toUpperCase();
      order.cryptoNetwork = cleanText(wallet.network, 40);
      order.cryptoWalletAddress = cleanText(wallet.address, 180);
    }
    const receipt = typeof data.bankReceiptData === 'string' ? data.bankReceiptData : '';
    if (data.paymentMethod === 'bank' && receipt) {
      if (receipt.length > 300000 || !/^data:(image\/(png|jpeg)|application\/pdf);base64,/.test(receipt)) {
        throw new HttpsError('invalid-argument', 'Receipt must be a PNG, JPEG, or PDF under 225 KB.');
      }
      order.bankReceiptUrl = receipt;
      order.bankReceiptName = cleanText(data.bankReceiptName, 120);
    }

    tx.set(orderRef, order);
    tx.set(requestRef, { orderNumber, checkoutFingerprint, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(nowMs + 7 * 24 * 60 * 60 * 1000) });
    tx.set(rateRef, { count: attemptCount + 1, windowStart: attemptCount ? rateData.windowStart : Timestamp.fromMillis(nowMs), expiresAt: Timestamp.fromMillis(nowMs + RATE_WINDOW_MS * 2) });
    tx.set(overridesRef, { overrides }, { merge: true });
    if (pointsRedeemed > 0 && pointsRef) {
      const balanceAfter = Number(pointsSnap.data().points || 0) - pointsRedeemed;
      tx.set(pointsRef, { points: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
      tx.set(db.collection('rewardsLedger').doc(`${orderNumber}_redeem`), {
        uid, type: 'redeem', points: -pointsRedeemed, balanceAfter, orderNumber,
        description: `Points redeemed on order ${orderNumber}`, createdAt: Timestamp.now(),
      });
    }
    if (couponCode && discount > 0) {
      couponDoc[couponCode] = { ...coupon, used: Number(coupon.used || 0) + 1 };
      tx.set(couponRef, { codes: couponDoc }, { merge: true });
    }
    return { orderNumber, listSubtotal, subtotal, promoDiscount, couponDiscount, discount, pointsDiscount, pointsRedeemed, items: lineItems, tax, total, status: order.status, cryptoCoin: order.cryptoCoin || null, cryptoNetwork: order.cryptoNetwork || null, cryptoWalletAddress: order.cryptoWalletAddress || null };
  });
});

function timestampToISOString(value) {
  if (value?.toDate) return value.toDate().toISOString();
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toPublicReview(review) {
  return {
    productId: Number(review.productId),
    name: cleanText(review.name || 'Customer', 100),
    rating: Math.max(1, Math.min(5, Math.floor(Number(review.rating) || 1))),
    comment: cleanText(review.comment, 3000),
    createdAt: timestampToISOString(review.createdAt || review.date),
    verified: false,
  };
}

function toPublicQuestion(question) {
  return {
    productId: Number(question.productId),
    userName: cleanText(question.userName || 'Customer', 100),
    question: cleanText(question.question, 2000),
    answer: cleanText(question.answer, 3000),
    createdAt: timestampToISOString(question.createdAt),
  };
}

exports.listPublicReviews = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(request.data?.limit) || 12)));
  let query = db.collection('reviews');
  if (request.data?.productId !== undefined) {
    const productId = Number(request.data.productId);
    if (!Number.isInteger(productId) || !CATALOG_BY_ID.has(productId)) throw new HttpsError('invalid-argument', 'Invalid product.');
    query = query.where('productId', '==', productId);
  }
  await enforcePublicReadRateLimit(request, 'public_reviews');
  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
  return { reviews: snapshot.docs.map((doc) => toPublicReview(doc.data())) };
});

exports.listProductQuestions = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const productId = Number(request.data?.productId);
  if (!Number.isInteger(productId) || !CATALOG_BY_ID.has(productId)) throw new HttpsError('invalid-argument', 'Invalid product.');
  await enforcePublicReadRateLimit(request, 'public_questions');
  const snapshot = await db.collection('productQA').where('productId', '==', productId)
    .orderBy('createdAt', 'desc').limit(20).get();
  return { questions: snapshot.docs.map((doc) => toPublicQuestion(doc.data())) };
});

exports.listPublicCoupons = onCall({ region: 'us-central1', maxInstances: 10 }, async () => {
  const snap = await db.collection('siteSettings').doc('coupons').get();
  const codes = snap.exists ? snap.data().codes || {} : {};
  const now = Date.now();
  const result = {};
  for (const [code, coupon] of Object.entries(codes)) {
    if (!coupon || coupon.active !== true) continue;
    if (coupon.expires) {
      const expiry = new Date(coupon.expires).getTime();
      if (!Number.isFinite(expiry) || expiry < now) continue;
    }
    if (Number(coupon.maxUses) > 0 && Number(coupon.used || 0) >= Number(coupon.maxUses)) continue;
    result[code] = {
      type: coupon.type,
      value: Number(coupon.value) || 0,
      label: cleanText(coupon.label || code, 80),
      minOrder: Number(coupon.minOrder) || 0,
      assignedTo: [],
    };
  }
  return { codes: result };
});

exports.submitCryptoTransaction = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const orderNumber = cleanText(request.data?.orderNumber, 64);
  const email = cleanText(request.data?.email, 254).toLowerCase();
  const txHash = cleanText(request.data?.txHash, 160);
  if (!/^SW-(?:\d{6}|[A-Za-z0-9_-]{20})$/.test(orderNumber) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9]{20,160}$/.test(txHash)) {
    throw new HttpsError('invalid-argument', 'Enter a valid order number, email address, and transaction hash.');
  }
  const ref = db.collection('orders').doc(orderNumber);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const order = snap.exists ? snap.data() : null;
    if (!order || String(order.email || '').toLowerCase() !== email || order.paymentMethod !== 'crypto' || order.status !== 'awaiting_payment' || order.paymentStatus !== 'pending') {
      throw new HttpsError('not-found', 'We could not find a pending crypto order matching those details.');
    }
    tx.update(ref, { cryptoTxHash: txHash, cryptoTxSubmittedAt: Timestamp.now() });
  });
  return { submitted: true };
});

exports.adminUpdateOrder = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  const data = request.data || {};
  const token = request.auth?.token;
  if (data.reason !== undefined ? !hasAdminRole(token, 'finance') : !(hasAdminRole(token, 'orders') || hasAdminRole(token, 'finance'))) {
    throw new HttpsError('permission-denied', 'The orders or finance admin role is required.');
  }
  const orderNumber = cleanText(data.orderNumber, 64);
  if (!/^SW-(?:\d{6}|[A-Za-z0-9_-]{20})$/.test(orderNumber)) throw new HttpsError('invalid-argument', 'Invalid order number.');
  const orderRef = db.collection('orders').doc(orderNumber);
  const overridesRef = db.collection('siteSettings').doc('productOverrides');
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
  const existing = orderSnap.data();
  const status = data.status ? cleanText(data.status, 30) : existing.status;
  const permittedStatuses = ['awaiting_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!permittedStatuses.includes(status)) throw new HttpsError('invalid-argument', 'Invalid order status.');
  const patch = { updatedAt: Timestamp.now(), updatedBy: request.auth.uid };
  if (data.status) patch.status = status;
  if (data.trackingCarrier !== undefined) patch.trackingCarrier = cleanText(data.trackingCarrier, 30).toLowerCase();
  if (data.trackingNumber !== undefined) patch.trackingNumber = cleanText(data.trackingNumber, 100);
  if (data.notes !== undefined) {
    if (!Array.isArray(data.notes) || data.notes.length > 50) throw new HttpsError('invalid-argument', 'Invalid order notes.');
    patch.notes = data.notes.slice(-50).map((note) => ({ text: cleanText(note.text, 1000), admin: cleanText(note.admin, 100), date: cleanText(note.date, 40) }));
  }
  if (data.reason !== undefined && ['crypto', 'bank'].includes(existing.paymentMethod)) {
    const reason = cleanText(data.reason, 500);
    patch.status = 'cancelled';
    patch.paymentStatus = 'rejected';
    patch[existing.paymentMethod === 'crypto' ? 'cryptoRejectedReason' : 'bankRejectedReason'] = reason;
  }
  if (patch.trackingNumber && !patch.shippedAt) patch.shippedAt = Timestamp.now();

  await db.runTransaction(async (tx) => {
    const pointsRef = existing.uid ? db.collection('rewardsPoints').doc(existing.uid) : null;
    const couponRef = existing.coupon ? db.collection('siteSettings').doc('coupons') : null;
    const [snap, settingsSnap, pointsSnap, couponSnap] = await Promise.all([
      tx.get(orderRef), tx.get(overridesRef), pointsRef ? tx.get(pointsRef) : Promise.resolve(null),
      couponRef ? tx.get(couponRef) : Promise.resolve(null),
    ]);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    const requestedStatus = patch.status || order.status;
    if (['confirmed', 'processing', 'shipped', 'delivered'].includes(requestedStatus) && order.paymentStatus !== 'paid') {
      throw new HttpsError('failed-precondition', 'Verify payment before advancing this order.');
    }
    if (requestedStatus === 'cancelled' && ['paid', 'refunded'].includes(order.paymentStatus)) {
      throw new HttpsError('failed-precondition', 'A paid or refunded order cannot be cancelled automatically; handle inventory after the return is received.');
    }
    if (requestedStatus === 'cancelled' && order.paymentStatus === 'pending' && !patch.paymentStatus) patch.paymentStatus = 'cancelled';
    if (requestedStatus === 'cancelled' && !order.inventoryRestored) {
      const settings = settingsSnap.exists ? settingsSnap.data() : {};
      const overrides = settings.overrides || {};
      for (const item of order.items || []) {
        const key = String(item.id);
        const current = overrides[key] || {};
        if (Number.isFinite(Number(current.stock))) current.stock = Number(current.stock) + Number(item.qty || 0);
        overrides[key] = current;
      }
      tx.set(overridesRef, { overrides }, { merge: true });
      if (pointsRef && pointsSnap?.exists && Number(order.pointsRedeemed) > 0) {
        const currentPoints = Number(pointsSnap.data().points || 0);
        const restored = Number(order.pointsRedeemed);
        const balanceAfter = currentPoints + restored;
        tx.set(pointsRef, { points: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
        tx.set(db.collection('rewardsLedger').doc(`${order.orderNumber || orderRef.id}_cancel_restore`), {
          uid: order.uid, type: 'reversal', points: restored, balanceAfter, orderNumber: order.orderNumber || orderRef.id,
          description: `Points restored after cancellation`, createdAt: Timestamp.now(),
        });
      }
      if (couponRef && couponSnap?.exists) {
        const codes = couponSnap.data().codes || {};
        if (codes[order.coupon]) codes[order.coupon].used = Math.max(0, Number(codes[order.coupon].used || 0) - 1);
        tx.set(couponRef, { codes }, { merge: true });
      }
      patch.inventoryRestored = true;
    }
    tx.update(orderRef, patch);
  });
  return { status: patch.status || existing.status };
});

exports.recordManualRefund = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!hasAdminRole(request.auth?.token, 'finance')) throw new HttpsError('permission-denied', 'The finance admin role is required.');
  const orderNumber = cleanText(request.data?.orderNumber, 64);
  const reason = cleanText(request.data?.reason, 500);
  const reference = cleanText(request.data?.reference, 120);
  if (!isValidOrderNumber(orderNumber) || !reason) {
    throw new HttpsError('invalid-argument', 'Provide a valid order number and a reason for the refund.');
  }
  const orderRef = db.collection('orders').doc(orderNumber);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    if (order.paymentStatus !== 'paid' || order.refundStatus === 'completed') {
      throw new HttpsError('failed-precondition', 'Only a paid, not-yet-refunded order can be recorded as refunded.');
    }
    const amount = Number(order.total);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError('failed-precondition', 'The order has no valid paid total to refund.');
    tx.update(orderRef, {
      paymentStatus: 'refunded', refundStatus: 'completed', refundAmount: amount,
      refundReason: reason, refundReference: reference, refundMethod: 'manual',
      refundedAt: Timestamp.now(), refundedBy: request.auth.uid, updatedAt: Timestamp.now(),
    });
    return { paymentStatus: 'refunded', refundStatus: 'completed', refundAmount: amount };
  });
});

exports.verifyManualPayment = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!hasAdminRole(request.auth?.token, 'finance')) throw new HttpsError('permission-denied', 'The finance admin role is required.');
  const orderNumber = cleanText(request.data?.orderNumber, 64);
  const method = cleanText(request.data?.method, 12);
  if (!isValidOrderNumber(orderNumber) || !['crypto', 'bank'].includes(method)) throw new HttpsError('invalid-argument', 'Invalid order payment request.');
  const orderRef = db.collection('orders').doc(orderNumber);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    if (order.paymentMethod !== method) throw new HttpsError('failed-precondition', 'Payment method does not match the order.');
    if (order.paymentStatus === 'paid') return { status: order.status, alreadyVerified: true };
    if (order.status !== 'awaiting_payment' || order.paymentStatus !== 'pending') {
      throw new HttpsError('failed-precondition', 'Only a pending order can be marked as paid.');
    }
    const eligibleSubtotal = Math.max(0, Number(order.subtotal || 0) - Number(order.discount || 0) - Number(order.pointsDiscount || 0));
    const earned = calculateEarnedPoints(eligibleSubtotal);
    const rewardRef = order.uid ? db.collection('rewardsPoints').doc(order.uid) : null;
    if (rewardRef) {
      const rewardSnap = await tx.get(rewardRef);
      const currentPoints = rewardSnap.exists ? Number(rewardSnap.data().points || 0) : 0;
      const balanceAfter = currentPoints + earned;
      tx.set(rewardRef, { points: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
      if (earned > 0) tx.set(db.collection('rewardsLedger').doc(`${orderNumber}_earn`), {
        uid: order.uid, type: 'earn', points: earned, balanceAfter, orderNumber,
        description: `Points earned on order ${orderNumber}`, createdAt: Timestamp.now(),
      });
    }
    const verification = { status: 'confirmed', paymentStatus: 'paid', paidAt: Timestamp.now(), verifiedBy: request.auth.uid, verifiedAt: Timestamp.now(), pointsAwarded: earned };
    if (method === 'crypto') verification.cryptoVerified = true;
    if (method === 'bank') verification.bankPaymentConfirmed = true;
    tx.update(orderRef, verification);
    return { status: 'confirmed', alreadyVerified: false };
  });
});


exports.expirePendingOrders = onSchedule({
  schedule: 'every 60 minutes',
  timeZone: 'UTC',
  region: 'us-central1',
  maxInstances: 1,
}, async () => {
  const expired = await db.collection('orders')
    .where('status', '==', 'awaiting_payment')
    .where('paymentStatus', '==', 'pending')
    .where('paymentExpiresAt', '<=', Timestamp.now())
    .limit(100)
    .get();
  for (const document of expired.docs) {
    const orderRef = document.ref;
    await db.runTransaction(async (tx) => {
      const currentSnap = await tx.get(orderRef);
      if (!currentSnap.exists) return;
      const order = currentSnap.data();
      if (order.status !== 'awaiting_payment' || order.paymentStatus !== 'pending' || order.inventoryRestored) return;
      const overridesRef = db.collection('siteSettings').doc('productOverrides');
      const pointsRef = order.uid ? db.collection('rewardsPoints').doc(order.uid) : null;
      const couponRef = order.coupon ? db.collection('siteSettings').doc('coupons') : null;
      const [overridesSnap, pointsSnap, couponSnap] = await Promise.all([
        tx.get(overridesRef), pointsRef ? tx.get(pointsRef) : Promise.resolve(null),
        couponRef ? tx.get(couponRef) : Promise.resolve(null),
      ]);
      const settings = overridesSnap.exists ? overridesSnap.data() : {};
      const overrides = settings.overrides || {};
      for (const item of order.items || []) {
        const key = String(item.id);
        const current = overrides[key] || {};
        if (Number.isFinite(Number(current.stock))) current.stock = Number(current.stock) + Number(item.qty || 0);
        overrides[key] = current;
      }
      tx.set(overridesRef, { overrides }, { merge: true });
      if (pointsRef && pointsSnap?.exists && Number(order.pointsRedeemed) > 0) {
        const restored = Number(order.pointsRedeemed);
        const balanceAfter = Number(pointsSnap.data().points || 0) + restored;
        tx.set(pointsRef, { points: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
        tx.set(db.collection('rewardsLedger').doc(`${orderNumber}_expire_restore`), {
          uid: order.uid, type: 'reversal', points: restored, balanceAfter, orderNumber,
          description: 'Points restored after unpaid order expired', createdAt: Timestamp.now(),
        });
      }
      if (couponRef && couponSnap?.exists) {
        const codes = couponSnap.data().codes || {};
        if (codes[order.coupon]) codes[order.coupon].used = Math.max(0, Number(codes[order.coupon].used || 0) - 1);
        tx.set(couponRef, { codes }, { merge: true });
      }
      tx.update(orderRef, { status: 'cancelled', paymentStatus: 'expired', expiredAt: Timestamp.now(), inventoryRestored: true });
    });
  }
});

exports.getOrderPaymentStatus = onCall({ region: 'us-central1', maxInstances: 20 }, async (request) => {
  const orderNumber = cleanText(request.data?.orderNumber, 64).toUpperCase();
  const email = cleanText(request.data?.email, 254).toLowerCase();
  if (!isValidTrackRequest(orderNumber, email)) throw new HttpsError('invalid-argument', 'Enter a valid order number and email address.');
  const ip = String(request.rawRequest?.ip || 'unknown').slice(0, 80);
  const rateId = createHash('sha256').update(ip).digest('hex');
  const rateRef = db.collection('_publicRateLimits').doc(`payment_status_${rateId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const now = Date.now();
    const data = snap.exists ? snap.data() : {};
    const start = data.windowStart?.toMillis?.() || 0;
    const count = start > now - RATE_WINDOW_MS ? Number(data.count || 0) : 0;
    if (count >= RATE_LIMIT) throw new HttpsError('resource-exhausted', 'Too many status checks. Please try again later.');
    tx.set(rateRef, { count: count + 1, windowStart: count ? data.windowStart : Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + RATE_WINDOW_MS * 2) });
  });
  const snap = await db.collection('orders').doc(orderNumber).get();
  const order = snap.exists ? snap.data() : null;
  if (!order || String(order.email || '').trim().toLowerCase() !== email) {
    throw new HttpsError('not-found', 'We could not find an order matching those details.');
  }
  return { orderNumber, status: String(order.status || 'awaiting_payment'), paymentStatus: String(order.paymentStatus || 'pending'), total: Number(order.total) || 0 };
});

exports.redeemGiftCard = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!request.auth?.uid || !request.auth.token.email) throw new HttpsError('unauthenticated', 'Sign in to redeem a gift card.');
  const code = cleanText(request.data?.code, 40).toUpperCase();
  if (!/^(?:SWIFT-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}|[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3})$/.test(code)) throw new HttpsError('invalid-argument', 'Enter a valid gift card code.');
  const ref = db.collection('giftCards').doc(code);
  const rewardsRef = db.collection('rewardsPoints').doc(request.auth.uid);
  return db.runTransaction(async (tx) => {
    const [cardSnap, rewardsSnap] = await Promise.all([tx.get(ref), tx.get(rewardsRef)]);
    if (!cardSnap.exists) throw new HttpsError('not-found', 'Gift card not found.');
    const card = cardSnap.data();
    const emailMatches = String(card.recipientEmail || '').trim().toLowerCase() === String(request.auth.token.email).toLowerCase();
    const assignedToCaller = card.senderUid ? (emailMatches || card.senderUid === request.auth.uid) : (!card.recipientEmail || emailMatches);
    if (card.status !== 'active' || Number(card.balance) <= 0 || !assignedToCaller) {
      throw new HttpsError('failed-precondition', 'This gift card is not active, has already been redeemed, or is assigned to another person.');
    }
    const points = Math.floor(Number(card.balance) * 100);
    const current = rewardsSnap.exists ? Number(rewardsSnap.data().points || 0) : 0;
    tx.update(ref, { status: 'redeemed', balance: 0, redeemedBy: request.auth.uid, redeemedAt: Timestamp.now() });
    const balanceAfter = current + points;
    tx.set(rewardsRef, { points: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
    tx.set(db.collection('rewardsLedger').doc(`giftcard_${code}`), {
      uid: request.auth.uid, type: 'gift_card', points, balanceAfter,
      description: 'Points added from redeemed gift card', createdAt: Timestamp.now(),
    });
    return { balance: Number(card.balance), points };
  });
});


exports.adjustRewardPoints = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!hasAdminRole(request.auth?.token, 'finance')) throw new HttpsError('permission-denied', 'The finance admin role is required.');
  const uid = cleanText(request.data?.uid, 128);
  const delta = Number(request.data?.delta);
  const description = cleanText(request.data?.description, 200);
  if (!uid || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000 || !description) {
    throw new HttpsError('invalid-argument', 'Provide a user, a non-zero points adjustment up to 100,000, and a reason.');
  }
  const rewardRef = db.collection('rewardsPoints').doc(uid);
  const ledgerRef = db.collection('rewardsLedger').doc(`admin_${randomBytes(16).toString('hex')}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(rewardRef);
    const current = snap.exists ? Number(snap.data().points || 0) : 0;
    const balanceAfter = current + delta;
    if (balanceAfter < 0) throw new HttpsError('failed-precondition', 'The adjustment cannot make a points balance negative.');
    tx.set(rewardRef, { points: balanceAfter, totalPoints: balanceAfter, updatedAt: Timestamp.now() }, { merge: true });
    tx.set(ledgerRef, {
      uid, type: 'adjustment', points: delta, balanceAfter, description,
      actorUid: request.auth.uid, createdAt: Timestamp.now(),
    });
    return { points: balanceAfter };
  });
});

exports.requestAccountDeletion = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to request account deletion.');
  const uid = request.auth.uid;
  const ref = db.collection('accountDeletionRequests').doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().status === 'pending') return { submitted: true, alreadyPending: true };
    tx.set(ref, {
      uid, email: cleanText(request.auth.token.email, 254), status: 'pending',
      requestedAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    return { submitted: true, alreadyPending: false };
  });
});

module.exports.isValidTrackRequest = isValidTrackRequest;
module.exports.toPublicTrackingSummary = toPublicTrackingSummary;
module.exports.calculateCouponDiscount = calculateCouponDiscount;
module.exports.toPublicReview = toPublicReview;
module.exports.toPublicQuestion = toPublicQuestion;
module.exports.calculatePromoDiscount = calculatePromoDiscount;
module.exports.activePromoRate = activePromoRate;
module.exports.validateOrderInput = validateOrderInput;
module.exports.BANK_ONLY_THRESHOLD = BANK_ONLY_THRESHOLD;
module.exports.isPaymentMethodAllowed = isPaymentMethodAllowed;
module.exports.calculateEarnedPoints = calculateEarnedPoints;
module.exports.isValidOrderNumber = isValidOrderNumber;
module.exports.selectCryptoWallet = selectCryptoWallet;
