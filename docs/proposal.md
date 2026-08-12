# Sephduema E-Store — Technical Proposal

Living architecture spec for the Sephduema e-commerce platform. Read before starting work; update as decisions land.

## 1. What we're building

Two apps, one Firebase backend:

| App | Framework | Job | SEO / SSR |
| --- | --- | --- | --- |
| `apps/site` | Next.js 16 (App Router), React 19 | Public shop — browse, product pages, cart, checkout, account | **Yes** — this is the SEO-critical, indexable storefront |
| `apps/admin` | Vite + React 19 + react-router v8 | Admin panel — manage products, orders, users | **No** — private tool; CSR only, no SSR/SEO |

Backend as a Service: **Firebase** — Auth, Cloud Firestore, Cloud Storage, Cloud Functions.

Key principle: the site is the *public face* (must be fast and indexable); the admin is an *internal tool* (correctness and speed-to-build matter, not SEO).

## 2. Confirmed decisions

- **Validation**: zod schemas in a new shared package `@repo/schemas`, imported by both apps. Domain types (`Product`, `Order`, `User`, `Address`) are defined once; never duplicated per-app.
- **Admin auth**: Firebase client SDK talks *directly* to Firestore/Storage, gated by a `role: 'admin'` custom claim enforced in security rules. No separate backend needed for the admin.
- **Payments**: WhatsApp (manual, `paymentMethod: 'whatsapp'`) first; Paystack/Flutterwave gateway as the automated upgrade path. See §7.
- **Zod is not yet installed** — installing `zod` in `@repo/schemas` is step 1 of the schema work.

## 3. Firebase integration pattern

The single most important architectural rule — two SDKs, never mixed:

- **Client SDK (`firebase`)** — browser only. Auth UI (`signInWithEmailAndPassword`, Google), `onSnapshot` realtime listeners, admin direct-to-Firestore writes. Governed by Firestore security rules.
- **Admin SDK (`firebase-admin`)** — server only, in site's Server Components / Route Handlers / Cloud Functions. Trusted, bypasses security rules (your code is the authz layer there). Credentials live in non-`NEXT_PUBLIC_` env vars; never import into client components (build fails or leaks secrets).

Guarded singleton init to survive Next.js hot-reload / serverless re-invocation:

```ts
// lib/firebase/admin.ts
import { cert, getApps, getApp, initializeApp } from "firebase-admin/app";

export const adminApp = getApps().length
  ? getApp()
  : initializeApp({ credential: cert({ ...env vars... }) });
```

**Session bridge (site)**: client login → Route Handler calls `admin.auth().createSessionCookie(idToken, { expiresIn })` → sets `httpOnly` cookie → every server render does `verifySessionCookie(cookie, true)` (the `true` checks revocation). Read a fresh `getIdToken()` right before the exchange; ID tokens expire after 1h.

**Runtime constraint**: anything touching the Admin SDK needs the **Node.js runtime** — Server Components / Route Handlers using it cannot run on Edge.

**Cost watch**: `onSnapshot` re-delivers every changed doc per write. Leave listeners mounted only where data must be live (admin order board), not on the public site.

## 4. Site rendering strategy

Next.js 16 infers static vs dynamic from data access. Decide per route:

| Route | Strategy | Why |
| --- | --- | --- |
| Home, marketing, FAQ | Static | Same for all visitors, SEO-critical |
| Product, category, catalog | Cache Components (`use cache` + tag-based revalidation) | Public but changes when admin edits; invalidate by tag |
| Cart, account, orders, checkout | Dynamic + streaming (`Suspense`) | User-specific; cookies()/searchParams make it dynamic anyway |

**On-demand revalidation**: when the admin (or a Cloud Function) edits a product, call a site Route Handler that `revalidateTag("product")`. Simplest wiring: Cloud Function on Firestore write → `fetch(site/revalidate?tag=...)`.

Keep dynamic/authenticated pieces in small Client Components inside otherwise-static pages (e.g. a static product page with a streaming "recommended" section).

The admin app is **100% CSR** — no rendering strategy applies.

