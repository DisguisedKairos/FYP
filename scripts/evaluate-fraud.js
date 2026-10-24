'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { baselineReport, parseCsv, evaluateTemporal } = require('../banking/fraud-evaluation');
function evaluate(args = process.argv.slice(2)) {
  if (args.length > 2 || (args.length && args[0] !== '--temporal-csv') || (args.length === 1)) throw new Error('Usage: npm run evaluate:fraud [-- --temporal-csv path/to/labelled-history.csv]');
  if (!args.length) return baselineReport();
  const filename = path.resolve(args[1]);
  if (fs.statSync(filename).size > 8 * 1024 * 1024) throw new Error('Evaluation CSV exceeds 8 MiB.');
  const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  return { datasetSha256: createHash('sha256').update(source).digest('hex'), provenance: 'Operator-supplied dataset; labels, feature provenance and representativeness have not been independently verified.', temporal: evaluateTemporal(parseCsv(source, { temporal: true })) };
}
module.exports = { evaluate };
if (require.main === module) {
  try { console.log(JSON.stringify(evaluate(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
