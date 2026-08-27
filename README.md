# GCC Talent Freelance Marketplace

## Overview

GCC Talent Marketplace is an online platform similar to Upwork and Fiverr. Clients publish jobs or
browse ready-made service packages, freelancers showcase their skills and submit proposals, and
both sides collaborate, deliver and pay securely through the platform. An admin team keeps the
marketplace safe and fair.

## Technologies Used

- **Runtime Environemnt:** Node.js
- **Framework:** Express
- **Database:** MongoBD
- **Authentication:** JWT


## Installation
 
Follow these steps to set up and run the backend locally.
 
### Prerequisites
 
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm (comes with Node.js)

### Steps
 
1. **Create a folder for your project and cd into it**
```bash
   mkdir gcc-talent-backend
   cd gcc-talent-backend
```
 
2. **Perform the following commands in the command line**
```bash
   git clone https://github.com/FnrDev/gcc-talent-backend.git .
   rm -rf .git
   rm README.md
```
 
3. **Copy `.env.example` to `.env` and configure the following values**
```env
    MONGODB_URI=your-connection-string
    PORT=3000
    CLIENT_URL=http://localhost:5173
    JWT_SECRET=super-secret-key-no-one-would-guess
    JWT_REFRESH_SECRET=a-different-long-random-secret
    RESEND_API_KEY=your-resend-api-key
    RESEND_FROM_EMAIL="GCC Talent <noreply@your-domain.com>"
    API_BASE_URL=http://localhost:3000
```

