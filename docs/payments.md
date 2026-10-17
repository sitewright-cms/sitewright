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

## 2b. Markets — several currencies, one price list each

A shop may sell in several **markets** (`website.shop.markets`, the first the default): each has a
currency, the countries it ships to (or `restOfWorld` — every country no other market claims), a
default language, its own `pricing` (shipping + one tax rate) and the checkout channels — the
providers — it offers.

- **Prices are entered per market, never converted.** `{{sw-add-to-cart prices=…}}` writes every
  market's price on the button (`data-prices`); the publish seals **one price list per market**
  (`shop_catalog` keyed by project + mode + market), each in its currency. A market with no price for
  a SKU does not sell it; a plain `price=` sells in the default market only. One SKU at two prices
  WITHIN a market still blocks the publish. A publish REPLACES the mode's lists whole, so a removed
  market leaves nothing chargeable.
- **The market is chosen in the browser** (a static site has no server per request): the visitor's own
  choice, else the page language (the browser region deciding between markets sharing it), else the
  region, else the default. One cart per market, so a basket never mixes currencies.
- **The server re-checks everything at checkout**: the request names `market` and `shipTo`; the
  market must exist, offer the channel, and ship to the country (a rest-of-world market never ships
  to a country another market claims). The charge uses that market's sealed list, currency and
  pricing; a gateway that declares `currencies` without the market's is refused before anything is
  held. The order records `market` and `ship_country`. Stock stays per SKU across markets.
- **The ship-to country is the buyer's declaration.** The built-in gateways collect no address, so
  the platform asks for the country and holds it to the market — but it cannot see where the parcel
  really goes. Both order mails lead with *Ship to*; a merchant ships only there (and refunds an order
  whose address field names somewhere else).
- `channels: []` is a market with **no online checkout** (its WhatsApp/e-mail/form channels still
  work); leaving `channels` out offers every checkout channel.
- **A price list that cannot be stored fails closed.** If writing a publish's lists fails, the mode's
  lists are deleted: checkout then refuses ("no published price list yet") until the next publish,
  rather than charging the previous prices for a page that now shows new ones.

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
9. **Enable it**, then **prove it**: `POST /projects/<id>/payment/verify` with `{ gatewayId }`, from
   a project that has test credentials — or the **Prove it works** button in that project's payment
   credentials dialog. This performs a **real test-mode checkout** — a template can be syntactically
   perfect and still produce a request the provider rejects. A gateway cannot take live money until
   this has succeeded, and **any edit clears the flag**.

   ★ The project is a **path** parameter, and the caller must be both a writer of that project (by
   session, so no bearer token reaches it) and entitled to author gateways. It used to take the
   project in the request *body* and trust it, which let one caller spend another tenant's stored
   credentials against their real provider account. Each gate covers a different half: a project
   writer must not mark a definition proven for every tenant, and a gateway author must not spend a
   tenant's secret.

An agent can do all of this — except the dry run, which is session-only — with the opt-in
`payments:provider:write` capability, **and only when the key's owner is an instance admin**. Over MCP
that is `list_gateway_definitions`, `fork_gateway_definition`, `put_gateway_definition` and
`delete_gateway_definition`, with the walk-through in `get_guide("payments")`. Instance admins see the
capability on the API-key and member-token forms; the OAuth consent screen offers it unticked. The
capability alone is not enough: an API key is bound to one project and may be minted by that
project's owner at any role, while a gateway definition is instance-wide infrastructure. It deliberately
cannot touch a **project's** keys: those are session-only, because an agent that can mint a live key
into a project can redirect that project's revenue.

★ **What a token may not do to a definition** (a person on a session may do all of it):
- **Change a LIVE gateway** — enabled *and* proven — or delete one. Every write clears `verified`, so an
  edit in place would stop live checkout in every project charging through it. A token forks instead;
  the fork carries no live traffic until a person proves it and the projects' channels are switched.
- **Change a definition any project holds keys for** — none of it, not just its hosts: a request body
  tells the provider what to do with the keys, and a provider calls the return and webhook URLs it is
  handed, so a template is as much a way out as `apiBase`. Nor delete it. Keys are filed under the gateway
  **id** and outlive a deleted definition, so a token may not create or fork a definition onto an id that
  projects hold keys under either. The create → prove → fix loop goes through a person removing that
  project's keys (or a fork to a new id).

