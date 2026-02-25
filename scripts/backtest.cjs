#!/usr/bin/env node
'use strict';

/**
 * backtest.cjs — Run a historical simulation.
 *
 * Usage:
 *   node scripts/backtest.cjs --start 2024-01-01 --end 2024-01-31
 *   node scripts/backtest.cjs --mock --days 30
 *   node scripts/backtest.cjs --mock --days 90 --capital 50000
 */

const path = require('path');
const fs   = require('fs');
const { runSimulation } = require('../src/index.cjs');
const { formatMetricsTable } = require('../src/portfolio/metrics.cjs');
const logger = require('../src/utils/logger.cjs');

const MOD = 'scripts:backtest';

// ─── Parse args ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mock: false, days: 30, start: null, end: null, capital: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--mock':    opts.mock    = true; break;
      case '--days':    opts.days    = parseInt(args[++i]); break;
      case '--start':   opts.start   = args[++i]; break;
      case '--end':     opts.end     = args[++i]; break;
      case '--capital': opts.capital = parseInt(args[++i]); break;
      case '--help': printHelp(); process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
HedgeAgents Backtest Runner
══════════════════════════
Usage:
  node scripts/backtest.cjs [options]

Options:
  --start YYYY-MM-DD   Start date (real market data via Yahoo Finance)
  --end   YYYY-MM-DD   End date
  --mock               Use synthetic mock data (no API calls, instant)
  --days  N            Number of days for mock run (default: 30)
  --capital N          Override starting capital (default: from config)
  --help               Show this help

Examples:
  node scripts/backtest.cjs --mock --days 30
  node scripts/backtest.cjs --start 2024-01-01 --end 2024-03-31
`);
}

// ─── Write equity curve CSV ───────────────────────────────────────────────────

function writeEquityCurve(equityCurve, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, `equity-curve-${Date.now()}.csv`);
  const rows = ['day,value'];
  equityCurve.forEach((v, i) => rows.push(`${i},${v.toFixed(2)}`));
  fs.writeFileSync(outPath, rows.join('\n'));
  logger.info(MOD, `Equity curve saved: ${outPath}`);
  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  logger.info(MOD, '═'.repeat(60));
  logger.info(MOD, 'HedgeAgents Backtest');
  if (opts.mock) logger.info(MOD, `Mode: MOCK (${opts.days} days synthetic data)`);
  else           logger.info(MOD, `Mode: REAL DATA (${opts.start} → ${opts.end})`);
  logger.info(MOD, '═'.repeat(60));

  // Override capital if specified
  if (opts.capital) {
    const config = require('../src/config.cjs');
    config.portfolio.startingCapital = opts.capital;
    logger.info(MOD, `Starting capital overridden: $${opts.capital}`);
  }

  const startTime = Date.now();
  const { metrics, portfolio } = await runSimulation(opts);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Print results
  logger.info(MOD, '\n' + '═'.repeat(60));
  logger.info(MOD, 'BACKTEST RESULTS');
  logger.info(MOD, '═'.repeat(60));
  logger.info(MOD, '\n' + formatMetricsTable(metrics));
  logger.info(MOD, `\nFinal portfolio value: $${portfolio.totalValue}`);
  logger.info(MOD, `Total return: ${portfolio.totalReturn}%`);
  logger.info(MOD, `Elapsed: ${elapsed}s`);

  // Save equity curve
  const outputDir = path.join(__dirname, '../tests/e2e/output');
  const { PortfolioTracker } = require('../src/portfolio/tracker.cjs');
  // Note: tracker is inside runSimulation scope — metrics include summary
  writeEquityCurve([portfolio.startingCapital * (1 + metrics.TR / 100)], outputDir);

  return metrics;
}

main().then(metrics => {
  logger.info(MOD, `✅ Backtest complete. TR=${metrics.TR}% | SR=${metrics.SR}`);
  process.exit(0);
}).catch(err => {
  logger.error(MOD, `Backtest failed: ${err.message}`, err.stack);
  process.exit(1);
});
