# Store operations and launch readiness

Order creation and payment-status operations run through trusted Cloud Functions. Checkout stays blocked until an Owner saves and enables the manual pricing configuration in **Admin → Settings → Checkout Tax & Shipping**. The Owner may disable checkout there at any time.

The pricing controls use one flat manual U.S. sales-tax rate and one flat shipping charge. Tax is applied to discounted merchandise; shipping is excluded from the taxable amount. The settings are not destination-specific tax calculations, a determination of nexus or registration obligations, or live carrier rates. An Owner must verify the business-approved values and their legal and operational suitability before enabling checkout. Do not use placeholder amounts. The website does not currently integrate Stripe Tax or FedEx rates; transactional email setup remains deferred.

## Before enabling checkout

1. **Confirm actual inventory.** Unknown stock should remain unavailable. Enter verified stock through Admin → Products and verify stock reservations and the 24-hour pending-order expiration behavior.
2. **Review payment operations.** Bank transfers and cryptocurrency are manually verified. Configure and test actual crypto wallet destinations through Admin → Settings, confirm authorized Finance/Owner reviewers, and document reconciliation procedures. No payment processor or automated payment verification is configured.
3. **Set approved manual tax and shipping.** As an Owner, enter the approved flat percentage and USD shipping charge in Admin → Settings → Checkout Tax & Shipping. This storefront-wide flat tax does not vary by state or destination; confirm it is appropriate for the business before enabling checkout. Shipping is a flat fee, not carrier-rated. Review customer-facing policies and billing output with the actual amounts.
4. **Test customer and operator flows in staging.** Verify totals against server quotes, inventory reservation, pending payments, paid/refunded records, cancellation/expiration, shipment tracking, and staff-role restrictions. Ensure bank/crypto payment evidence is handled under the documented manual process.
5. **Configure transactional email later** with the chosen provider and test order, payment, shipment, refund, and account emails. Do not represent email as operational until delivered and verified.
6. **Verify Firestore rules and deployment checks.** Run the rules suite against the Firestore Emulator and confirm CI. Deploy only through the authorized release process after staging sign-off.

## Admin roles and controls

- **Owner** (`admin: true` legacy custom claim): all Admin controls, staff role assignment, checkout pricing configuration, and sensitive settings.
- **Orders**: order and fulfillment operations.
- **Catalog**: products, stock, promotions, and catalog content.
- **Finance**: payment verification, refund recording, rewards, gift cards, coupons, and finance data.
- **Support**: customer inquiries, reviews, and support workflows.

Manual refund records document an off-platform full refund; they do not transfer funds or restore stock. Customer account deletion remains a manual, retention-aware review and must not automatically delete Auth or Firestore records.

## Known launch blockers

- No tax engine, jurisdiction-specific rate table, or tax registration configuration; the flat manual tax is only the value the Owner explicitly approves.
- No carrier integration or live delivery quotes; shipping is the Owner-entered flat amount.
- No payment processor, automatic bank reconciliation, or automatic crypto verification.
- No configured transactional email provider.
- Real inventory and authorized operator identities must be verified in production.
