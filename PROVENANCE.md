# Provenance of this source tree

This repository was not authored from an original source project. It was created on
2026-11-03 by downloading the **deployed output** of the live site
`https://swiftdevices-e2972.web.app/` during a static reverse-engineering audit
(REA 6.8.0, read-only public GETs; no login, no writes).

Served content was last modified `2026-04-01 15:19:58 GMT`. Every file in `public/`
is byte-identical to what the CDN returned:

| File | SHA-256 |
| --- | --- |
| `public/index.html` | `63e7d9729292c8ccbbea5c57e51f466f2055bdc00cd9220e94dd6b95fc782b20` |
| `public/admin.html` | `46448cf417de631669530d3594175faac6535e086f1627e2760cd5d546279948` |
| `public/support.html` | `5195cbfabda1d9234913f9e4a75bba027d1859c0e4ba087a2e54c450fd84303b` |
| `public/tradein.html` | `e2209beb1c98dc1da63752704928402271af4cf73300bc13844e5906b865febf` |
| `public/giftcards.html` | `385c3416a96f55012821fc3d4d759d05c97446d468bf37cd77efdb706da3f7fb` |
| `public/contact.html` | `2bebadc56a5f4080fd01953fb27b0e5b456d62ecdc7f4fc88e453ad17e680d50` |
| `public/payment-success.html` | `d3d279b3ce5aee52dc10d69575353989d8b41470cbba737770a35a4e607f5811` |
| `public/privacy.html` | `6187bb36fdab718c583db63e8ee75214b1388710799b39b28a236ac7e13b0bdb` |
| `public/terms.html` | `9af92bfc04d577a1c1149ede508e80230e816442f5fa58afd5f8a22d4bf7ca24` |
| `public/returns.html` | `58f0d6dbbbdeef47e39ee03baffed603edf9fe54c7e6b6b2752bfc968b04665a` |
| `public/warranty.html` | `9f37d52021a8b0f7ece337c047d0b72d112642973e3c920c0550e90d7bf2e9e5` |
| `public/404.html` | `a8f13ff50ba3adc1003ace9e81732a8b38c225971cdb78e6abcd9c36a6c779b6` |
| `public/sw.js` | `8a3c7b18c32ce7d12da716e78c11b745e92966ae265ce351dc7666239b02a901` |
| `public/manifest.json` | `e8675cc76274897d22d1a7cb3e38419d2c3842a919885683065a998eee07ae08` |
| `public/logo.png` | `53642b92023005dcaf63fbf71200b89a17a5fc070e5855379afe4e0d1a893be6` |

Those digests describe commit `d509987`. Later work on
`feat/thanksgiving-2026-price-cut` edits `public/index.html` and adds
`public/img/*.svg`; files touched there are no longer byte-identical to what the
CDN served, and the table above should be read as the baseline, not the branch.

### Product imagery is vendored, and that is a licensing decision

The imported artifact hotlinked ~90 product photos from
`www.att.com/scmsassets/...` — a carrier CDN that this project does not control.
6 of those assets already returned 404, and in a browser the failure rate was
13/97. `scripts/vendor-images.mjs` downloaded the reachable set into
`public/img/products/` and repointed every reference to `/img/products/...`;
unreachable ones got a labelled "PHOTO PENDING" placeholder, and the iPhone 18 /
Watch Series 12 / AirPods 5 images come from Apple's own image CDN.

These are third-party marketing assets now stored on this project's own origin.
Self-hosting them is a stronger claim on them than hotlinking was. Replacing them
with photography the store owns — or with supplier-approved asset feeds — is the
follow-up, and deleting `public/img/products/` plus reverting that one commit
undoes the vendoring without touching the catalog work.

## What this does not include

- **Firestore security rules.** They are server-side configuration and cannot be
  recovered from a client bundle. No `firestore.rules` file is committed here, and
  its absence is not evidence that the deployed rules are permissive.
- **Firebase Auth settings, App Check, Cloud Functions, and the hosting config** the
  live project actually uses. `firebase.json` here is reconstructed from observed
  response behaviour (`cleanUrls` matches the `301` from `/index.html` to `/`), and
  the `Content-Security-Policy` header value is copied verbatim from the shipped
  `<meta http-equiv>` tag in `index.html`, not invented.
- **The `.git` history of the original project.** The first commit in this repo is an
  import of deployed output, so `git log` will not explain past design decisions.

If you have the real source repository, treat it as authoritative and diff against
this tree rather than merging this tree into it.
