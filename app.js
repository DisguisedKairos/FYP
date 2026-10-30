'use strict';

const express = require('express');
const { createApplication, trustProxy } = require('./application');
// The hosted adapter and native entry share a factory without importing each other.
const hostedEntry = express();
hostedEntry.disable('x-powered-by');
hostedEntry.use(require('./deploy/vercel'));
module.exports = hostedEntry;
module.exports.createApplication = createApplication;
module.exports.trustProxy = trustProxy;
if (require.main === module) (async () => {
  const server = await createApplication(), port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Green Link Digital Bank DFT banking: http://${host}:${port}`));
  const stop = () => server.close(async () => { await server.closeResources(); process.exit(0); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
