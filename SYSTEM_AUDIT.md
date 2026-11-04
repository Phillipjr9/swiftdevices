# SwiftDevices website and system audit

**Date:** 2026-11-03
**Scope:** Repository-wide static review of the storefront, admin UI, customer-facing pages, Firebase configuration, Cloud Functions, product assets, and available tests. This is an evidence-based code/config audit, not a penetration test or a review of the live Firebase console. No production data was accessed or changed, and nothing was deployed.

## Executive summary

The site has a substantial storefront and customer-facing surface: a 113-item catalog, cart and checkout screens, customer accounts, reviews, rewards, order tracking, support/policy pages, and an admin dashboard. The initial audit found that critical commerce workflows trusted the browser and that Firestore rules were not present in the source tree. This branch adds server-side order/payment state handling, versioned Firestore rules, admin claim enforcement, shared inventory reservation, and related safeguards. Those changes are not deployed; the live Firebase project's rules and configuration remain unverified.

**Recommendation: do not deploy or treat the system as production-ready until the project-specific setup and manual-payment/tax/shipping decisions in `OPERATIONS.md` are completed and tested.** Payment processing is still manual, and the production database/auth configuration cannot be confirmed from this repository.

## Prioritized findings and remediation status

### Implemented in this branch (not deployed)

- Added versioned least-privilege Firestore rules and wired them into `firebase.json`. Production rules still need to be reviewed and tested against the live project's data before deployment.
- Moved order creation, catalog pricing, promo/coupon validation, reward redemption, inventory reservation, payment status lookup, manual payment confirmation, gift-card redemption, and order cancellation/expiry to trusted Cloud Functions. Order IDs are cryptographically random and match their Firestore document IDs; retry requests are idempotent and checked against the original checkout contents.
- Replaced the browser-controlled crypto destination with wallet settings read by the server. A payment-return visit no longer updates order state or reports success without a verified status; users must verify with order number plus email.
- Made unknown inventory default to zero and added transactional inventory reservation/release. A scheduled function expires unpaid orders after 24 hours; actual stock counts must be set by an administrator before products can be purchased.
- Added claim-only admin authorization and a secure local claim-management script. Admin access still requires an operator to assign the claim in the intended Firebase project.
- Restricted customer gift-card requests to pending/inactive records, added a post-payment admin activation action, and moved redemption/reward updates to a callable.
- Removed unverified review badges, escaped customer-provided review/Q&A content, and moved public review/Q&A reads to sanitized, IP-rate-limited callables so email/user IDs in legacy records are not exposed to storefront clients.
- Added backend unit tests, inline-script syntax checks, CI workflow, checkout indexes, and `OPERATIONS.md` deployment prerequisites.

### Still requires project/business decisions or live verification

- Inspect and test the actual deployed Firestore rules/Auth claims before applying repository rules.
- Configure real inventory, wallets, tax treatment, serviceable shipping regions, and operational payment procedures. Tax remains a configurable fixed-rate estimate (8% by default); there is no tax/shipping provider.
- Payments remain manual bank transfer/crypto with no payment provider or webhook, and gift-card recipient email delivery is still manual. Refunds, carrier integrations, and transactional email are not implemented.
- Confirm Cloud Scheduler/TTL availability and billing in the target project; scheduled order expiration depends on it.
- Firebase Emulator rules tests and browser-level checkout/accessibility tests remain release work. The tests in this branch are not a substitute for testing against the target project.


### Initial audit findings (before the branch fixes above)

The entries below describe the code/configuration as first observed during the audit. Their current implementation status is summarized in the remediation section above; live-project verification remains outstanding.

### P0 — Resolve before accepting orders

1. **Firestore access control is absent from this source tree; live protection is unknown.**
   `firebase.json` has Hosting and indexes configuration but no Firestore rules path, and there is no `firestore.rules` file. The repository's provenance notes also explain that the deployed rules cannot be recovered from static site files. The storefront, account, reviews, admin, gift cards, and order flows make direct Firestore reads/writes. Therefore, this checkout cannot establish whether users can read or alter other customers' data or privileged records. **Do not assume the database is open; inspect the live rules and test them with the Firebase Emulator before changing or deploying anything.** Add versioned, least-privilege rules and ensure the deployment process applies them.