Deleting a custom gateway is refused, for anybody, while an order through it is still open in any
project — its webhook could no longer be verified.

★ **The proof shows what it approves, and stamps only what it proved.** Instance admins see enabled but
unproven gateways in a project's payment keys dialog (so a new one can get test keys and be proven
without a raw API call), and for the gateway in view the dialog names where its keys go (`apiBase`),
where buyers may be sent (`allowedOrigins`) and which provider events count an order as paid — and says
in red when those addresses differ from the built-in it was forked from or is named like. A definition edited while the dry run is at the provider is
**not** marked proven (409, `reason: "changed"`).

★ **A definition is linted where its author can still fix it** (any author, person or token):
- Every `${…}` in a request template must be one the host substitutes — `CRED` naming a declared
  credential field, `AMOUNT`/`TXN`/`URL` with a known key, `FIELD`/`TEXT` (these two resolve a missing
  key to an empty string) — and `${#…}` only as a whole body value; anything else used to be sent to the
  provider as literal text.
- A **secret** field reaches the provider only through `auth` (every built-in) or as a request header —
  the whole value, or after `Bearer `/`Basic `/`Token ` — never in a body, path or query, and never next to
  other placeholders: a provider may print body fields on its hosted checkout page, where any buyer reads
  them, and calls the return and webhook addresses it is handed.
- A **non-secret** field may be a whole body value or a path segment — never part of longer text, a body
  field name or a query string.
- A literal `http(s)://` or `//host` address in a template (body, header or path) must be on
  `allowedOrigins`; the shop's own come from `${URL:…}`.
- The admin dialog compares a definition's addresses only with what the platform SHIPS for a built-in
  id (`shipped` on `GET /admin/payment-gateways`) — not with the stored record at that id, which a proof
  rewrites, and not with whatever `forkedFrom` names, which the author sets.
- The fields used for webhook verification and request auth must be `secret` fields.
- `apiBase` and `allowedOrigins` must be public hosts (no localhost, `.local`, `.internal`, single-label
  names or private/loopback/link-local literals, trailing dot or not). The lint judges the NAME; the
  transport (`apps/api/src/payments/provider-fetch.ts`) judges where it LEADS. Every provider call
  resolves the host once, refuses it if any address is private or it does not resolve, connects to the
  checked address (the real name still drives SNI and the certificate check), and never follows a
  redirect: a 3xx fails the call as "a redirect, which is never followed". It tries the next address only
  when the connection never came up, so a refund that may have arrived is never sent twice.

**What an agent can read about a project's payments.** `GET /projects/<id>/payment-gateways`
(`content:read`, MCP `list_payment_providers`) lists the offered gateways and, per gateway, `keys`:
which mode the project transacts in and, for test and live, whether every required key is present and
the NAMES of the missing ones — never a value or a mask. `channels` names the checkout channels using
it, `problems` lists in plain sentences what would stop a channel taking a payment in the mode it is in
(an unknown or disabled gateway; missing keys; live mode on an unproven gateway; a market charging a
currency its gateway does not take), and `notes` what is true but not a failure (a channel taking test
payments only). The keys themselves stay behind the session-only routes.

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

## 8. Refunds

`POST /projects/<id>/transactions/<txn>/refund`, or the **Refund…** control on an order in the inbox.
`amountMinor` is optional and defaults to everything still outstanding; `restock` is explicit and
defaults to false. The order settles to `refunded` or `partially_refunded` from the BALANCE, so two
partials that happen to close it out settle correctly without anyone noticing that they did.

**Session-only, like the credential routes.** Every other operator action moves a label; this one
moves money out of the merchant's account, and `content:write` is handed to agents routinely. A human
with the project's writer role does this, in a browser.

### ★★ Claim first, then call the provider

The order of those two steps is the whole design, and it is not interchangeable:

- **Refund, then record** has a window where a crash leaves the provider having paid the customer and
  the platform believing it did not — so an operator refunds again and the shop is out twice.
- **Claim, then refund** inverts it: a crash leaves the balance looking *more* spent than it is,
  which refuses a further refund until somebody looks.

