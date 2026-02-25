#!/usr/bin/env node
'use strict';

/**
 * seed-memory.cjs — Pre-populate agent M_GE (General Experience) memories.
 *
 * Seeds each analyst with expert investment principles before first run.
 * This gives agents a head start rather than starting with empty memory.
 *
 * Usage:
 *   node scripts/seed-memory.cjs
 *   node scripts/seed-memory.cjs --agent Dave    (seed specific agent only)
 */

const logger   = require('../src/utils/logger.cjs');
const config   = require('../src/config.cjs');
const { MemoryStore } = require('../src/memory/memory-store.cjs');
const { TfidfEmbeddingProvider, indexMemories } = require('../src/memory/embeddings.cjs');

const MOD = 'scripts:seed';

// ─── Expert principles per agent ─────────────────────────────────────────────

const SEEDS = {
  Dave: [
    { principle: 'Bitcoin halving cycles historically precede 12-18 month bull markets. Reduce position size in the 30 days before a halving to rebalance risk, then increase exposure gradually as the cycle confirms.', tags: ['halving', 'cycle', 'bitcoin', 'position-sizing'] },
    { principle: 'Never allocate more than 70% of Bitcoin budget in a single position. Extreme volatility can cause 30-50% drawdowns in days. Cash reserves are essential for averaging down or opportunistic buys.', tags: ['risk', 'position-sizing', 'volatility', 'cash'] },
    { principle: 'When RSI crosses above 70 after a sustained uptrend AND the Fear & Greed index exceeds 75, consider reducing 25-30% of holdings. Overbought conditions in crypto can persist but frequently precede sharp corrections.', tags: ['rsi', 'sentiment', 'overbought', 'exit'] },
    { principle: 'Regulatory news from major jurisdictions (US SEC, China, EU MiCA) can cause 10-20% moves within 24 hours. Always maintain a news scanner for regulatory keywords and reduce leverage during high-uncertainty periods.', tags: ['regulation', 'risk', 'news', 'bitcoin'] },
    { principle: 'The Accumulation/Distribution Line diverging from price often precedes trend reversals by 3-7 days. When ADL trends downward while price rises, begin staged selling. When ADL rises while price falls, consider accumulation.', tags: ['technical', 'adl', 'divergence', 'signal'] },
  ],
  Bob: [
    { principle: 'Earnings seasons (January, April, July, October) historically drive DJ30 volatility up 15-25%. Reduce concentrated positions 1 week before major Dow components report. Re-enter after guidance is confirmed.', tags: ['earnings', 'seasonality', 'dj30', 'volatility'] },
    { principle: 'The yield curve (10Y-2Y spread) is a leading indicator for DJ30 performance 6-12 months ahead. Inverted yield curve periods historically precede recessions — shift to defensive sectors and reduce cyclical exposure.', tags: ['macro', 'yield-curve', 'recession', 'sector'] },
    { principle: 'When DJ30 P/E ratio exceeds 25x (historically elevated), risk-adjusted returns are typically lower. Consider equal-weighting between DJ30 and cash/bonds during high-valuation periods to reduce concentration risk.', tags: ['valuation', 'pe-ratio', 'risk-management', 'dj30'] },
    { principle: 'Sector rotation: Technology and Consumer Discretionary lead early bull markets. Utilities and Consumer Staples outperform late cycle and in recessions. Monitor sector relative strength for rotation signals.', tags: ['sector-rotation', 'bull-market', 'defensive', 'cycle'] },
    { principle: 'Fed policy changes are the single largest exogenous risk for DJ30. Rate hike cycles historically compress P/E multiples by 15-20%. Maintain higher cash reserves during tightening cycles.', tags: ['fed', 'interest-rates', 'pe-compression', 'monetary-policy'] },
  ],
  Emily: [
    { principle: 'Central bank rate differentials drive EUR/USD long-term trends. When ECB-Fed rate differential widens > 100bps in favor of USD, expect USD strength. Monitor rate futures markets for forward guidance 3-6 months ahead.', tags: ['rate-differential', 'ecb', 'fed', 'eurusd'] },
    { principle: 'EUR/USD reacts strongly to CPI and NFP releases. In the 2 days before major US economic data, reduce position size by 30-50% to avoid whipsaw. Re-establish positions after the data confirms the directional move.', tags: ['cpi', 'nfp', 'economic-calendar', 'risk-management'] },
    { principle: 'Geopolitical risk in Europe (energy prices, conflict escalation) causes EUR weakness. Monitor natural gas prices as a proxy for European economic stress — sustained gas prices above €100/MWh correlate with EUR underperformance.', tags: ['geopolitical', 'energy', 'europe', 'risk'] },
    { principle: 'EUR/USD has historically respected key Fibonacci retracement levels (38.2%, 50%, 61.8%) on major swings. Combine Fibonacci levels with 200-day SMA as confluence zones for high-probability entries.', tags: ['fibonacci', 'technical', 'support-resistance', 'entry'] },
    { principle: 'The carry trade (borrowing low-yield currencies to fund high-yield) unwinds rapidly in risk-off environments. When VIX spikes above 25, expect carry trade unwind flows. Reduce FX positions and increase cash during risk-off events.', tags: ['carry-trade', 'vix', 'risk-off', 'fx'] },
  ],
  Otto: [
    { principle: 'Portfolio rebalancing is most effective when asset correlations break down during stress events. During market crises, traditional asset correlations spike toward 1.0 — maintain at least 15-20% in uncorrelated assets (commodities, cash) as permanent hedges.', tags: ['rebalancing', 'correlation', 'crisis', 'hedging'] },
    { principle: 'Kelly Criterion optimal position sizing: never allocate more than half-Kelly for any single bet. Over-betting causes portfolio ruin even with positive-expectancy strategies. Systematic position sizing is more important than individual trade selection.', tags: ['kelly', 'position-sizing', 'risk-management', 'systematic'] },
    { principle: 'CVaR (Conditional Value at Risk) is a more reliable risk measure than VaR during fat-tail events. When portfolio 95% CVaR exceeds 8% monthly, reduce overall risk by cutting the highest-volatility position first.', tags: ['cvar', 'var', 'tail-risk', 'risk-management'] },
    { principle: 'Diversification effectiveness measured by Effective Number of Bets (ENB). ENB < 1.5 signals dangerous concentration. Target ENB > 2.5 in normal markets. During bull markets, concentration in winners is acceptable if stop-losses are set.', tags: ['diversification', 'enb', 'concentration', 'portfolio'] },
  ],
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args      = process.argv.slice(2);
  const agentArg  = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;
  const agentsToSeed = agentArg ? [agentArg] : Object.keys(SEEDS);

  const store    = new MemoryStore(config.db.path);
  const provider = new TfidfEmbeddingProvider();

  let totalSeeded = 0;

  for (const agentName of agentsToSeed) {
    const seeds = SEEDS[agentName];
    if (!seeds) { logger.warn(MOD, `No seeds defined for agent: ${agentName}`); continue; }

    logger.info(MOD, `Seeding ${seeds.length} principles for ${agentName}...`);

    for (const seed of seeds) {
      const content = {
        type: 'seeded_principle',
        principle: seed.principle,
        tags: seed.tags,
        source: 'expert_seed',
        seeded_at: new Date().toISOString(),
      };

      const id = store.insertMemory({
        agentName,
        memoryType:     'M_GE',
        content,
        experienceScore: 0.9, // High score — expert-curated
      });

      // Index with TF-IDF
      const tokens = await provider.embed(seed.principle + ' ' + seed.tags.join(' '));
      store.updateMemory(id, { tfidfTokens: tokens });

      totalSeeded++;
      logger.debug(MOD, `  [${agentName}] Seeded: ${seed.principle.slice(0, 60)}...`);
    }

    const stats = store.getMemoryStats(agentName);
    logger.info(MOD, `  ${agentName}: ${stats.M_GE} M_GE memories total`);
  }

  store.close();
  logger.info(MOD, `✅ Seeded ${totalSeeded} expert principles across ${agentsToSeed.length} agents`);
  logger.info(MOD, `   DB: ${config.db.path}`);
}

main().catch(err => {
  logger.error(MOD, `Seed failed: ${err.message}`);
  process.exit(1);
});
