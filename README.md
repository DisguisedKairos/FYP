# Evergreen Banking

A banking demo built with Node.js, JavaScript, HTML, CSS, and SQLite. Requires Node.js 22.13 or later. No dependencies are needed for the local app.

Run `npm start`, then open http://localhost:3000.

Demo login: **alex@evergreen.demo** / **Evergreen123!**.

Includes registration, login, savings accounts, balance enquiry, internal transfers, bill payments, transaction history, and CSV export. Demo recipient: Jamie Lee, account **1020002001**. New registered accounts start with a zero balance.

The structure follows the reference: `app.js`, `db.js`, `controllers/`, `models/`, `views/`, and `public/`. Data persists in `data/banking.sqlite`. Optional configuration is documented in `.env.example`.

Run `npm test` for the 13 backend integration checks.

`evergreen-site/` contains the online deployment adapter and D1 migrations. The online deployment has not yet been completed or verified.

Educational mockup only. All balances and payments use sample funds; no real financial services are connected.
