# Historical source

`sqlite-app.js` is the previous native HTTP application's source snapshot, retained for review of the migration. It is not a standalone application or an active entry point. Original supporting controllers/models/services remain historical source in the checkout. The active application starts at root `app.js` and uses `banking/`, PostgreSQL and Python FastAPI. Historical application code and the older `evergreen-site/` prototype are excluded from the DFT package.
