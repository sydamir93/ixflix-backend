## IXFLIX Backend

Node/Express + Knex backend for wallets, staking, genealogy, rewards, and IXFLIX plan mechanics.

### Key Features
- Auth with password + optional TOTP; referral-aware registration.
- Wallets: deposits/withdrawals (NowPayments), transfers, transaction stats.
- Staking: energy packs (Spark/Pulse/Charge/Quantum), Core + Harvest rewards with per-stake cap.
- Rewards: Catalyst (referral, active-pack-gated), Synergy Flow (binary with eligibility), Power Pass-Up (ranked overrides) with combined cap across incentives.
- Genealogy: sponsor + binary tree placement; network stats.
- Ranks: ladder Spark→Quantum, auto-promo evaluator, admin management.

### Important Endpoints
- Auth: `/api/auth/register`, `/login`, `/rank/ladder`, `/rank/me`.
- Wallet/Stake: `/api/wallet/balance`, `/stakes`, `/stakes/:id/rewards`, `/stakes/calculate-daily-rewards`.
- Synergy: `/api/wallet/network/synergy`, `/network/synergy/history`, `/network/synergy/history/all` (admin), `/network/synergy/run` (admin).
- Admin rank ops: `/api/auth/rank/:user_id` (GET/POST), `/api/auth/rank/promote-all`.
- Password reset: `/api/auth/forgot-password` (send reset email), `/api/auth/reset-password` (set new password).

### Cron / Scripts
- Daily Synergy payout: `node backend/scripts/daily-synergy.js` (schedule via cron/PM2); manual admin POST `/api/wallet/network/synergy/run`.
- Daily stake rewards (core+harvest): `/api/wallet/stakes/calculate-daily-rewards` (protect in prod).

### Setup
1) Install: `npm install`
2) Env: copy `.env.example` → `.env` (DB, JWT, NowPayments keys).
3) Add SMTP for password reset (SES SMTP only):
   - `SES_SMTP_HOST`, `SES_SMTP_PORT`, `SES_SMTP_USERNAME`, `SES_SMTP_PASSWORD`, `EMAIL_FROM`
4) Migrate: `npx knex migrate:latest`
5) Seed (ranks default): `npx knex seed:run --specific=seed_ranks.js`
6) Run: `npm start` (or `npm run dev`)

### Notes
- Combined incentive cap enforced across Catalyst + Synergy + Power Pass-Up per active pack tier.
- Catalyst requires upline to have an active pack; payouts are cap-clamped.
- Harvest pool currently uses completed stake volume as “daily sales”; adjust if sales definition changes.
- SMTP reset email vars: `SES_SMTP_HOST`, `SES_SMTP_PORT`, `SES_SMTP_USERNAME`, `SES_SMTP_PASSWORD`, `EMAIL_FROM`; also `PASSWORD_RESET_URL` (defaults to `<FRONTEND_URL>/reset-password`), `PASSWORD_RESET_TOKEN_TTL_MINUTES` (default 60).

