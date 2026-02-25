'use strict';

/**
 * math.cjs — Statistical helpers for portfolio metrics and optimization.
 * Pure JS, no native dependencies.
 */

/**
 * Arithmetic mean of an array.
 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Sample standard deviation.
 */
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Annualised volatility from daily returns.
 * @param {number[]} dailyReturns - fractional daily returns (e.g. 0.01 = 1%)
 */
function annualisedVol(dailyReturns) {
  return std(dailyReturns) * Math.sqrt(252);
}

/**
 * Annualised return from daily returns.
 */
function annualisedReturn(dailyReturns) {
  if (!dailyReturns.length) return 0;
  const compounded = dailyReturns.reduce((prod, r) => prod * (1 + r), 1);
  return Math.pow(compounded, 252 / dailyReturns.length) - 1;
}

/**
 * Total return from daily returns.
 */
function totalReturn(dailyReturns) {
  return dailyReturns.reduce((prod, r) => prod * (1 + r), 1) - 1;
}

/**
 * Sharpe Ratio. riskFreeRate is annual (e.g. 0.02 = 2%).
 */
function sharpeRatio(dailyReturns, riskFreeRate = 0.02) {
  const arr = annualisedReturn(dailyReturns);
  const vol = annualisedVol(dailyReturns);
  if (vol < 1e-10) return 0; // Guard against floating-point near-zero vol
  return (arr - riskFreeRate) / vol;
}

/**
 * Sortino Ratio. Uses only downside deviation.
 */
function sortinoRatio(dailyReturns, riskFreeRate = 0.02) {
  const dailyRf = riskFreeRate / 252;
  const downsideReturns = dailyReturns.filter(r => r < dailyRf);
  if (!downsideReturns.length) return Infinity;
  const downsideStd = std(downsideReturns.map(r => r - dailyRf)) * Math.sqrt(252);
  if (downsideStd === 0) return Infinity;
  const arr = annualisedReturn(dailyReturns);
  return (arr - riskFreeRate) / downsideStd;
}

/**
 * Maximum Drawdown. Returns as a positive fraction (e.g. 0.2 = 20% drawdown).
 * @param {number[]} equityCurve - portfolio values over time (not returns)
 */
function maxDrawdown(equityCurve) {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Calmar Ratio = Annual Return / Max Drawdown.
 */
function calmarRatio(dailyReturns, equityCurve) {
  const mdd = maxDrawdown(equityCurve);
  if (mdd === 0) return Infinity;
  return annualisedReturn(dailyReturns) / mdd;
}

/**
 * Value at Risk (historical simulation).
 * @param {number[]} dailyReturns
 * @param {number} confidence - e.g. 0.95
 * @returns {number} VaR as a positive number (loss magnitude)
 */
function valueAtRisk(dailyReturns, confidence = 0.95) {
  if (!dailyReturns.length) return 0;
  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return -sorted[Math.max(0, idx)];
}

/**
 * Conditional Value at Risk (Expected Shortfall).
 * @param {number[]} dailyReturns
 * @param {number} confidence - e.g. 0.95
 * @returns {number} CVaR as a positive number (expected loss beyond VaR)
 */
function conditionalVaR(dailyReturns, confidence = 0.95) {
  if (!dailyReturns.length) return 0;
  const sorted = [...dailyReturns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * sorted.length);
  const tail = sorted.slice(0, Math.max(1, cutoff));
  return -mean(tail);
}

/**
 * Portfolio variance given weights and covariance matrix.
 * @param {number[]} weights
 * @param {number[][]} covMatrix - NxN covariance matrix
 */
function portfolioVariance(weights, covMatrix) {
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      variance += weights[i] * weights[j] * covMatrix[i][j];
    }
  }
  return variance;
}

/**
 * Compute NxN covariance matrix from N arrays of daily returns.
 * @param {number[][]} returnMatrix - array of N return series
 */
