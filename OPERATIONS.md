# Commerce security and launch operations

This repository now routes order creation, payment-status lookup, reward redemption, and gift-card redemption through trusted Cloud Functions. The following setup still requires an authorized project operator; this repository cannot safely guess real stock, tax obligations, payment credentials, or administrator identities.

## Required before accepting orders

1. **Verify the project and rules.** Confirm the Firebase project ID in `firebase.json` is the intended production project. Review `firestore.rules` against existing production documents and run rules tests in the Firebase Emulator before deploying the rules. A rules deployment can immediately change access for the live site.
2. **Assign admin claims.** Admin dashboard access requires the Firebase Auth custom claim `admin: true`; there is no email allowlist fallback. With Google Application Default Credentials set for the correct project, run:

   ```sh
   GCLOUD_PROJECT=your-firebase-project-id npm --prefix functions run admin:claim -- admin@example.com grant
   ```

   Revoke with the final argument `revoke`. The user must refresh the token or sign in again after a claim change. Never commit service-account keys.
3. **Set real shared inventory.** New/unknown inventory is deliberately treated as zero, not guessed. In the admin product catalog, enter verified on-hand quantities for each sellable item. The browser and server then use `siteSettings/productOverrides`; checkout atomically reserves stock. Orders cannot be placed for an item with no configured stock.
4. **Configure and verify payment instructions.** Crypto wallet addresses are read by the server from `siteSettings/cryptoWallets`; client-submitted addresses are ignored. Manually verify the bank transfer or blockchain transaction before using the admin payment-verification action. The application does **not** integrate a card processor, crypto gateway, or payment webhook; all orders remain pending until an authorized operator confirms receipt.
5. **Confirm tax and delivery policy.** The current server tax rate is a fixed 8% and shipping cost is $0. Pending orders reserve inventory for 24 hours and are then cancelled with stock/points/coupon use released by the scheduled `expirePendingOrders` function. The business must confirm the correct tax rules and supported delivery regions, then update the server policy and customer-facing terms/copy accordingly. Do not rely on the browser's estimate as a tax determination.
6. **Gift-card control.** Customer-created gift cards are inactive until an administrator verifies payment and activates them. Activation currently requires contacting the recipient using the stored order details; there is no automatic email-delivery backend. Use the admin dashboard's “Activate after payment” action only after cleared funds.
7. **Deploy backend before storefront.** Deploy Cloud Functions and Firestore rules before enabling the changed checkout UI. Confirm the functions are in `us-central1` and execute smoke tests using test accounts, test inventory, and non-production wallet/payment details. Do not use real customer data for smoke testing.

## Remaining external integrations / known limits

- No automated payment provider/webhook, refund processor, carrier fulfillment, dynamic sales-tax service, or transactional email service is configured in this repository. Manual operations are explicit and payment status cannot be self-confirmed by a browser return page.
- Checkout receipts are limited to 200 KB and currently stored in the Firestore order document. A production storage bucket with private access and retention controls is preferable before receipt volume grows.
- Customer forms and newsletter signups still include direct browser-side Firestore submissions. Their rules validate payload shape, but abuse monitoring/App Check and retention procedures need a project-level decision. Public review and Q&A read callables are IP-rate-limited to 60 requests per 15-minute window per source IP; this is a basic abuse control, not a substitute for App Check or monitoring.
- The fixed 8% tax and zero shipping amount are interim values, not legal or carrier calculations. Confirm actual jurisdiction, nexus, exemptions, and delivery costs with the business's tax/fulfillment providers.
- The scheduled `expirePendingOrders` function uses Cloud Scheduler and may require a billing-enabled Firebase/Google Cloud plan. The `_publicRateLimits.expiresAt` and `checkoutRequests.expiresAt` TTL policies in `firestore.indexes.json` must be applied. Verify TTL is enabled for both collections in the target project.

## Local validation

```sh
npm ci --prefix functions
npm test --prefix functions
npm run lint --prefix functions
node scripts/check-inline-scripts.js
```

CI runs the same tests/lint and checks inline script syntax. A Firebase Emulator rules suite and real browser end-to-end checkout tests are still recommended; they require emulator setup and project-specific test configuration.