## 5. Firestore data model

NoSQL rule: structure data to match queries (no joins; denormalize). Query shape → storage shape.

```
products/{productId}            // public read, admin write
  name, slug, description, price, currency
  categoryId, tags[], images[]
  inventory, isActive, createdAt, updatedAt
  averageRating, reviewCount    // denormalized aggregates

categories/{categoryId}         // public read, admin write
  name, slug, parentId?, imageUrl

users/{uid}                     // owner read/write, admin read
  displayName, email, phone, photoUrl
  role: "customer" | "admin"    // mirrors custom claim for convenience
  createdAt, orderCount, totalSpent   // denormalized counts

orders/{orderId}                // owner read, admin read/write
  userId, userEmail, userName   // denormalized user info
  items: [{ productId, name, priceAtPurchase, imageUrl, qty }]  // snapshot — price history survives catalog edits
  subtotal, shipping, total, currency
  status: pending | confirmed | shipped | delivered | cancelled
  paymentMethod: "whatsapp" | "paystack" | "flutterwave"
  payment: { provider, reference, status }
  shippingAddress, createdAt, updatedAt

users/{uid}/cartItems/{itemId}  // owner-only (or localStorage cart; see below)
  productId, qty
```

Guidance from research:

- **Order items are snapshots**: copy product name/price/image into the order at checkout so historical receipts stay accurate after price changes.
- **Cart**: start with a `localStorage`-backed cart (a store with persist middleware); promote to `users/{uid}/cartItems` when logged-in carts are wanted. Never rely on session storage.
- **Counts/aggregates** (orderCount, averageRating) live on the document, updated in the same `runTransaction` as the thing they count.
- **Composite indexes**: Firestore returns a link to create missing ones on first failing query; track them in `firestore.indexes.json` and deploy with `firebase deploy --only firestore:indexes`.
- **Stock decrement** at checkout must be a `runTransaction` to avoid oversell.
- **Categories** to seed (from TODO): Unisex Jewelry (fashion, steel, gold, vvs moissanite, leather, beads), Unisex Clothing, Fashion Accessories, Bags & Purses, All Footwear, Cosmetics, Perfumes.

## 6. Auth, RBAC, security rules

- **Roles** via Firebase custom claims (`role: 'admin'`), set by a Cloud Function `auth.user().onCreate` + a bootstrap admin email allowlist. Claims ≤ 1000 bytes, access-control only (no profile data).
- Admin app checks the claim on the client to render UI, but **rules are the real gate** — hiding buttons is not access control.
- Security rules sketch:

```
match /products/{id} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.token.role == "admin";
}
match /orders/{id} {
  allow read: if request.auth != null &&
    (request.auth.uid == resource.data.userId || request.auth.token.role == "admin");
  allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
  allow update: if request.auth != null && request.auth.token.role == "admin";
}
match /users/{uid} {
  allow read: if request.auth.uid == uid || request.auth.token.role == "admin";
  allow write: if request.auth.uid == uid;
}
```

- Storage rules mirror this: product image uploads `allow write: if request.auth.token.role == "admin"`.
- On the site, the Admin SDK bypasses rules — the server must verify the session and check authorization itself before returning data.
- After a user's role changes, they must refresh their token (client `getIdToken(true)`) for claims to propagate.

## 7. Payments

**Phase 1 — WhatsApp checkout (manual).** Order is placed with `paymentMethod: "whatsapp"` and `status: pending`; the customer's cart/order summary is handed to a WhatsApp link (`wa.me/<business-number>?text=<order-details>`). Admin confirms receipt of payment in the panel → status → `confirmed`. No gateway, no webhook.

**Phase 2 — Paystack or Flutterwave (recommended gateway).** Paystack inline popup in the site checkout → order records `reference` → webhook updates status.

Paystack webhook contract (from official docs):

