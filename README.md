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
2. Copy `.env.example` to `.env` and fill in Mindbody identifiers (site, service Id, optional pre-issued user token), Cayman Gateway webhook secret, and database connection details. Provide unique values for `ADMIN_SECRET`, `ADMIN_WRITE_SECRET`, `STAFF_SECRET`, and `LINK_SIGNING_SECRET`. If you prefer discrete MySQL fields, remove `DATABASE_URL` and supply `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` instead.
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
# Example environment variables for the Cayman Gateway Mindbody Integration

#Admin Secrets added on admin/config?secret=
ADMIN_SECRET=some-long-random-string-here-admin-front

#Used to authenticate in admin/config page for write operations
ADMIN_WRITE_SECRET=some-long-random-string-here-admin-password

#Do not change this
CAYMAN_API_BASE_URL=https://apidev.caymangateway.com/apiv3

#Change this to your own secret
CAYMAN_WEBHOOK_SECRET=replace-with-cayman-webhook-secret

#Change this to your own database connection string
DATABASE_URL=mysql://user:pass@host:3306/dbname

#Change this to your own secret
LINK_SIGNING_SECRET=replace-with-signing-secret

#Set to true to use Mindbody test environment
MBO_CHECKOUT_TEST=false

#DO NOT CHANGE THIS URL
MINDBODY_BASE_URL=https://api.mindbodyonline.com/public/v6

#Change these to your own Mindbody Site ID
MINDBODY_SITE_ID=-99

#You can leave this as is (or provide a pre-issued user token)
MINDBODY_USER_TOKEN=

#Node environment settings
NODE_ENV=development

#Set to true for production
PM_CONFIG_PRODUCTION=false

#Port to run the server on
PORT=4000

#BACKEND URL HERE
PUBLIC_BASE_URL=https://cg-mindybody-integration-2.onrender.com

#FRONTEND URL HERE
STAFF_FRONTEND_BASE_URL=https://cg-mindybody-integration-front.vercel.app

#Change this to your own secret
STAFF_SECRET=replace-with-staff-secret

#Change these to your own Mindbody credentials
MINDBODY_CAYMAN_PAYMENT_METHOD_ID=25
```

**Notes**

- Mindbody payment method Ids can be queried via `GET /sale/custompaymentmethods` (API key + source credentials required); replace `MINDBODY_CAYMAN_PAYMENT_METHOD_ID` with the Id you plan to use.
- If you want the service to mint Mindbody tokens automatically, leave `MINDBODY_USER_TOKEN` empty and configure source credentials in the admin UI.
- Populate `DATABASE_URL` with your connection string or swap in individual `MYSQL_*` variables if you prefer discrete fields.
- Cayman API key, username, and password values are persisted through the admin UI (`/admin/config`); they do not live in the default `.env` template.

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

