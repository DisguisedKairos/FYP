'use strict';

// A reproducible, inspectable logistic-regression baseline. No API keys or ML dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FEATURE_NAMES, contextFeatures, sigmoid } = require('../services/fraud/features');

const ROOT = path.resolve(__dirname, '..');
const defaultData = path.join(ROOT, 'datasets', 'fraud-history.csv');
function seededRandom(seed = 73121) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

function generateDataset() {
  const random = seededRandom();
  const rows = ['amountCents,averageOutgoingCents,outgoingCount10m,outgoingAmount10m,knownPayee,balanceCents,hour,label'];
  for (let i = 0; i < 1400; i++) {
    const unusual = random() < 0.28;
    const average = Math.round(3000 + random() * 70000);
    const amount = Math.round(unusual ? average * (2 + random() * 35) : 100 + random() * average * 3);
    const count = Math.floor(random() * (unusual ? 11 : 4));
    const recentValue = Math.round(average * count * (unusual ? 1 + random() * 5 : random() * 1.5));
    const known = random() < (unusual ? 0.2 : 0.83);
    const funds = Math.round(amount / (0.02 + random() * (unusual ? 1.05 : 0.55)));
    const hour = Math.floor(random() * 24);
    const features = contextFeatures({ amountCents: amount, averageOutgoingCents: average, outgoingCount10m: count, outgoingAmount10m: recentValue, knownPayee: known, balanceCents: funds, hour });
    // Synthetic label generation models combinations of behavioural anomalies, with noisy labels.
    const latent = -5.8 + features[0] * 1.9 + features[1] * 2.5 + features[2] * 2.2 + features[3] * 1.4 + features[4] * 1.3 + features[5] * 0.7 + features[6] * 1.8;
    const label = random() < sigmoid(latent) ? 1 : 0;
    rows.push([amount, average, count, recentValue, Number(known), funds, hour, label].join(','));
  }
  fs.mkdirSync(path.dirname(defaultData), { recursive: true });
  fs.writeFileSync(defaultData, rows.join('\n') + '\n');
}

function evaluate(observations, intercept, weights, { type = 'rounded_model_score', threshold = 65 } = {}) {
  const confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const row of observations) {
    const probability = sigmoid(intercept + weights.reduce((sum, weight, i) => sum + weight * row.x[i], 0));
    const predicted = type === 'probability' ? probability >= threshold : Math.min(94, Math.round(probability * 100)) >= threshold;
    confusion[predicted ? row.y ? 'truePositive' : 'falsePositive' : row.y ? 'falseNegative' : 'trueNegative']++;
  }
  const round = value => Number(value.toFixed(4));
  return {
    thresholdType: type, threshold,
    accuracy: round((confusion.truePositive + confusion.trueNegative) / observations.length),
    precision: round(confusion.truePositive / Math.max(1, confusion.truePositive + confusion.falsePositive)),
    recall: round(confusion.truePositive / Math.max(1, confusion.truePositive + confusion.falseNegative)),
    falsePositiveRate: round(confusion.falsePositive / Math.max(1, confusion.falsePositive + confusion.trueNegative)),
    falseNegativeRate: round(confusion.falseNegative / Math.max(1, confusion.falseNegative + confusion.truePositive)),
    ...confusion,
  };
}

