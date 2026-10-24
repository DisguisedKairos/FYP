'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FEATURE_NAMES, contextFeatures, sigmoid } = require('../services/fraud/features');
const ROOT = path.resolve(__dirname, '..');
const THRESHOLDS = [35, 50, 65, 80, 90];
const round = value => Number(value.toFixed(4));
const ratio = (a, b) => b ? round(a / b) : null;
function seededRandom(seed = 73121) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}
function parseCsv(source, { temporal = false } = {}) {
  if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error('Evaluation CSV exceeds 8 MiB.');
  const lines = source.trim().split(/\r?\n/), headers = lines.shift().replace(/^\uFEFF/, '').split(',');
  const numeric = ['amountCents', 'averageOutgoingCents', 'outgoingCount10m', 'outgoingAmount10m', 'knownPayee', 'balanceCents', 'hour', 'label'];
  if (new Set(headers).size !== headers.length || numeric.some(key => !headers.includes(key)) || headers.some(key => ![...numeric, 'occurredAt'].includes(key)) || (temporal && !headers.includes('occurredAt'))) throw new Error('Use the documented numeric CSV fields and occurredAt for temporal evaluation.');
  if (lines.length < 100 || lines.length > 50000) throw new Error('Use between 100 and 50,000 observations.');
  const rows = lines.map((line, index) => {
    const fields = line.split(',');
    if (fields.length !== headers.length || fields.some(value => !value.trim())) throw new Error(`Invalid evaluation row ${index + 2}.`);
    const row = Object.fromEntries(headers.map((key, i) => [key, key === 'occurredAt' ? fields[i] : Number(fields[i])]));
    if (numeric.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0) || row.amountCents < 1 || row.balanceCents < 1 || row.hour > 23 || ![0, 1].includes(row.label) || ![0, 1].includes(row.knownPayee)) throw new Error(`Invalid evaluation values at row ${index + 2}.`);
    if (row.occurredAt && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(row.occurredAt) || !Number.isFinite(Date.parse(row.occurredAt)) || new Date(row.occurredAt).toISOString() !== row.occurredAt.replace(/Z$/, row.occurredAt.includes('.') ? 'Z' : '.000Z'))) throw new Error(`Invalid UTC occurredAt at row ${index + 2}.`);
    if (row.occurredAt && new Date(Date.parse(row.occurredAt) + 8 * 3600000).getUTCHours() !== row.hour) throw new Error(`hour must match Singapore time at row ${index + 2}.`);
    return { x: contextFeatures({ ...row, knownPayee: Boolean(row.knownPayee) }), y: row.label, ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}) };
  });
  if (new Set(rows.map(row => row.y)).size !== 2) throw new Error('The dataset needs both fraud and non-fraud labels.');
  return rows;
}
function shuffledSplit(rows) {
  const shuffled = [...rows], random = seededRandom(98245);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const cut = Math.floor(rows.length * 0.8);
  return { train: shuffled.slice(0, cut), test: shuffled.slice(cut) };
}
function temporalSplit(rows) {
  if (rows.length < 100 || rows.some(row => !Number.isFinite(Date.parse(row.occurredAt)))) throw new Error('Temporal evaluation requires at least 100 timestamped observations.');
  const sorted = [...rows].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  // Keep identical timestamps together; no instant crosses a partition boundary.
  const boundary = fraction => { let i = Math.floor(sorted.length * fraction); while (i < sorted.length && Date.parse(sorted[i].occurredAt) === Date.parse(sorted[i - 1].occurredAt)) i++; return i; };
  const a = boundary(0.6), b = boundary(0.8), partitions = { train: sorted.slice(0, a), validation: sorted.slice(a, b), test: sorted.slice(b) };
  for (const [name, group] of Object.entries(partitions)) if (group.length < 20 || new Set(group.map(row => row.y)).size !== 2) throw new Error(`The ${name} time partition needs at least 20 observations with both labels.`);
  return partitions;
}
function fit(rows) {
  let intercept = -1;
  const weights = FEATURE_NAMES.map(() => 0);
  for (let epoch = 0; epoch < 1800; epoch++) {
    const gradient = weights.map(() => 0); let bias = 0;
    for (const row of rows) {
      const error = sigmoid(intercept + weights.reduce((sum, w, i) => sum + w * row.x[i], 0)) - row.y;
      bias += error;
      for (let i = 0; i < weights.length; i++) gradient[i] += error * row.x[i];
    }
    intercept -= 0.14 * bias / rows.length;
    for (let i = 0; i < weights.length; i++) weights[i] -= 0.14 * (gradient[i] / rows.length + 0.002 * weights[i]);
  }
  return { intercept: round(intercept), weights: weights.map(round) };
}
function probability(row, model) { return sigmoid(model.intercept + model.weights.reduce((sum, w, i) => sum + w * row.x[i], 0)); }
function metrics(rows, model, threshold = 65) {
  if (!rows.length || !Number.isInteger(threshold) || threshold < 0 || threshold > 94) throw new Error('Use observations and a score threshold from 0 to 94.');
  const c = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const row of rows) {
    const flagged = Math.min(94, Math.round(probability(row, model) * 100)) >= threshold;
    c[flagged ? row.y ? 'truePositive' : 'falsePositive' : row.y ? 'falseNegative' : 'trueNegative']++;
  }
  return { threshold, rows: rows.length, ...c, accuracy: ratio(c.truePositive + c.trueNegative, rows.length), precision: ratio(c.truePositive, c.truePositive + c.falsePositive), recall: ratio(c.truePositive, c.truePositive + c.falseNegative), falsePositiveRate: ratio(c.falsePositive, c.falsePositive + c.trueNegative), falseNegativeRate: ratio(c.falseNegative, c.falseNegative + c.truePositive), f1: ratio(2 * c.truePositive, 2 * c.truePositive + c.falsePositive + c.falseNegative), reviewRate: ratio(c.truePositive + c.falsePositive, rows.length) };
}
function calibration(rows, model) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, count: 0, probabilitySum: 0, positives: 0 }));
  let squared = 0;
  for (const row of rows) { const p = probability(row, model), bin = bins[Math.min(9, Math.floor(p * 10))]; bin.count++; bin.probabilitySum += p; bin.positives += row.y; squared += (p - row.y) ** 2; }
  return { scope: 'Raw sigmoid output on held-out labels, not the rounded/capped risk score; diagnostics do not calibrate the model.', brierScore: round(squared / rows.length), bins: bins.map(({ probabilitySum, positives, ...bin }) => ({ ...bin, meanPrediction: ratio(probabilitySum, bin.count), observedFraudRate: ratio(positives, bin.count) })) };
}
function histogram(values, maximum = 2) {
  const bins = [0, 0, 0, 0, 0];
  for (const value of values) bins[Math.min(4, Math.floor(value / maximum * 5))]++;
  return bins;
}
function distributionShift(reference, current) {
  if (!reference.length || !current.length) return null;
  const smooth = bins => bins.map(n => (n + 0.5) / (bins.reduce((a, b) => a + b, 0) + 2.5));
  const a = smooth(reference), b = smooth(current);
  return round(a.reduce((sum, p, i) => sum + (b[i] - p) * Math.log(b[i] / p), 0));
}
function compareFeatures(reference, recent) {
  return FEATURE_NAMES.map((name, i) => {
    const maximum = ['newPayee', 'unusualHour'].includes(name) ? 1 : name === 'balanceUtilization' ? 1.5 : 2;
    const before = histogram(reference.map(row => row.x[i]), maximum), after = histogram(recent.map(row => row.x[i]), maximum);
    return { feature: name, referenceBins: before, recentBins: after, psi: recent.length ? distributionShift(before, after) : null };
  });
}
function temporalDemo() {
  const random = seededRandom(391726), rows = [];
  for (let i = 0; i < 1200; i++) {
    const late = i >= 720, average = Math.round(5000 + random() * 65000), unusual = random() < (late ? 0.4 : 0.25);
    const input = { averageOutgoingCents: average, amountCents: Math.round(100 + average * (unusual ? 3 + random() * 30 : random() * 3)), outgoingCount10m: Math.floor(random() * (unusual ? 10 : 4)), outgoingAmount10m: Math.round(random() * average * (unusual ? 15 : 3)), knownPayee: random() < (late ? 0.5 : 0.8), balanceCents: Math.round(50000 + random() * 2500000), hour: Math.floor(random() * 24) };
    input.hour = (i + 8) % 24;
    const x = contextFeatures(input), latent = -5.8 + x[0] * 1.9 + x[1] * 2.5 + x[2] * 2.2 + x[3] * 1.4 + x[4] * 1.3 + x[5] * 0.7 + x[6] * 1.8;
    rows.push({ x, y: Number(random() < sigmoid(latent)), occurredAt: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString() });
  }
  return rows;
}
function evaluateTemporal(rows, { synthetic = false } = {}) {
  const split = temporalSplit(rows), candidate = fit(split.train);
  const comparison = THRESHOLDS.map(threshold => metrics(split.validation, candidate, threshold));
  const selected = [...comparison].sort((a, b) => (b.f1 ?? -1) - (a.f1 ?? -1) || a.threshold - b.threshold)[0].threshold;
  return { synthetic, scope: 'Separate experimental candidate fitted only on the earliest partition; validation selects a threshold, final test is held out. No deployment or policy change.', partitions: Object.fromEntries(Object.entries(split).map(([name, group]) => [name, { rows: group.length, from: group[0].occurredAt, to: group.at(-1).occurredAt }])), validationThresholds: comparison, selectedThreshold: selected, selection: 'Maximum validation F1 among the declared thresholds; ties choose the lower threshold. This is not an approved banking policy.', testAtSelectedThreshold: metrics(split.test, candidate, selected), testAtCurrentThreshold: metrics(split.test, candidate, 65), calibration: calibration(split.test, candidate), featureShift: compareFeatures(split.train, split.test), limitations: ['Synthetic demonstrations do not measure real fraud performance.', 'Timestamp separation does not prove upstream history features are free of future information.', 'Customer-separated validation and representative independently verified labels remain necessary.'] };
}
let cached;
function baselineReport() {
  if (cached) return cached;
  const bytes = fs.readFileSync(path.join(ROOT, 'datasets/fraud-history.csv'), 'utf8').replace(/\r\n/g, '\n');
  const modelBytes = fs.readFileSync(path.join(ROOT, 'services/fraud/model.json'), 'utf8').replace(/\r\n/g, '\n');
  const model = JSON.parse(modelBytes), checksum = createHash('sha256').update(modelBytes).digest('hex');
  if (checksum !== fs.readFileSync(path.join(ROOT, 'fraud_service/model.sha256'), 'utf8').trim() || createHash('sha256').update(bytes).digest('hex') !== model.training.datasetSha256) throw new Error('Evaluation provenance does not match the approved model and dataset.');
  const split = shuffledSplit(parseCsv(bytes));
  cached = { modelVersion: model.version, modelSha256: checksum, datasetSha256: model.training.datasetSha256, baseline: { scope: 'Approved model, original shuffled synthetic holdout. Threshold comparisons are diagnostics only; do not tune on this test set.', metrics: metrics(split.test, model), thresholds: THRESHOLDS.map(t => metrics(split.test, model, t)), calibration: calibration(split.test, model) }, temporal: evaluateTemporal(temporalDemo(), { synthetic: true }) };
  return cached;
}
module.exports = { seededRandom, parseCsv, shuffledSplit, temporalSplit, fit, metrics, calibration, histogram, distributionShift, compareFeatures, temporalDemo, evaluateTemporal, baselineReport };
