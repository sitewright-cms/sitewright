# Payments (ADR + operator guide)

**Status:** BUILT, on branch `feat/payments-foundation`. Off by default on every instance.

Processed payments for the shop, with the transaction **owned and recorded by the platform** — the
same relationship it already has with contact forms. A payment gateway is a **database record**, not
a repo file: an instance admin authors one (or an MCP agent does), and every project supplies its own
credentials.

| layer | what | where |
|---|---|---|
| catalog | the authoritative price list, harvested from the rendered HTML at publish | `packages/blocks/src/cart-catalog.ts`, `apps/api/src/publish/shop-catalog.ts` |
| stores | transactions, stock ledger, spent webhook events | `apps/api/src/repo/shop-{transactions,stock}.ts`, migration `0030` |
| gateways | the declarative record, its execution, and credential storage | `apps/api/src/payments/*` |
| endpoints | checkout, webhook, status poll | `apps/api/src/http/payment-routes.ts` |
| admin | gateway CRUD, the dry run, per-project keys, the orders inbox | `apps/api/src/http/payment-admin-routes.ts` |
| front end | the `checkout` channel and the thank-you panel | `packages/blocks/src/cart.ts`, `order-status.ts` |

---

## 1. The problem this is built around

`{{sw-add-to-cart}}` writes `data-price` into the markup and `cart.js` totals it in `localStorage`.
That is **client-tamperable by design** — correct for the mini-shop's order *inquiry*, and unusable
as a charge amount.

**So the browser never sends an amount.** It sends `{sku, qty}`; the server re-prices from a snapshot
it produced itself during the publish build. A tampered cart can at worst order a different quantity
of a real product at the real price.

The consequence is worth stating plainly rather than hiding: **a price change becomes chargeable only
after a republish.** That is the honest reading of "what the site published is what you can be
charged for".

### Invariants the catalog holds

- Prices are integer **minor units**, from the **ISO-4217 exponent of the settlement currency** — not
  from `ShopCurrencySchema.decimals`, which is display formatting clamped to `[0,4]`. A wrong
  exponent is a factor-of-100 error in a real charge.
- A price that is **not exactly representable** (`19.999` at two decimals) is a publish error, never a
  rounding. A rounded price is a price nobody authored.
- **One SKU at two different prices anywhere blocks the publish**, naming every offender. Otherwise
  which price is authoritative depends on the order pages happened to render in.
- Only a **publish** writes the `live` snapshot. A draft preview writes `draft`, usable only by a
  test-mode checkout.

---

## 2. The money flow

```
 cart                     platform                         provider        published site
 ────                     ────────                         ────────        ──────────────
 1  {sku,qty}+fields ──▶  gate ladder · re-price · reserve stock · txn=created
                          createCheckout ───────────────▶  hosted page
 2  ◀── {redirectUrl, token, AUTHORITATIVE breakdown}
 3  location.assign ───────────────────────────────────▶   buyer pays
 4                                                         ──▶ returnPath?t=<token>
 5                        ◀── webhook (verified) ─────────
                          idempotent · amount cross-check · txn=paid · stock commits · both mails
 6                        ◀── GET /pay/:project/txn/:token ── thank-you page polls
```

**The webhook is the only truth.** The return URL is a navigation a buyer can forge, so the thank-you
page displays only what the status poll says.

**Reconciliation is what makes that survivable.** A webhook lost to a firewall, an outage or a
misconfigured endpoint would otherwise leave a *paid* order permanently invisible. Every
`created`/`pending` transaction older than ten minutes is asked about directly, in the maintenance
pass (`runPaymentSweeps` in `app.ts`).

Card data never touches the published site or the platform. Hosted redirect only ⇒ SAQ-A.

---

## 3. Gateways live in the database

A gateway is a **declarative record**. The host owns everything that can be lied about:

| the HOST owns | the stored record owns |
|---|---|
| credential substitution — the record writes `${CRED:key}` **placeholders** and never sees a secret | the shape of the provider request |
| **webhook signature verification**, chosen from a host-implemented enum | which scheme, and which header carries the signature |
| HTTPS enforcement + the **admin-owned origin allowlist** | response paths for `ref` and `redirectUrl` |
| the authoritative amount — passed in; a body that disagrees is refused | the event-kind mapping |
| idempotency, every database write, retry and reconciliation | — |

Two things can never be delegated. A record that implemented its own verification would be trusted to
answer "is this payment real?", and the cheapest implementation returns `true`. And the **origin
allowlist is an admin-only field stored apart from the editable body** — it is the one lever a
mistaken or malicious record would otherwise pull, so the author of a gateway is not the approver of
its destinations.

### There is deliberately no author-supplied regex

`CredentialField` briefly carried a `pattern`, gated by a "safe subset" check. The gate was unsound:
`(a|aa)+` passed it and took **24 seconds** against a 45-character value, on the single event loop
shared by every tenant. Whether an arbitrary regex backtracks catastrophically is not decidable by a
handful of syntactic rules, so the feature is **gone rather than narrowed**. `modePrefix` (a literal
`startsWith`) expresses what mattered, and "is this a well-formed key?" is a question only the
provider can answer — which it already does, via the dry run.

