# SwiftDevices U.S. policy draft

**Status: internal draft — not customer-facing and not legal/tax advice.** These are recommended operating defaults for review by the business owner and, where appropriate, U.S. counsel and a sales-tax professional. Do not publish or deploy this draft until the operating details are confirmed and checkout implements them accurately.

## Recommended initial scope

- Sell and ship in U.S. dollars to verified U.S. street addresses only.
- Start with the contiguous 48 states. Do not accept Alaska, Hawaii, U.S. territories, APO/FPO, or international addresses until carrier coverage, rates, delivery expectations, and tax handling are confirmed. The current server only checks that country is `US`; it does **not** enforce this proposed state/address restriction.
- Keep orders in `pending` status until the selected bank-transfer or cryptocurrency payment has been independently verified. A receipt, transaction hash, or browser return is not proof of payment. Do not dispatch before verification.

## Shipping and delivery — proposed customer wording

> **U.S. shipping.** SwiftDevices currently offers standard shipping at no charge to eligible addresses in the contiguous United States. We will confirm service availability and any delivery estimate before accepting an order. Delivery estimates are not guaranteed. We will provide tracking information after an order is dispatched. We do not currently ship to Alaska, Hawaii, U.S. territories, APO/FPO addresses, or international destinations. Orders remain pending until payment is verified. Contact support before ordering if you are unsure whether an address is eligible.

**Operational requirements before publishing:** configure the checkout to reject unsupported destinations; verify that free shipping is financially sustainable; define order handling and carrier handoff; add an actual support contact and an honest delivery estimate if one can be maintained. Keep shipping charges at $0 only if the business approves absorbing those costs.

## Sales tax — must be configured before accepting orders

> **Taxes.** Any applicable sales tax will be calculated from the delivery address and the items in the order, shown before the customer places the order, and collected/remitted as required by law.

This wording is only appropriate after a tax professional or approved tax provider has established where SwiftDevices has collection obligations and checkout calculates the correct destination- and product-specific amount. The current single 8% rate is not a U.S.-wide tax calculation and must not be described as one. Do not replace it with a guessed rate or zero rate. Until correct calculation is implemented, pause U.S. checkout or obtain a documented, state-specific configuration from the business's tax adviser.

## Returns and refunds — proposed baseline for owner review

> **Requesting a return.** Contact SwiftDevices support with your order number within 30 calendar days after delivery. Wait for a return authorization and instructions before sending anything back. Unless an item arrived damaged, defective, or incorrect, the item should be returned in resalable condition with its included accessories and packaging. We will explain any return-shipping charge before the return is sent. For an item that arrived damaged, defective, or incorrect, contact us promptly so we can investigate and provide appropriate next steps.
>
> **Refunds.** After an authorized return is received and inspected, we will confirm the outcome and process an approved refund using a method appropriate to the original payment. Processing and bank posting times vary. If the original payment was cryptocurrency or manual bank transfer, support will explain the refund method and timing before the refund is initiated. Any non-returnable categories or deductions will be disclosed before purchase and applied only as permitted by law.

This removes unsupported guarantees of prepaid labels within 24 hours and fixed refund timing. The current website's exact return eligibility, fees, inspection process, payment-refund process, and legal exceptions need owner/counsel approval before replacing the published page.

## Payment status — proposed wording

> Bank transfers and cryptocurrency payments are reviewed manually. Your order is not paid or ready to ship until SwiftDevices independently confirms receipt. A submitted receipt, transaction hash, or visit to a return page does not itself confirm payment. Cryptocurrency transfers may be irreversible once sent; verify the amount, network, and destination with support before paying.

Only list payment methods that the business can actually receive and reconcile. Do not promise a refund path for a payment method until that procedure has been tested.

## What must be confirmed before turning this draft into live pages

1. Legal seller name, business address, support email/phone, and return address.
2. Whether free standard shipping is approved, exact serviceable states/ZIP codes, excluded address types, carrier, and realistic delivery estimate.
3. The seller's tax registration/nexus footprint, taxable catalog categories, and approved destination-based checkout tax solution/rates.
4. Return window, item-condition rules, return-label payer, exceptions required by law, inspection workflow, refund method, and realistic processing target.
5. Which payment methods remain enabled and the documented verification, cancellation, and refund steps for each.

## Current repository gaps this draft is intended to resolve

- Checkout currently charges a flat 8% tax and $0 shipping; neither is validated against actual U.S. jurisdictions or carrier costs.
- The backend accepts any address with country `US`; state/ZIP service-area restrictions are not enforced.
- The public Returns page promises 30-day full refunds, free return labels within 24 hours, and 5–7 business-day refunds; Terms says 5–10 business days. Those commitments are not backed by an automated return-label/refund workflow and should not be published unless staff can reliably meet them.
- Terms says delivery estimates are guidelines but does not provide a verified estimate or fully define serviceable U.S. locations.