Both are wrong; only one of them loses money. The claim is a conditional `UPDATE` whose `WHERE`
carries both the legal statuses and `refunded_minor + amount <= total_minor`, so no set of concurrent
refunds can sum past the order. (Measured: move that check out of the `WHERE` and two overlapping
claims both win, doubling the balance — `payments-refund.test.ts` pins it.)

A failure is rolled back **only when the provider definitely refused**: a `config` error (nothing was
ever sent) or a 4xx (it looked and said no). A timeout, a 5xx or an unreadable reply may mean the
refund *happened*, so the claim stands and the operator is told to check the dashboard.

### What a refund refuses to attempt

A preview order (never took money), a gateway with no `refund` template, an order taken through a
gateway the project no longer holds keys for, and an order whose mode no longer matches that
provider's — refunding a live payment with test credentials reaches a provider that has never heard of it.

### Restocking is the operator's call

A refund is a money event and says nothing about whether the goods came back sellable: a returned
unopened order should restock, a damaged one must not, and a goodwill partial involves no goods at
all. The platform cannot tell those apart, so it never guesses — `restock` is a checkbox, unticked.

### A refund issued in the provider's dashboard

Merchants do this. A `refunded` webhook event carries an amount when the provider reports one, and
that amount decides full vs partial: marking an order fully refunded because €5 of €50 came back
tells the shop it owes nothing more and hides the other €45. An event with no amount means the whole
outstanding balance, and a repeated event cannot drive the balance past the order.

## 9. Operating it

- `paymentsEnabled` is an instance setting, **off by default**. The routes are not registered at all
  without `SW_ENCRYPTION_KEY`.
- Paste the webhook URL (shown in **Settings → Website → Payments**) into the provider's dashboard.
  Without it a payment still succeeds, but the shop hears about it only when reconciliation asks —
  so orders arrive late.
- **A project may hold keys for several providers.** Each `checkout` channel names the gateway it
  charges through (`gatewayId`), and each provider has its own credentials row (`project_payment`,
  keyed by gateway id), its own test/live mode, its own proof and its own webhook URL
  (`/pay/<project>/webhook/<gateway>`). Webhooks, reconciliation and refunds always use the ORDER's
  gateway, never "the project's". Removing a provider's keys is refused while a channel still uses it.
  The single row older projects stored (`project_payment/settings`) is still read, and is rewritten
  under its gateway id the next time those keys are saved.
- The orders inbox carries the undelivered banner, because emailing somebody about broken email is
  circular.
- **Agents run orders over MCP**: `list_orders` / `get_order` (`content:read`; the buyer's order-page
  token is withheld from the agent; each row carries `notifyState` / `receiptState`) and
  `set_order_fulfilment` / `resend_order_mail` (`content:write`). A token is held tighter than a person in
  the inbox: it moves fulfilment only on a paid order, and resends only a mail that `failed` or was
  `abandoned` — a person may re-send a delivered receipt on purpose, a looping agent would mail every
  buyer twice. Refunds have no MCP tool, by design.

### Explicitly out of scope

Tax *determination* (one rate per market, displayed — no OSS thresholds or per-country rates within a
market), invoicing, currency conversion (prices are entered per market), saved cards, subscriptions,
marketplaces and shipping-rate calculation.

## What broke, and where to look first

Two defects in this module were invisible to a full green test suite, and both are shapes rather
than typos. If something here "cannot be reproduced but users report it", start with these.

**The page never got the channel.** `template.ts` projects shop channels into the `data-channels`
attribute, and that projection is a `switch` on `kind` with a `return null` default. A channel kind
with no branch is silently dropped, so the runtime sees nothing and renders no button — while every
cart test still passes, because they all set `data-channels` by hand. Any new channel kind needs a
branch there AND a case in `cart-rendered-checkout.behavior.test.ts`, which is the one test that
renders with the real helper and runs the real runtime against the output.

**The webhook's raw body.** Signature verification MUST see the bytes as sent. The raw-body parser is
registered on an encapsulated Fastify scope, and the route must be registered **on that same scope** —
`scope.post`, never `app.post`. Get it wrong and the route silently falls back to the global JSON
parser, the handler re-serializes `req.body`, and compact provider JSON still verifies by luck while
pretty-printed JSON gets a 400 that is indistinguishable from a bad secret. The E2E case that proves
this posts pretty-printed bytes with a correct signature; a test that only checks a *bad* signature
is refused proves nothing.