2. **Checkout amounts and order state are client-controlled; payment confirmation is not server-verified.**
   `public/index.html` calculates totals and writes order documents directly from the browser (roughly lines 3860–4005). The browser supplies the item prices, discounts, tax, total, payment status, and order contents; no trusted order-creation or payment-verification endpoint/webhook was found. A modified browser can submit different values if database rules permit it. The only Cloud Function found is `trackOrder`.

   **Confirmed payment-success defect:** checkout stores crypto/bank orders with status `awaiting_payment` (`public/index.html` around line 3936), while `public/payment-success.html` only attempts a transition when status is `awaiting_crypto_payment` (around lines 423–430). Regardless of status, after merely finding the order document the page proceeds to display “Payment Successful” and send a confirmation email (around lines 438–445). There is no payment-provider verification in that page. This can mislead customers and staff; with permissive update rules, a direct status update could also falsely confirm an order. Make the server/provider callback the sole authority for payment status and show success only after verified server state.

3. **Admin authorization is partly a browser-side gate, not an authorization boundary.**
   `public/admin.html` contains an email allowlist and also checks a Firebase `admin` custom claim to decide whether to show the dashboard. The dashboard then performs Firestore operations from the browser. Client-side checks can be bypassed; every privileged read/write must also be enforced by Firestore rules or trusted server code using verified claims. Verify the actual custom claims and live rules; remove reliance on an email list embedded in public JavaScript.

### P1 — High priority for reliable operations and customer trust

4. **Inventory is not authoritative or shared between customers.**
   `public/index.html` seeds stock with random values and persists it in each visitor's `localStorage` (around lines 2073–2092). Checkout decrements that local copy, not a transactional server-side inventory record. Customers can see different stock levels; concurrent orders can oversell, and “Only N left”/out-of-stock decisions are not reliable. Move stock to a trusted shared source and reserve/decrement atomically when an order is accepted.

5. **Payment choices are manual, with no automated settlement evidence in the code.**
   Checkout presents cryptocurrency and bank transfer. Crypto transaction hashes and bank receipts are submitted by the customer; the admin UI asks staff to inspect/confirm them. No card processor, payment intent/session, signed callback, or payment webhook was found. This may be an intentional operating model, but it needs explicit staff procedures, reconciliation, refund handling, and customer-facing pending-payment language. Never treat a submitted receipt/hash or return-page visit as proof of funds.

6. **Order IDs and order writes need collision/idempotency protection.**
   The browser generates `SW-` plus six random digits and writes the order under that ID. A collision can overwrite an existing document if the write uses `set`, and retries can produce duplicate orders. Generate IDs server-side, use create-only semantics, and make checkout idempotent.

7. **Customer records and orders need identity-based access rules.**
   Account history is queried by email (`public/index.html`, around line 4675), while order documents contain contact/shipping details. Email is not a sufficient authorization boundary. Bind records to the authenticated UID, query by UID, and write rules that prevent users from reading or editing another customer's records. Confirm that tracking remains privacy-preserving and rate-limited under the live rules.

8. **Pricing, tax, discounts, rewards, and fulfillment need server validation.**
   A fixed `TAX_RATE = 0.08` is used in client code (around line 3213), while shipping/tax promises also appear in marketing and policy text. Discounts/coupons and reward points are client-driven. No shipping-rate/tax service or server-side validation was found. Validate all line items, prices, coupon eligibility, tax, delivery zone/cost, and reward accounting on the trusted side; reconcile the checkout total with the terms and promo copy. Define the actual sales/shipping regions and supported currency clearly.

9. **Product imagery has a third-party availability dependency.**
   Of 113 catalog entries in `public/index.html`, 18 use bundled local assets and 95 still hotlink `www.att.com`. Those image URLs can change, block hotlinking, or fail independently of this site. Prefer product images the retailer has permission to use, store them locally or in controlled object storage, and keep source/licensing records. (The newer bundled images already have a provenance list.)

10. **Customer-submitted forms and public API keys need abuse/privacy controls.**
    Several journeys submit directly from browser code to Firestore or a third-party form service. Client-side validation is useful for UX but is not anti-spam or authoritative validation; public client keys are visible by design and should be restricted/monitored where the provider supports it. Add server-side validation, rate limits/App Check or CAPTCHA as appropriate, file-size/type limits for receipts, and a documented retention/access policy for contact, trade-in, review, and order data. Receipt data embedded in order documents also needs size limits and access controls.