function covarianceMatrix(returnMatrix) {
  const n = returnMatrix.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const means = returnMatrix.map(mean);
  const T = Math.min(...returnMatrix.map(r => r.length));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let cov = 0;
      for (let t = 0; t < T; t++) {
        cov += (returnMatrix[i][t] - means[i]) * (returnMatrix[j][t] - means[j]);
      }
      cov /= (T - 1);
      matrix[i][j] = cov;
      matrix[j][i] = cov;
    }
  }
  return matrix;
}

/**
 * Portfolio optimizer (sequential least-squares / gradient descent).
 * Maximizes: ETR - lambda1 * portfolioVariance - lambda2 * CVaR
 * Subject to: sum(weights) = 1, all weights >= 0
 *
 * @param {number[]} expectedReturns - predicted annual returns per asset
 * @param {number[][]} covMatrix      - NxN covariance matrix
 * @param {number[]} dailyReturnSeries - array of daily return arrays for CVaR
 * @param {object}  params             - { lambda1, lambda2, confidence }
 * @returns {{ weights: number[], metrics: object }}
 */
function optimizePortfolio(expectedReturns, covMatrix, dailyReturnSeries, params = {}) {
  const { lambda1 = 0.5, lambda2 = 0.3, confidence = 0.95 } = params;
  const n = expectedReturns.length;

  // Objective function (we minimise the negative)
  function objective(weights) {
    const etr = weights.reduce((s, w, i) => s + w * expectedReturns[i], 0);
    const risk = portfolioVariance(weights, covMatrix);
    // Portfolio CVaR: weighted blend of individual daily returns
    const T = dailyReturnSeries[0].length;
    const portfolioReturns = Array.from({ length: T }, (_, t) =>
      weights.reduce((s, w, i) => s + w * (dailyReturnSeries[i][t] || 0), 0)
    );
    const cvar = conditionalVaR(portfolioReturns, confidence);
    return -(etr - lambda1 * risk - lambda2 * cvar);
  }

  // Simple projected gradient descent with weight clipping
  let weights = new Array(n).fill(1 / n);
  const lr = 0.01;
  const iters = 2000;

  for (let iter = 0; iter < iters; iter++) {
    const grad = new Array(n).fill(0);
    const eps = 1e-5;
    const base = objective(weights);
    for (let i = 0; i < n; i++) {
      const wPlus = [...weights];
      wPlus[i] += eps;
      grad[i] = (objective(wPlus) - base) / eps;
    }
    // Gradient step
    let newWeights = weights.map((w, i) => Math.max(0, w - lr * grad[i]));
    // Project onto simplex (normalize to sum=1)
    const total = newWeights.reduce((s, w) => s + w, 0);
    if (total > 0) newWeights = newWeights.map(w => w / total);
    weights = newWeights;
  }

  const etr = weights.reduce((s, w, i) => s + w * expectedReturns[i], 0);
  const risk = portfolioVariance(weights, covMatrix);

  return {
    weights,
    metrics: {
      expectedTotalReturn: etr,
      portfolioVariance: risk,
      portfolioStdDev: Math.sqrt(risk),
    },
  };
}

/**
 * Shannon entropy of weight vector (portfolio diversity).
 * Higher = more diversified.
 */
function entropy(weights) {
  const result = -weights.reduce((s, w) => {
    if (w <= 0) return s;
    return s + w * Math.log(w);
  }, 0);
  return result === 0 ? 0 : result; // Avoid -0 (which fails Object.is comparison)
}

/**
 * Effective Number of Bets = 1 / sum(wi^2)
 * Higher = more diversified.
 */
function effectiveNumberOfBets(weights) {
  const sumSq = weights.reduce((s, w) => s + w * w, 0);
  if (sumSq === 0) return 0;
  return 1 / sumSq;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = {
  mean,
  std,
  annualisedVol,
  annualisedReturn,
  totalReturn,
  sharpeRatio,
  sortinoRatio,
  maxDrawdown,
  calmarRatio,
  valueAtRisk,
  conditionalVaR,
  portfolioVariance,
  covarianceMatrix,
  optimizePortfolio,
  entropy,
  effectiveNumberOfBets,
  cosineSimilarity,
};