- URL: Settings → API Keys & Webhooks; test and live are separate.
- Signature: `x-paystack-signature` header = **HMAC-SHA512** over the **raw body**, keyed with the secret key. (SHA-512, not 256 — the common mistake.) Verify against `req.text()` raw bytes *before* parsing; compare in constant time (`timingSafeEqual`). In Next.js Route Handlers, use `await req.text()` (no body parsing middleware re-serializes it).
- Acknowledge with `200` immediately; do the work asynchronously (30s timeout).
- **Idempotent**: Paystack retries (live: every 3 min ×4, then hourly ×72h). Dedupe on `event.data.id`; make replay a no-op.
- **Verify-before-value**: for `charge.success`, re-query `GET /transaction/verify/:reference` and check amount/currency match the order before fulfilling. (Flutterwave/Nomba amounts are not covered by the signature; always reconcile.)
- Optional: IP-allowlist `52.31.139.75`, `52.49.173.169`, `52.214.14.220`.
- Site also needs `wa.me` in the URL opener — client-side only.

## 8. Images & Storage

- Admin uploads product images to **Firebase Storage** via the client SDK (rules-gated to admins). This works on the Spark plan; the Admin-SDK upload path requires Blaze.
- Site must serve them: add `images.remotePatterns` for `firebasestorage.googleapis.com` in `apps/site/next.config.ts` (currently missing — see AGENTS.md gotcha).
- Optimize with Next.js `Image` (widths/sizes) once remotePatterns is set.

## 9. SEO (site only)

- `generateMetadata` + `generateStaticParams` for product/category pages.
- Dynamic `opengraph-image.tsx` and `icon.tsx` (TODO already lists these).
- `sitemap.ts` + `robots.ts` (catalog is small; static generation is fine).
- Product `schema.org/Product` JSON-LD on product pages.

## 10. Environments & security

- **Separate Firebase projects** for dev and prod (recommended by Firebase's own docs). Never share rules/keys between them.
- Env naming: client config is `NEXT_PUBLIC_*`; service-account / admin creds never are. Admin panel (Vite) only needs the public client config — it never touches `firebase-admin`.
- Add `firestore.rules`, `storage.rules`, and `firestore.indexes.json` to the repo and treat them as application code.
- Don't read `.env` files (repo convention); reference them by name.

## 11. Skills needed

Loaded per the `.github/skills` convention:

- **`.github/skills/scss-conventions`** — all styling work.
- **`.github/skills/web-design-guidelines`** — UI/UX reviews.
- **`.github/skills/firebase-basics`** — project setup, CLI, service init, local env (newly installed).
- **`.github/skills/firebase-firestore`** — data modeling, SDK usage, indexes, rules (newly installed).
- **`.github/skills/firebase-auth-basics`** — sign-in flows, sessions, security rules (newly installed).
- **`.github/skills/firebase-security-rules-auditor`** — rules review/audit (newly installed).

Global skills already available: `nextjs-app-router-patterns`, `nextjs-developer`, `nextjs-react-typescript`, `ui-ux-pro-max`, `frontend-design`, `find-skills`.

To install more (e.g. a Paystack webhook skill exists as `hookdeck/webhook-skills@paystack-webhooks`):
`npx skills add <owner/repo@skill>` — or `npx skills find <query>` to search.

## 12. Roadmap

1. **Foundation**: install `zod`; create `@repo/schemas` (Product, Order, User, Address); add `firebase`/`firebase-admin` deps; Firebase project (dev) with rules + indexes committed.
2. **Admin panel**: auth (client SDK + custom claim bootstrap), product CRUD + image upload, order list + status updates.
3. **Site catalog**: products/categories from Firestore, Cache Components, SEO metadata, remotePatterns + image optimization.
4. **Cart & checkout**: persistent cart, address capture, WhatsApp checkout link.
5. **Account**: session cookie auth, order history/status.
6. **Payments Phase 2**: Paystack inline + verified webhook.
7. **Release**: sitemap/robots, prod Firebase project, monitoring of Firestore reads.

## Open items

- Decide Paystack vs Flutterwave when payments Phase 2 starts (same webhook pattern either way).
- Login providers: email/password + Google (both supported by Firebase Auth).
- Deployment target for the site (Vercel/Netlify) and admin (any static host / Firebase Hosting) — not yet decided.
