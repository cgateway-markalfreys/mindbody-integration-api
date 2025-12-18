# Cayman Mindbody Integration

Production-ready Node.js, Express, and TypeScript service that bridges Cayman Gateway payments with Mindbody transactions. It accepts hosted checkout webhooks, normalizes payloads, posts Mindbody sales, and offers helper utilities for generating signed storefront links.

## Features

- Normalize Cayman Gateway webhook payloads and record Mindbody sales with Cayman transaction metadata.
- Provide `/store`, `/paylinks`, and `/staff` route groups for hosted checkout, buy-now links, and staff-assisted payments.
- Persist Cayman credentials and configuration in MySQL via an admin endpoint protected by `ADMIN_SECRET`.
- Run smoke tests against Mindbody’s sandbox with `MBO_CHECKOUT_TEST` safeguards.

## Prerequisites

- Node.js 20+
- MySQL 8+ instance
- Mindbody sandbox credentials (site ID, API key, source name, source password, optional pre-issued user token)
- Cayman Gateway API credentials (base URL, API key, username, password, webhook secret)

## Getting Started

1. Install dependencies:
  ```powershell
  npm install
  ```
2. Copy `env.local.example` to `.env` (or start from `.env.example` if you prefer a minimal template) and fill in Mindbody identifiers (site, service Id, API key, source credentials or user token), Cayman Gateway credentials, and database access. You can supply either a unified `DATABASE_URL` (for example `mysql://user:pass@host:3306/dbname`) or discrete connection fields (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`). Set distinct secrets for `ADMIN_SECRET`, `ADMIN_WRITE_SECRET`, `STAFF_SECRET`, plus a unique `LINK_SIGNING_SECRET`.
3. Initialize MySQL schema and seed row:
  ```powershell
  mysql -u <user> -p <database> < schema.sql
  ```
  This script creates the `api_configs` table and inserts a placeholder config that the admin UI will overwrite once you save credentials.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the API with `tsx` in watch mode (rebuilds on change). |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Serve the built JavaScript from `dist/`. |
| `npm run test:smoke` | Run the store checkout smoke test (uses `MBO_CHECKOUT_TEST=true`). |
| `npx tsx src/index.ts` | Execute the entry point without running the build step. |
| `npx tsx scripts/link-builder.ts <productId> [qty]` | Generate signed buy-now links for store flows. |

The service listens on `PORT` (default `4000`). Hit `GET /` for a basic health check.

## Store Checkout Flow

1. Provision `.env` with Cayman + Mindbody credentials and a long `HMAC_SECRET` value.
2. Start the API: `npm run dev`.
3. Generate a signed buy-now link with the link builder script.
4. Trigger the checkout via the hosted script snippet shown below or by calling `/v1/checkout/sessions` directly.
5. Keep `MBO_CHECKOUT_TEST=true` until you are ready to create visible Mindbody receipts, then switch to `false`.

## Webhook Flow

1. Receive Cayman Gateway webhook `POST /webhook/cayman` containing `{ email, firstName, lastName, amount, ... }`.
2. Create or update the Mindbody client via `client/addclient`.
3. Call `sale/checkoutshoppingcart` to post the sale using Cayman transaction metadata.

> Update the sample cart items in `src/controllers/caymanWebhookController.ts` to match the SKUs configured in your Mindbody environment.

## Mindbody Service Configuration

- Set `MINDBODY_SERVICE_ID` to an Id returned by `/sale/services`.
- Ensure the Mindbody service metadata includes a key `id`; Cayman uses it to match products.
- If you need a specific Mindbody payment method, set `MINDBODY_CAYMAN_PAYMENT_METHOD_ID` to that method’s Id.
- Mindbody’s `CreditCard` payment type requires `Metadata.creditCardNumber`, `Metadata.creditCardExpMonth`, and `Metadata.creditCardExpYear`. Missing fields cause `InvalidParameter` responses; the service patches masked values from Cayman when available.

## Cayman Gateway Support

- Proxy Cayman three-step and ancillary API calls by POSTing to `/cayman/three-step` with `{ operation, payload }` mirroring Cayman’s schema.
- Normalize Cayman webhook payloads (hyphenated keys, `result-code` validations) before handing them to Mindbody integrations.
- Manage stored Cayman credentials via `GET /admin/config?secret=YOUR_ADMIN_SECRET`; records persist in MySQL.

## Mindbody Authentication Tips

- To mint a Mindbody user token automatically, provide `MINDBODY_SOURCE_NAME` and `MINDBODY_SOURCE_PASSWORD` and leave `MINDBODY_USER_TOKEN` unset.
- To reuse an existing token, set `MINDBODY_USER_TOKEN` and omit the source credentials; all requests reuse that token until it expires.

## Hosted “Buy with Cayman” Flow

### Environment Variables (exact names)

```dotenv
# --- Admin authentication secrets ---
ADMIN_SECRET=replace-with-long-random-string
ADMIN_WRITE_SECRET=replace-with-long-random-string
STAFF_SECRET=replace-with-long-random-string

# --- Public URLs ---
PUBLIC_BASE_URL=http://localhost:4000
APP_BASE_URL=http://localhost:4000
STAFF_FRONTEND_BASE_URL=https://your-staff-frontend.example.com

# --- Cayman Gateway API ---
CAYMAN_API_BASE_URL=https://apidev.caymangateway.com/apiv3
CAYMAN_API_KEY=replace-with-cayman-api-key
CAYMAN_API_USERNAME=replace-with-cayman-username
CAYMAN_API_PASSWORD=replace-with-cayman-password
CAYMAN_WEBHOOK_SECRET=replace-with-cayman-webhook-secret

# --- Mindbody API ---
MINDBODY_BASE_URL=https://api.mindbodyonline.com/public/v6
MINDBODY_SITE_ID=-99
MINDBODY_SERVICE_ID=
MINDBODY_API_KEY=replace-with-mindbody-api-key
MINDBODY_SOURCE_NAME=_YourMindbodySourceName
MINDBODY_SOURCE_PASSWORD=replace-with-mindbody-source-password
MINDBODY_USER_TOKEN=
MINDBODY_CAYMAN_PAYMENT_METHOD_ID=25

# --- Database configuration ---
DATABASE_URL=mysql://user:pass@host:3306/dbname
# MYSQL_HOST=localhost
# MYSQL_PORT=3306
# MYSQL_USER=root
# MYSQL_PASSWORD=
# MYSQL_DATABASE=cg_integration
# MYSQL_POOL_SIZE=10

# --- Signing + feature flags ---
LINK_SIGNING_SECRET=replace-with-signing-secret
MBO_CHECKOUT_TEST=true
PM_CONFIG_PRODUCTION=false
PORT=4000
NODE_ENV=development

# --- Optional Cayman defaults for hosted checkout receipts ---
# CAYMAN_DEFAULT_STREET1=1 Demo Way
# CAYMAN_DEFAULT_STREET2=
# CAYMAN_DEFAULT_CITY=George Town
# CAYMAN_DEFAULT_STATE=
# CAYMAN_DEFAULT_ZIP=KY1-1201
# CAYMAN_DEFAULT_COUNTRY=KY
# CAYMAN_DEFAULT_PHONE=
# CAYMAN_DEFAULT_CURRENCY=USD

# --- Optional credential management settings ---
# API_CONFIG_SITE_KEY=default
# API_CONFIG_REFRESH_INTERVAL_MS=30000

# --- Tenants file override (defaults to ./tenants.json) ---
# TENANTS_PATH=./tenants.json
```

**Notes**

- Mindbody requires an underscore prefix in `MINDBODY_SOURCE_NAME`; fetch the account’s service catalog with `/sale/services` to identify the `MINDBODY_SERVICE_ID` you intend to sell.
- Retrieve a custom payment method Id for `MINDBODY_CAYMAN_PAYMENT_METHOD_ID` via `GET /sale/custompaymentmethods` using your Mindbody API key and source credentials.
- `DATABASE_URL` can be replaced with individual `MYSQL_*` variables when you prefer discrete connection values.
- Leave `MINDBODY_USER_TOKEN` blank to let the service mint one using the source credentials; supply a value only when you manage tokens externally.

### Merchant Embed Snippet

```html
<script src="${PUBLIC_BASE_URL}/static/cayman-button.js"
  data-site="YOUR_SITE_KEY"
  data-api="${PUBLIC_BASE_URL}"></script>

<button data-cayman-product="1192" data-qty="1">Buy with Cayman</button>
```

### Flow Overview

1. Shopper clicks the “Buy with Cayman” button. The script posts to `POST /v1/checkout/sessions`.
2. Backend looks up the Mindbody service, creates an in-memory session, and calls Cayman `/hosted/session` to obtain a redirect URL.
3. Shopper completes payment on Cayman’s hosted page.
4. Cayman calls `POST /webhook/cayman`. The integration upserts the Mindbody client and posts a sale through `sale/checkoutshoppingcart` using `MINDBODY_CAYMAN_PAYMENT_METHOD_ID` with Cayman transaction metadata in the receipt notes.

### Testing Notes

- Sandbox testing uses `MINDBODY_SITE_ID=-99`. Keep `MBO_CHECKOUT_TEST=true` for dry runs.
- Run all smoke checks locally with `npm run test:smoke` once the sandbox credentials are in place.
- During development, start the watcher with `npm run dev`, visit `GET /` for a health check, then hit `GET /store/products` before generating test sessions.

