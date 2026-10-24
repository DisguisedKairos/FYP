'use strict';
const { HttpError } = require('../models/errors');
const { assertActor } = require('./agents/reports');
const { baselineReport, compareFeatures, parseCsv, shuffledSplit } = require('./fraud-evaluation');
const { FEATURE_NAMES } = require('../services/fraud/features');
const fs = require('node:fs');
const path = require('node:path');
const DAY = 86400000;
let reference;
async function modelEvaluation(db, user, { days = '30', now = Date.now, activeModel } = {}) {
  await assertActor(db, user, { admin: true });
  if (!/^(?:[1-9]|[1-8][0-9]|90)$/.test(String(days))) throw new HttpError(400, 'Choose a monitoring window from 1 to 90 days.');
  const report = baselineReport();
  if (activeModel.version !== report.modelVersion || (activeModel.modelSha256 && activeModel.modelSha256 !== report.modelSha256)) throw new HttpError(503, 'The active scorer does not match this evaluation. Verify the approved artifact before comparing metrics.');
  reference ||= shuffledSplit(parseCsv(fs.readFileSync(path.resolve(__dirname, '../datasets/fraud-history.csv'), 'utf8'))).train;
  const end = now(), start = end - Number(days) * DAY;
  const records = (await db.query('SELECT result_json FROM fraud_assessments WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC,id LIMIT 1001', [new Date(start).toISOString(), new Date(end).toISOString()])).rows;
  const rows = records.slice(0, 1000), usable = [], decisions = { allow: 0, review: 0, block: 0 };
  let missing = 0, otherModel = 0;
  for (const { result_json: result } of rows) {
    if (!result) { missing++; continue; }
    if (result.modelVersion !== report.modelVersion || result.modelSha256 !== report.modelSha256) { otherModel++; continue; }
    const x = FEATURE_NAMES.map(name => result.features?.[name]);
    const maxima = [2, 2, 2, 1, 1.5, 1, 2];
    if (!x.every((v, i) => Number.isFinite(v) && v >= 0 && v <= maxima[i]) || !Number.isInteger(result.modelScore) || result.modelScore < 0 || result.modelScore > 94 || !Object.hasOwn(decisions, result.decision)) { missing++; continue; }
    usable.push({ x, score: result.modelScore }); decisions[result.decision]++;
  }
  const enough = usable.length >= 100;
  const features = compareFeatures(reference, usable).map(row => ({ ...row, status: !enough ? 'insufficient_data' : row.psi >= 0.2 ? 'investigate' : 'no_alert' }));
  return { ...report, monitoring: { generatedAt: new Date(end).toISOString(), days: Number(days), from: new Date(start).toISOString(), sampled: rows.length, scored: usable.length, missing, otherModel, truncated: records.length > 1000, minimumSample: 100, status: !enough ? 'insufficient_data' : features.some(f => f.status === 'investigate') ? 'investigate' : 'no_alert', decisions, modelReviewRate: usable.length ? Number((usable.filter(r => r.score >= 65).length / usable.length).toFixed(4)) : null, features, limitations: ['Latest 1,000 assessment attempts in this window; recorded decisions are not settlement outcomes.', 'PSI uses five fixed feature bins and additive smoothing against the synthetic training reference.', 'The illustrative PSI alert threshold of 0.2 and minimum sample of 100 require independent validation.', 'A distribution change is not proof of fraud or model degradation; no alert is not proof of safety.', 'Live fraud labels are unavailable. Live accuracy, precision and recall cannot be calculated. No threshold is changed automatically.'] } };
}
module.exports = { modelEvaluation };