Use a real Resend sending key and an address on a [verified Resend domain](https://resend.com/docs/dashboard/domains/introduction).
Keep the key in `.env` locally or the deployment's secret environment variables; never put it in frontend code.
`API_BASE_URL` is the externally reachable **backend** URL used in email links, including any reverse-proxy
base path. Production requires this setting to use HTTPS; localhost links only work on the machine running the API.
`CLIENT_URL` is the frontend base URL used for CORS and password reset links. Use a public HTTPS URL in production.
Missing or invalid email configuration makes registration return
`503` before creating an account.
 
4. **run:**
```bash
   npm i
```
 
5. **run:**
```bash
   npm run dev
```
 
   The app should now be running at `http://localhost:3000`.
 
---


## Database Design

![alt text](erd.png)


## Routes

The routes below define the target REST API contract. Values wrapped in braces, such as
`{jobId}`, are route parameters. Query-string filters are optional unless an endpoint states
otherwise.

### Authentication

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Create a client or freelancer account and send a verification email through Resend. | Guest |
| `POST` | `/auth/login` | Authenticate a user and issue access/refresh credentials. | Guest |
| `POST` | `/auth/logout` | Invalidate the refresh credential and end the session. | Authenticated |
| `POST` | `/auth/forgot-password` | Request a password reset email with a 30-minute link. | Guest |
| `POST` | `/auth/reset-password` | Set a new password using a single-use reset token and revoke existing sessions. | Guest |
| `GET` | `/auth/verify-email?token={token}` | Verify an account email address. | Guest |
| `POST` | `/auth/resend-verification` | Send a replacement email-verification link. | Authenticated |

#### Signup email verification (implemented)

- `POST /auth/register` accepts `{ "name": "Your name", "email": "you@your-domain.com", "password": "your-password", "role": "client" }`.
  Roles remain `client` or `freelancer`. A `201` response includes `data.user.isEmailVerified: false`
  and `data.verificationEmailSent`. When Resend accepts the email, that flag is `true`.
- The email contains a link to `GET /auth/verify-email?token=...`. The random token expires after
  24 hours and can be used once. MongoDB stores only its SHA-256 hash. A valid link sets
  `isEmailVerified` to `true` and removes the pending verification fields atomically.
  Browser requests receive a confirmation page; API requests receive JSON. Missing, expired,
  invalid, or reused links return `400`. `HEAD` requests never consume a token.
- Existing login behavior is preserved: an unverified user can still sign in, and login plus
  `/auth/me` report `isEmailVerified`. No verification requirement is added to other API routes.
- `POST /auth/resend-verification` requires `Authorization: Bearer <accessToken>` and no request
  body. It sends to the signed-in account's stored email, enforces a 60-second cooldown, and
  replaces the previous link. Already verified accounts receive `200` without another email;
  suspended accounts receive `403`.
- If initial delivery fails or cannot be confirmed, the account is retained and registration still returns `201`,
  with `data.verificationEmailSent: false` and a clear message. Sign in and request another link
  after one minute. A resend rejected by Resend returns `503` and restores the previous pending link if no
  newer verification operation has replaced it. If the provider times out or delivery is otherwise uncertain,
  the new link remains valid in case the email was accepted; check the inbox or resend after one minute.
  Resend acceptance is not proof of inbox delivery;
  check the Resend dashboard for delivery/bounce status.
- Registration and resend share a limit of five requests per IP per 15 minutes, including successful
  requests. Cooldowns return `429` with `Retry-After`. The IP limiter uses process-local memory;
  use a shared store and configure trusted proxies appropriately for a multi-instance deployment.
- Verification URLs are redacted in application request logs, and verification pages use
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Configure any proxy/access logs to
  redact the token query too. Administrators changing verification status invalidate pending links.

For provider smoke checks, use [Resend's designated test recipients](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing),
such as `delivered@resend.dev`; do not send test traffic to made-up inboxes. The `onboarding@resend.dev`
sender is for testing, not arbitrary real-user delivery. Disable link tracking for verification emails.
For local testing without your own domain, set `RESEND_FROM_EMAIL="GCC Talent <onboarding@resend.dev>"`
and restart the backend. Sign up using the email address associated with your Resend account;
[Resend rejects other real recipients](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
until you verify your own domain and change the sender.
Because the documented verification endpoint uses a direct `GET`, email security scanners may consume
the link before the user opens it; in that case the address is already verified, and the user can sign in.

#### Forgot and reset password (implemented)

- The frontend sign-in page links to `/forgot-password`. Submit `POST /auth/forgot-password`
  with `{ "email": "you@your-domain.com" }`. For valid input, the API responds with the same
  `200` message for existing, unknown, suspended, and recently requested accounts, without waiting
  for account lookup or email delivery. This prevents account discovery through response content
  or provider latency. Invalid email input returns `400`; global configuration or database
  unavailability returns `503`.
- Eligible accounts receive a Resend email linking to `CLIENT_URL/reset-password?token=...`.
  The token is 32 random bytes, stored only as a SHA-256 hash, expires after 30 minutes,
  and can be used once. Requesting a reset does not change the password or invalidate sessions.
  Each account has a 60-second request cooldown; the request endpoint also allows five requests
  per IP per 15 minutes. Cooldown responses remain generic; the IP limit returns `429`.
- On a definite provider rejection, the previous reset token/expiry are restored without
  removing the cooldown or overwriting newer state. On timeouts or uncertain outcomes, the new
  link stays valid in case the email was delivered. Provider failures are logged safely and
  never change the generic request response. Processing runs in the existing Node process,
  so a restart can interrupt delivery; users can request another link after the cooldown.
- The frontend `/reset-password` page collects a new password and confirmation. The token
  remains only in component memory and is removed from the URL; after reloading the page,
  reopen the email link. Merely opening or scanning the link never changes the password.
  Submit `POST /auth/reset-password` with `{ "token": "token-from-email", "newPassword": "your-new-password" }`.
  Passwords require at least eight characters and at most 72 UTF-8 bytes to avoid bcrypt truncation.
- A successful reset returns `200`, atomically consumes the token, stores the bcrypt hash,
  clears the refresh credential, and increments the account's session version. Existing access
  and refresh tokens immediately stop working, including credentials from concurrent login or
  refresh attempts. Users must sign in again; the frontend clears its old local authentication.
  A notification email confirms the password change without including the password or a reset token.
  Notification failure does not undo the successful reset.
- Missing, malformed, expired, suspended-account, or used reset tokens return `400` with
  `code: "INVALID_RESET_TOKEN"`; invalid passwords return `400` with `code: "INVALID_PASSWORD"`.
  The reset endpoint allows ten requests per IP per 15 minutes. Both endpoints use `no-store`
  on controller responses; reset pages use `no-referrer`. Redact reset tokens in frontend/proxy
  access logs as well as application logs.
- Authenticated password changes also invalidate pending reset links and all existing sessions.
  Accounts/tokens created before session versioning continue to work until their password changes.
  No database migration or password change is needed for existing users.

The local `onboarding@resend.dev` sender restriction also applies to password reset and notification
emails: only the Resend account email and designated test recipients are supported until a sending
domain is verified.

### Account

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `PATCH` | `/users/me` | Update the current user's basic account settings. | Authenticated |
| `PATCH` | `/users/me/password` | Change the current user's password. | Authenticated |
| `PATCH` | `/users/me/preferences` | Update language, notification, and other user preferences. | Authenticated |

### Profiles

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/profiles/me` | Return the current user's editable profile. | Authenticated |
| `PUT` | `/profiles/me` | Create or replace the current freelancer profile. | Freelancer |
| `PUT` | `/profiles/me/client` | Create or replace the current client profile. | Client |
| `GET` | `/profiles/me/completeness` | Calculate profile completion and list missing sections. | Authenticated |
| `POST` | `/profiles/me/portfolio` | Add a portfolio item. | Freelancer |
| `PATCH` | `/profiles/me/portfolio/{itemId}` | Update a portfolio item. | Freelancer |
| `DELETE` | `/profiles/me/portfolio/{itemId}` | Delete a portfolio item. | Freelancer |
| `GET` | `/freelancers/{freelancerId}` | Return a public freelancer profile, rating, reviews, and active gigs. | Public |
| `GET` | `/clients/{clientId}` | Return a public client profile, hiring statistics, jobs, and reviews. | Public |

### Jobs

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `POST` | `/jobs` | Create a draft or open job. | Client |
| `GET` | `/jobs` | Browse jobs using search, category, skill, budget, type, experience, sort, and pagination filters. | Public |
| `GET` | `/jobs/{jobId}` | Return job details and the client summary. | Public |
| `PATCH` | `/jobs/{jobId}` | Edit a job while its status permits changes. | Owning client |
| `DELETE` | `/jobs/{jobId}` | Delete a draft job. | Owning client |
| `POST` | `/jobs/{jobId}/close` | Close an open job. | Owning client |
| `POST` | `/jobs/{jobId}/reopen` | Reopen an eligible closed job. | Owning client |
| `GET` | `/jobs/{jobId}/similar` | Return similar open jobs. | Public |
| `GET` | `/jobs/mine?status={status}&page={page}&limit={limit}` | List the current client's jobs by status with proposal counts. | Client |
| `POST` | `/jobs/{jobId}/save` | Save a job for the current user. | Freelancer |
| `DELETE` | `/jobs/{jobId}/save` | Remove a job from the current user's saved jobs. | Freelancer |
| `GET` | `/jobs/saved?page={page}&limit={limit}` | List the current user's saved jobs. | Freelancer |
| `POST` | `/jobs/{jobId}/invitations` | Invite a freelancer to apply to a job. | Owning client |

### Proposals

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `POST` | `/jobs/{jobId}/proposals` | Submit one proposal for an open job; reject own-job, duplicate, or closed-job submissions. | Freelancer |
| `GET` | `/proposals/mine?status={status}` | List the current freelancer's proposals. | Freelancer |
| `PATCH` | `/proposals/{proposalId}` | Edit a pending proposal. | Owning freelancer |
| `DELETE` | `/proposals/{proposalId}` | Withdraw a pending proposal. | Owning freelancer |
| `GET` | `/jobs/{jobId}/proposals` | List proposals and freelancer summaries for a job. | Owning client |
| `PATCH` | `/proposals/{proposalId}/status` | Shortlist or decline a proposal, optionally with a reason. | Owning client |
| `POST` | `/proposals/{proposalId}/accept` | Accept a proposal, create a contract, and update competing proposals. | Owning client |

### Contracts

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/contracts` | List contracts visible to the current user. | Authenticated |
| `GET` | `/contracts/{contractId}` | Return a contract and its source, parties, milestones, money, and status. | Contract party |
| `POST` | `/contracts/{contractId}/milestones` | Add a milestone to an eligible contract. | Contract party |
| `PATCH` | `/contracts/{contractId}/milestones/{milestoneId}` | Update an eligible milestone. | Contract party |
| `POST` | `/contracts/{contractId}/milestones/{milestoneId}/fund` | Move client funds into milestone escrow. | Client party |
| `POST` | `/contracts/{contractId}/milestones/{milestoneId}/deliveries` | Submit a message and attachments as a milestone delivery. | Freelancer party |
| `POST` | `/contracts/{contractId}/milestones/{milestoneId}/approve` | Approve delivery, release escrow, and evaluate contract completion. | Client party |
| `POST` | `/contracts/{contractId}/milestones/{milestoneId}/request-revision` | Return a delivered milestone to in-progress with revision comments. | Client party |
| `POST` | `/contracts/{contractId}/cancel` | Cancel an eligible contract and refund or dispute funded milestones. | Contract party |
| `GET` | `/contracts/{contractId}/workspace` | Return the combined contract workspace summary. | Contract party |
| `GET` | `/contracts/{contractId}/activity` | Return the contract timeline and activity log. | Contract party |
| `GET` | `/contracts/{contractId}/messages` | Return paginated contract messages. | Contract party |
| `POST` | `/internal/jobs/auto-approve-deliveries` | Auto-approve deliveries after the configured inactivity period. | Internal scheduler |

### Wallet

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/wallet` | Return available, pending, and escrow balance information. | Authenticated |
| `POST` | `/wallet/deposits` | Run the mock checkout and credit the user's wallet. | Authenticated |
| `POST` | `/wallet/withdrawals` | Create a simulated payout from the available balance. | Authenticated |

### Transactions

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/transactions?type={type}&status={status}&page={page}&limit={limit}` | Return filtered, paginated transaction history. | Authenticated |
| `GET` | `/transactions/{transactionId}/receipt` | Return a printable or downloadable transaction receipt. | Transaction owner |

### Reviews

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `POST` | `/contracts/{contractId}/reviews` | Leave one rating and comment for the other contract party. | Contract party |
| `GET` | `/users/{userId}/rating` | Return a user's average rating and review count. | Public |
| `GET` | `/users/{userId}/reviews?page={page}&limit={limit}` | Return a user's reviews, newest first. | Public |
| `GET` | `/gigs/{gigId}/reviews?page={page}&limit={limit}` | Return reviews associated with a gig, newest first. | Public |
| `POST` | `/reviews/{reviewId}/reply` | Add the review recipient's single reply. | Reviewed user |

### General

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/home` | Return landing-page categories and featured marketplace content. | Public |
| `GET` | `/dashboard` | Return the current user's role-aware dashboard summary. | Authenticated |
| `GET` | `/search?type={type}&query={query}&page={page}&limit={limit}` | Search jobs, gigs, or freelancers; `type` accepts `jobs`, `gigs`, or `freelancers`. | Public |

### Skills

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/skills?category={categoryId}&categorySlug={slug}&search={query}` | List available skills, optionally filtered by category or name. | Public |
| `GET` | `/skills/{skillId}` | Return one skill with its category. | Public |

### Administration

| Method | Route | Description | Access |
| --- | --- | --- | --- |
| `GET` | `/admin/stats` | Return users by role, 7/30-day sign-ups, open jobs, active contracts, GMV, platform revenue, and a 30-day sign-up series. | Admin |
| `GET` | `/admin/users?search={query}&role={role}&status={status}&page={page}&limit={limit}` | Search, filter, sort, and paginate users. | Admin |
| `GET` | `/admin/users/{userId}` | Return one user's account summary, contracts, and transactions. | Admin |
| `PATCH` | `/admin/users/{userId}` | Update a user's status, email-verification flag, or role. | Admin |
| `DELETE` | `/admin/users/{userId}` | Delete a user with no marketplace history; otherwise suspend the account. | Admin |
| `GET` | `/admin/categories` | List job categories. | Admin |
| `POST` | `/admin/categories` | Create a job category. | Admin |
| `GET` | `/admin/categories/{categoryId}` | Return a category and its skills. | Admin |
| `PATCH` | `/admin/categories/{categoryId}` | Update a category's name or slug. | Admin |
| `DELETE` | `/admin/categories/{categoryId}` | Delete an unused category. | Admin |
| `GET` | `/admin/skills?category={categoryId}&search={query}` | List and filter skills. | Admin |
| `POST` | `/admin/skills` | Create a skill in an existing category. | Admin |
| `GET` | `/admin/skills/{skillId}` | Return one skill and its category. | Admin |
| `PATCH` | `/admin/skills/{skillId}` | Update a skill's name or category. | Admin |
| `DELETE` | `/admin/skills/{skillId}` | Delete a skill from the master list. | Admin |
| `POST` | `/admin/seed` | Populate development/demo data. This route must be disabled in production. | Development admin |

Wallet and escrow mutation routes must run atomically and accept an `Idempotency-Key` header so a
retried request cannot deposit, fund, release, refund, or withdraw money more than once. Contract
auto-completion is an internal side effect of milestone approval rather than a separate public route.




## Credits