11. **Catalog data contains hard-coded review aggregates that should not become social proof.**
    Product objects include seeded `rating` and `reviews` numbers, but the current review rendering found in the storefront loads actual Firestore review records rather than using those fields. Remove the unused values or clearly source/verify them before displaying them; otherwise a later UI change could present unsupported review totals as real customer feedback.

### P2 — Completeness and maintainability

12. **There is no automated browser-level commerce test suite.**
    The available Functions tests cover the `trackOrder` helper (two tests); the storefront is a large static HTML/JavaScript application. No browser tests were found for mobile navigation, add-to-cart, coupons, account/order history, payment pending/success/failure, receipt upload, admin authorization, or accessibility. Add a small end-to-end suite and Firebase Emulator rules tests before the next commerce release.

13. **Catalog and operational content are maintained in client files.**
    Products, prices, descriptions, payment instructions, and many behaviors are embedded in `public/index.html` and `public/admin.html`. This increases the risk of drift and makes safe price/stock updates dependent on a code release. Move operational catalog data to an authenticated management path with server-side validation and audit history.

14. **Search-engine and accessibility readiness were not demonstrated.**
    The source tree has no `robots.txt` or `sitemap.xml`, and no automated accessibility checks were found. Confirm canonical URLs, indexing rules, product structured data, keyboard/screen-reader behavior, focus handling, contrast, and reduced-motion behavior with dedicated checks. This is an audit gap, not a claim that every page fails accessibility.

15. **Sales promises should be reconciled across pages.**
    Storefront metadata says “Free shipping on all orders,” while the visible banner says free shipping on orders $500+ and terms describe continental-US delivery. Validate the actual checkout shipping calculation and make the same threshold, geography, delivery estimate, and exclusions consistent in metadata, product cards, checkout, and policies. Likewise ensure refund/return promises match what the manual payment process can actually deliver.

## What is present / positive evidence

- The site has dedicated customer-facing support, contact, trade-in, gift-card, returns, warranty, privacy, terms, payment-success, and 404 pages.
- Product IDs in the storefront catalog are unique in the inspected source; local cross-page `href`/`src`/`action` references in the top-level public HTML resolved to existing files in a static check.
- Cloud Functions now cover tracking, checkout, payment status, manual verification, inventory release, gift-card redemption, and sanitized public review/Q&A projections; **14 unit/contract tests pass**, Functions lint passes, and 29 inline scripts pass syntax checks.
- Reviews are currently rendered from stored review records, not the unused catalog rating-count fields.
- Firebase Hosting security headers/CSP are configured in `firebase.json`; they should be reviewed alongside the runtime's actual headers and the live deployment.

## Validation performed and limits

- Inspected the public storefront/admin/support and policy/payment pages, `firebase.json`, Firestore indexes, Cloud Functions, tests, and product assets.
- Checked local top-level public HTML references: **0 missing local targets** in that static scan.
- Current branch validation: **14 Functions tests passed; Functions lint passed; 29 inline scripts syntax-checked; JSON configuration parsed; CRLF-aware diff checks passed.**
- This was not a live Firebase rules/auth/App Check audit, production payment test, full mobile/browser journey, accessibility audit, legal/tax review, or vulnerability scan. The deployed Firebase project may have configuration that is not represented in this repository. The repository provenance explicitly says it was reconstructed from deployed static output and does not include the original backend configuration.

## Remaining release gates

1. Verify the live Firebase project, Firestore rules, Auth claims, TTL policy, and scheduled-function billing before deploying. Test the rules in the Firebase Emulator.
2. Enter verified shared inventory and wallet configuration; exercise checkout, quote-change retry, order expiry/restocking, coupon/points restoration, tracking, and admin payment verification with test accounts.
3. Confirm actual tax jurisdiction/rates, shipping regions/charges, and payment/refund procedures. Add a payment provider/webhook and transactional email if manual operations are not intended.
4. Add browser end-to-end and accessibility coverage, review image licensing/hotlinks, then deploy only after the project operator signs off. **No deployment was performed as part of this audit or remediation.**