function train(filename = defaultData) {
  const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
  const lines = source.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  const required = ['amountCents', 'averageOutgoingCents', 'outgoingCount10m', 'outgoingAmount10m', 'knownPayee', 'balanceCents', 'hour', 'label'];
  if (required.some(name => !headers.includes(name))) throw new Error(`Training CSV needs ${required.join(', ')}.`);
  const observations = lines.map((line, index) => {
    const parts = line.split(',').map(Number);
    if (parts.length !== headers.length || parts.some(v => !Number.isFinite(v))) throw new Error(`Invalid training row ${index + 2}.`);
    const row = Object.fromEntries(headers.map((name, i) => [name, parts[i]]));
    if (![0, 1].includes(row.label) || ![0, 1].includes(row.knownPayee) || row.amountCents <= 0 || row.balanceCents <= 0 || row.hour < 0 || row.hour > 23 || row.outgoingCount10m < 0) throw new Error(`Invalid observation at row ${index + 2}.`);
    return { x: contextFeatures({ ...row, knownPayee: Boolean(row.knownPayee) }), y: row.label };
  });
  if (observations.length < 100 || new Set(observations.map(o => o.y)).size !== 2) throw new Error('Use at least 100 observations with both labels.');
  const random = seededRandom(98245);
  const shuffled = [...observations];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const cutoff = Math.floor(shuffled.length * 0.8);
  const trainRows = shuffled.slice(0, cutoff), testRows = shuffled.slice(cutoff);
  let intercept = -1;
  const weights = FEATURE_NAMES.map(() => 0);
  for (let epoch = 0; epoch < 1800; epoch++) {
    const gradient = weights.map(() => 0); let bias = 0;
    for (const row of trainRows) {
      const error = sigmoid(intercept + weights.reduce((sum, w, i) => sum + w * row.x[i], 0)) - row.y;
      bias += error;
      for (let i = 0; i < weights.length; i++) gradient[i] += error * row.x[i];
    }
    intercept -= 0.14 * bias / trainRows.length;
    for (let i = 0; i < weights.length; i++) weights[i] -= 0.14 * (gradient[i] / trainRows.length + 0.002 * weights[i]);
  }
  // Evaluate the exact published weights and rounded/capped score used at runtime.
  const round = v => Number(v.toFixed(4));
  const publishedIntercept = round(intercept), publishedWeights = weights.map(round);
  const metrics = evaluate(testRows, publishedIntercept, publishedWeights, { type: 'rounded_model_score', threshold: 65 });
  const probabilityDiagnostics = evaluate(testRows, publishedIntercept, publishedWeights, { type: 'probability', threshold: 0.5 });
  const model = {
    version: `logistic-v1-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`,
    algorithm: 'Regularized logistic regression', features: FEATURE_NAMES, intercept: publishedIntercept, weights: publishedWeights,
    training: { dataset: path.basename(filename), synthetic: path.resolve(filename) === defaultData, datasetSha256: createHash('sha256').update(source).digest('hex'), rows: observations.length, trainRows: trainRows.length, testRows: testRows.length, seed: 98245, epochs: 1800, split: 'Deterministic shuffled 80/20 holdout of synthetic observations; not a temporal or customer-separated production validation.' },
    evaluation: { scoreFormula: 'min(94, round(sigmoid(logit) * 100))', reviewScoreThreshold: 65, publishedRoundedWeights: true, scope: 'Model-only review classification on the held-out synthetic split; configurable Node banking rules are evaluated separately.' },
    metrics,
    diagnostics: { probabilityThreshold0_5: probabilityDiagnostics },
    policy: 'Model scores flag transactions for human review. Only explicit financial-control rules automatically block a transaction.',
  };
  const artifact = JSON.stringify(model, null, 2) + '\n';
  fs.writeFileSync(path.join(ROOT, 'services', 'fraud', 'model.json'), artifact);
  // Updating a model and its approval checksum is an explicit offline operator action.
  fs.writeFileSync(path.join(ROOT, 'fraud_service', 'model.sha256'), createHash('sha256').update(artifact).digest('hex') + '\n');
  console.log(JSON.stringify({ version: model.version, training: model.training, metrics: model.metrics }, null, 2));
  return model;
}

if (require.main === module) {
  try {
    if (process.argv.includes('--generate-demo')) generateDataset();
    const file = process.argv.find((v, i) => i > 1 && !v.startsWith('--')) || defaultData;
    train(path.resolve(file));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { train, generateDataset, evaluate };
