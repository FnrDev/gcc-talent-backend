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
 
Follow these steps to set up and run the React frontend locally.
 
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
 
3. **Create a `.env` file with the following values**
```env
    MONGODB_URI=your-connection-string
    PORT=3000
    CLIENT_URL=http://localhost:5173
    JWT_SECRET=super-secret-key-no-one-would-guess
```
 
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
| `POST` | `/auth/register` | Create a client or freelancer account. | Guest |
| `POST` | `/auth/login` | Authenticate a user and issue access/refresh credentials. | Guest |
| `POST` | `/auth/logout` | Invalidate the refresh credential and end the session. | Authenticated |
| `POST` | `/auth/forgot-password` | Send a time-limited password-reset link. | Guest |
| `POST` | `/auth/reset-password` | Set a new password using a valid reset token. | Guest |
| `GET` | `/auth/verify-email?token={token}` | Verify an account email address. | Guest |
| `POST` | `/auth/resend-verification` | Send a replacement email-verification link. | Authenticated |

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
| `DELETE` | `/admin/skills/{skillId}` | Delete a skill that is not used by a job. | Admin |
| `POST` | `/admin/seed` | Populate development/demo data. This route must be disabled in production. | Development admin |

Wallet and escrow mutation routes must run atomically and accept an `Idempotency-Key` header so a
retried request cannot deposit, fund, release, refund, or withdraw money more than once. Contract
auto-completion is an internal side effect of milestone approval rather than a separate public route.




## Credits
