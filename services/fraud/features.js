'use strict';

const FEATURE_NAMES = ['amountLog', 'amountDeviation', 'velocity', 'newPayee', 'balanceUtilization', 'unusualHour', 'recentValue'];
const clamp = (value, low = 0, high = 2) => Math.min(high, Math.max(low, value));

function contextFeatures(context) {
  return [
    clamp(Math.log1p(context.amountCents / 100) / Math.log(10001)),
    clamp(Math.log2(Math.max(1, context.amountCents) / Math.max(1000, context.averageOutgoingCents || 20000)) / 6),
    clamp(context.outgoingCount10m / 5),
    context.knownPayee ? 0 : 1,
    clamp(context.amountCents / Math.max(1, context.balanceCents), 0, 1.5),
    context.hour < 6 ? 1 : 0,
    clamp(context.outgoingAmount10m / Math.max(10000, context.averageOutgoingCents || 20000) / 8),
  ];
}

function historicalFeatures(input) {
  const instant = new Date(input.createdAt || Date.now());
  const now = instant.getTime();
  const history = (Array.isArray(input.history) ? input.history : []).filter(t =>
    t.amountCents < 0 && (!t.status || t.status === 'completed') && !t.isInternal &&
    Number.isFinite(new Date(t.createdAt).getTime()) && new Date(t.createdAt).getTime() <= now);
  const recent = history.filter(t => now - new Date(t.createdAt).getTime() < 600000);
  const dayKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const today = dayKey(instant);
  const daily = history.filter(t => dayKey(t.createdAt) === today);
  const mean = history.length ? history.reduce((sum, t) => sum + Math.abs(t.amountCents), 0) / history.length : 20000;
  const context = {
    amountCents: input.amountCents,
    averageOutgoingCents: mean,
    outgoingCount10m: recent.length,
    outgoingAmount10m: recent.reduce((sum, t) => sum + Math.abs(t.amountCents), 0),
    dailyOutgoingCents: daily.reduce((sum, t) => sum + Math.abs(t.amountCents), 0),
    knownPayee: Boolean(input.isInternal) || history.some(t => String(t.payee || t.counterparty) === String(input.payee)),
    balanceCents: input.accountBalanceCents,
    hour: Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23' }).format(instant)),
    historyCount: history.length,
  };
  // The banking service supplies exact indexed aggregates so hard limits are not
  // weakened by the bounded sample used for model history. This input is private.
  const summary = input.historySummary;
  if (summary && typeof summary === 'object') {
    for (const name of ['averageOutgoingCents', 'outgoingCount10m', 'outgoingAmount10m', 'dailyOutgoingCents', 'historyCount']) {
      if (typeof summary[name] === 'number' && Number.isFinite(summary[name]) && summary[name] >= 0) context[name] = summary[name];
    }
    if (typeof summary.knownPayee === 'boolean') context.knownPayee = Boolean(input.isInternal) || summary.knownPayee;
  }
  return { context, values: contextFeatures(context) };
}

const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));
module.exports = { FEATURE_NAMES, contextFeatures, historicalFeatures, sigmoid };