---

## 4. Adding a gateway

A checklist, not a code change. Everything below is data.

1. **Fork the closest built-in.** `POST /admin/payment-gateways/stripe/fork {"id":"acme"}`. Built-ins
   are read-only in place, so the next upgrade cannot overwrite your fix.
2. **Set `apiBase`** for `test` and `live`, and list every origin the gateway may reach or send a
   buyer to in **`allowedOrigins`**. The API bases must be inside it — the schema refuses otherwise,
   because an allowlist that does not cover the request is decorative.
3. **Declare `credentialFields`.** These become the project's form, with no editor work:
   `key`, `label`, `kind` (`secret`/`public`/`choice`/`bool`), `required`, `perMode`, `hint`,
   `docsUrl`, `maxLength`, `modePrefix`.
4. **Write `checkout.request`** with `${CRED:…}`, `${AMOUNT:minor|decimal|currency}`,
   `${TXN:id|token|reference}`, `${URL:return|cancel|webhook}`, `${FIELD:<name>}`, `${TEXT:order_name}`.
   `${#AMOUNT:minor}` yields a JSON *number*. An unknown token is an error, not a blank — the field
   most likely to be silently blanked is the amount.
5. **Point `refPath` and `redirectUrlPath`** at the session id and the hosted URL in the response.
6. **Choose a `verification` scheme**: `hmac-sha256-header`, `hmac-timestamped`, or `remote-verify`.
7. **Map events**: `refPath`, `typePath`, and `types` → `paid|failed|expired|cancelled|refunded|recheck`.
   Use **`recheck`** when the webhook body does not itself prove payment (Mollie sends only an id);
   mapping that to `paid` would accept an unpaid order on an attacker's say-so.
8. **Add `status`** so reconciliation and `recheck` can re-read the truth.
9. **Enable it**, then **prove it**: `POST /admin/payment-gateways/acme/verify` with a project that
   has test credentials. This performs a **real test-mode checkout** — a template can be
   syntactically perfect and still produce a request the provider rejects. A gateway cannot take live
   money until this has succeeded, and **any edit clears the flag**.

An agent can do all of this with the opt-in `payments:provider:write` capability. It deliberately
cannot touch a **project's** keys: those are session-only, because an agent that can mint a live key
into a project can redirect that project's revenue.

---

## 5. Stock: who owns the number

`on_stock` is what the **author** declared (`stock=` on a buy button); `sold` is the **platform's**.
A publish rewrites `on_stock` **only when the authored value changed** — an explicit restock. An
unrelated republish must never reset a sold-down quantity, or the first price refresh silently
restocks everything that had sold out.

Units are **reserved** across the redirect so two buyers cannot both be sold the last one, released if
the provider never opens a session, and committed on a verified `paid`. A **preview checkout touches
the ledger not at all** — it holds nothing and commits nothing, so an author testing checkout cannot
make a SKU unavailable to real buyers.

---

## 6. Authoring the shop chrome

The cart runtime **binds** rather than builds. An empty `{{sw-cart}}` gets the platform drawer exactly
as before; `{{#sw-cart}}…{{/sw-cart}}` wraps your own markup and the runtime binds to that and builds
nothing.

- Parts: `toggle count drawer close items line-template empty foot total sent-msg clear`
- Fields (inside the line template): `name price qty subtotal image`
- Actions: `open close clear inc dec remove channel:<key>`

`drawer`, `items` and `line-template` are required. Anything else you leave out is a feature you left
out — nothing is injected to compensate. Lines are filled with `textContent` only, which is what lets
a line be fully author-controlled without becoming a markup sink.

Fork the global **`cart-drawer`** snippet and the **`thank-you`** template to start from the defaults.
The publish warns (never fails) about a fork that has lost a required part or names a channel the shop
no longer configures.

`website.shop.platformCartStyles: false` ships no cart CSS at all. Your CSS already wins without it —
the platform sheet sits before `criticalCss` — so this is for a drawer forked far enough that those
rules are things you keep undoing.

---

## 7. Notifications

Two **independent** deliveries per order, with their own state, attempts and claim. A merchant address
that bounces must not block the buyer's receipt, and retrying one must never re-send the other.

The mail render context is **enumerated** — order, buyer, shop name — and never the settings bundle,
which holds the SMTP password and every payment credential. Both bodies are multipart (HTML plus a
text part), and a **test order says so in the subject and the body**.

---

## 8. Operating it

- `paymentsEnabled` is an instance setting, **off by default**. The routes are not registered at all
  without `SW_ENCRYPTION_KEY`.
- Paste the webhook URL (shown in **Settings → Website → Payments**) into the provider's dashboard.
  Without it a payment still succeeds, but the shop hears about it only when reconciliation asks —
  so orders arrive late.
- The orders inbox carries the undelivered banner, because emailing somebody about broken email is
  circular.

### Explicitly out of scope

Tax *determination* (one project rate, displayed — no OSS thresholds or per-country rates), invoicing,
multi-currency, saved cards, subscriptions, marketplaces and shipping-rate calculation.
