# Historical source

`sqlite-app.js` and `sqlite-db.js` are the previous native HTTP application's source snapshots, retained for review of the migration. They are not standalone applications or active entry points. Original supporting controllers/models/services remain historical source in the checkout. Root `db.js` now exports the PostgreSQL adapter. The active application starts at root `app.js` and uses `banking/`, PostgreSQL and Python FastAPI. Historical application code and the older `evergreen-site/` prototype are excluded from the DFT package.
