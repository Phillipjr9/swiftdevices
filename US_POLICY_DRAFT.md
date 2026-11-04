# SwiftDevices U.S. policy alignment

**Basis:** existing customer-facing copy and checkout behavior in this repository. This document records the policies already stated on the site and the remaining mismatches; it does not add assumed business facts. It is an internal implementation note, not legal or tax advice.

## Current U.S. offer as represented on the website

- **Market and currency:** U.S. delivery addresses; product and checkout prices are in U.S. dollars.
- **Published business/contact details:** support phone `1-800-SWIFT-01`; returns page email `swiftdevices@technologist.com`; checkout bank-payment instructions show `65 Main St, Hastings-On-Hudson, NY 10706, United States`. The bank-instruction address is not independently established as a return address, so it should not be labeled one without confirmation.
- **Standard shipping:** no charge on eligible U.S. orders; stated estimate is 5–7 business days.
- **Express shipping:** stated estimate is 2–3 business days and free on orders of $500 or more.
- **Same-day delivery:** stated as available in select metropolitan areas; confirm availability and any charge with support.
- **Returns:** request within 30 days after delivery; “no questions asked”; item in original condition and packaging with included accessories; free prepaid return labels promised within 24 hours. Refunds are stated as 5–7 business days after receipt and inspection. Gift cards, software/digital content with broken seals, and items damaged by misuse/accident are listed as exclusions.
- **Payment:** cryptocurrency and bank transfer, manually verified. Bank transfer is the only option for orders of $20,000 or more; it is also available below that threshold. An order remains pending until payment is confirmed.
- **Tax disclosure:** checkout currently calculates a flat 8% and labels it “Tax (8%).” This is a description of the current implementation, not confirmation that 8% satisfies every applicable U.S. state and local tax obligation.

## Alignment completed in this branch

- Terms now state the existing standard, express, and same-day delivery claims, note that U.S. availability should be confirmed, and align the refund processing statement to the 5–7 business-day claim already on the Returns page.
- Terms disclose that the current 8% checkout tax is a flat estimate, not a location-specific tax calculation.

## Remaining implementation gaps (do not describe these as working features)

- The checkout code sets shipping cost to $0 and does not select standard, express, or same-day services. Express and same-day delivery promises therefore need real fulfillment/availability handling if they are to be honored.
- Server checkout currently accepts any `US` country address; the UI does not encode a service-area matrix for “eligible U.S. orders” or select metropolitan areas.
- The 8% tax is applied uniformly. A destination-based tax service or a verified configuration based on the seller's actual collection obligations is needed for compliant tax handling. The published disclosure makes the implementation clear but does not cure a tax-compliance gap.
- The Returns page and Support FAQ promise free labels within 24 hours; staff need a process that meets that promise. Terms and Returns copy have been aligned to the site's 5–7 business-day refund statement. Cryptocurrency refunds still require a documented manual process.
- Existing return/contact details are taken from the site. Confirm the return address and warranty/consumer-law exceptions before making further legal changes.

## Source pages inspected

`public/index.html`, `public/support.html`, `public/returns.html`, `public/terms.html`, `public/contact.html`, and `functions/index.js`.
