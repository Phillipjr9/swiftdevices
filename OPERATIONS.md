# Commerce security and launch operations

This repository now routes order creation, payment-status lookup, reward redemption, and gift-card redemption through trusted Cloud Functions. New order creation is fail-closed unless the trusted `CHECKOUT_READY=true` environment flag is set. Keep it unset until the selected Stripe Tax and FedEx rate integrations are implemented, configured, and staging-tested. The following setup still requires an authorized project operator; this repository cannot safely guess real stock, tax obligations, payment credentials, or administrator identities.

## Required before accepting orders

1. **Verify the project and rules.** Confirm the Firebase project ID in `firebase.json` is the intended production project. Review `firestore.rules` against existing production documents and run rules tests in the Firebase Emulator before deploying the rules. A rules deployment can immediately change access for the live site.
2. **Assign least-privilege admin roles.** Existing `admin: true` accounts remain full Owners. Staff can instead receive one Firebase Auth custom claim `adminRole` with one of these roles: `orders` (order operations), `catalog` (products and site merchandising), `finance` (payment verification, rewards, coupons, wallets), or `support` (customer support, trade-ins, reviews, and deletion requests). Role access is enforced by Firestore rules and callable functions as well as the dashboard UI. Audit-log reads are Owner-only; staff roles may create audit entries for their actions. With Google Application Default Credentials set for the correct project, run:

   ```sh
   GCLOUD_PROJECT=your-firebase-project-id npm --prefix functions run admin:claim -- staff@example.com grant-role orders
   ```

   Substitute `catalog`, `finance`, or `support` as appropriate. Remove a staff role with `revoke-role orders`, or remove all admin claims with `revoke`. Grant full owner access with `grant`; converting an existing owner to a staff role requires revoking the owner claim first. The user must refresh the token or sign in again after a claim change. Never commit service-account keys.
3. **Set real shared inventory.** New/unknown inventory is deliberately treated as zero, not guessed. In the admin product catalog, enter verified on-hand quantities for each sellable item. The browser and server then use `siteSettings/productOverrides`; checkout atomically reserves stock. Orders cannot be placed for an item with no configured stock.
4. **Configure and verify payment instructions.** Crypto wallet addresses are read by the server from `siteSettings/cryptoWallets`; client-submitted addresses are ignored. Manually verify the bank transfer or blockchain transaction before using the admin payment-verification action. The application does **not** integrate a card processor, crypto gateway, or payment webhook; all orders remain pending until an authorized operator confirms receipt.
5. **Confirm tax and delivery policy.** The current server tax rate is a fixed 8% and shipping cost is $0. Pending orders reserve inventory for 24 hours and are then cancelled with stock/points/coupon use released by the scheduled `expirePendingOrders` function. The business must confirm the correct tax rules and supported delivery regions, then update the server policy and customer-facing terms/copy accordingly. Do not rely on the browser's estimate as a tax determination.
6. **Gift-card control.** Customer-created gift cards are inactive until an administrator verifies payment and activates them. Activation currently requires contacting the recipient using the stored order details; there is no automatic email-delivery backend. Use the admin dashboard's “Activate after payment” action only after cleared funds.
7. **Deploy backend before storefront.** Deploy Cloud Functions and Firestore rules before enabling the changed checkout UI. Confirm the functions are in `us-central1` and execute smoke tests using test accounts, test inventory, and non-production wallet/payment details. Do not use real customer data for smoke testing.

## Remaining external integrations / known limits

- No automated payment provider/webhook, refund processor, carrier fulfillment, dynamic sales-tax service, or transactional email service is configured in this repository. Manual operations are explicit and payment status cannot be self-confirmed by a browser return page.
- Admin can record a completed full refund after funds are returned outside the site. This marks the order as refunded and removes it from paid-revenue totals; it does not initiate or transfer funds. Partial refunds are not supported by this recorder.
- Checkout receipts are limited to 200 KB and currently stored in the Firestore order document. A production storage bucket with private access and retention controls is preferable before receipt volume grows.
- Customer forms and newsletter signups still include direct browser-side Firestore submissions. Their rules validate payload shape, but abuse monitoring/App Check and retention procedures need a project-level decision. Public review and Q&A read callables are IP-rate-limited to 60 requests per 15-minute window per source IP; this is a basic abuse control, not a substitute for App Check or monitoring.
- Account deletion requests are recorded in the admin-only `accountDeletionRequests` collection and surfaced in the Admin → Contacts tab. An authorized operator must review each request, determine legally required order/tax retention, complete deletion through the approved process, and only then mark it reviewed. The callable does not automatically delete Auth or Firestore records.
- Reward activity is append-only in `rewardsLedger`; balances are changed only by trusted functions/admin-callable adjustments. Review ledger/balance consistency during support investigations.
- The fixed 8% tax and zero shipping amount are interim values, not legal or carrier calculations. Confirm actual jurisdiction, nexus, exemptions, and delivery costs with the business's tax/fulfillment providers.
- The scheduled `expirePendingOrders` function uses Cloud Scheduler and may require a billing-enabled Firebase/Google Cloud plan. The `_publicRateLimits.expiresAt` and `checkoutRequests.expiresAt` TTL policies in `firestore.indexes.json` must be applied. Verify TTL is enabled for both collections in the target project.

## Staging release gate

Do not use production customer data or payment details in staging. Before enabling live checkout:

1. Run `npm --prefix functions run test:rules:emulator`; it exercises role-based reads/writes against Firestore Emulator. CI runs this suite automatically.
2. In a staging Firebase project, smoke-test a customer checkout through order creation, pending-payment display, manual bank/crypto verification, tracking, and a full manual refund record. Verify that no browser action can mark an order paid.
3. Test one account per role. Orders can manage order status/tracking but not verify payment; Finance can verify payments and record completed refunds; Catalog can only change catalog/site merchandising; Support handles customer cases, trade-ins, reviews, and deletion requests; only Owner can read audit history.
4. Load verified on-hand quantities through Admin → Products before testing checkout; unknown inventory defaults to zero. Confirm stock reservations and cancellations with test items.
5. Do not sign off tax/shipping until Stripe Tax registrations/product tax codes and a carrier service/origin/package profile are configured and the returned totals have been reviewed. Do not use the current fixed 8% tax or $0 shipping as U.S. tax/shipping determinations.
6. Test transactional emails only after an email provider is selected and configured through Firebase Secrets. Check pending, paid, cancelled, and refund messages.

The staging checkout/payment/browser journey has not yet been run in this workspace; it requires the selected provider configuration and a staging Firebase project.

## Local validation

```sh
npm ci --prefix functions
npm test --prefix functions
npm run lint --prefix functions
node scripts/check-inline-scripts.js
npm --prefix functions run test:rules:emulator
```

CI runs unit/security tests, the Firestore Emulator rules suite, Functions lint, and inline-script syntax checks. A credentialed browser end-to-end checkout test remains a staging sign-off step.
