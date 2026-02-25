#!/usr/bin/env node
'use strict';

/**
 * paper-trade.cjs — Live paper trading using today's real market data.
 * Saves state between runs for continuity.
 *
 * Usage:
 *   node scripts/paper-trade.cjs
 *   node scripts/paper-trade.cjs --date 2024-03-15   (override date)
 */

const fs     = require('fs');
const path   = require('path');
const logger = require('../src/utils/logger.cjs');
const config = require('../src/config.cjs');
const { createClaudeClient }         = require('../src/llm/claude-client.cjs');
const { loadAllProfiles }            = require('../src/agents/profile-loader.cjs');
const { MemoryStore }                = require('../src/memory/memory-store.cjs');
const { createEmbeddingProvider }    = require('../src/memory/embeddings.cjs');
const { PortfolioTracker }           = require('../src/portfolio/tracker.cjs');
const { AnalystAgent }               = require('../src/agents/analyst-agent.cjs');
const { ManagerAgent }               = require('../src/agents/manager-agent.cjs');
const { MarketDataProvider }         = require('../src/data/market-data.cjs');
const { NewsProvider }               = require('../src/data/news-provider.cjs');
const { toDateStr }                  = require('../src/utils/date-utils.cjs');
const { computePRUDEX, formatMetricsTable } = require('../src/portfolio/metrics.cjs');

const STATE_FILE = path.join(__dirname, '../data/paper-trade-state.json');
const MOD = 'scripts:paper-trade';

// ─── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let date = toDateStr(new Date());
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') date = args[++i];
  }
  return { date };
}

// ─── State persistence ────────────────────────────────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return null; }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { date } = parseArgs();
  logger.info(MOD, `Paper trade: ${date}`);

  const llm        = createClaudeClient(config);
  const memStore   = new MemoryStore(config.db.path);
  const embeddings = createEmbeddingProvider(config);
  const profiles   = loadAllProfiles(config.agents);

  // Restore or initialise budget weights from saved state
  const savedState = loadState();
  const weights    = savedState?.budgetWeights || config.portfolio.initialBudgetWeights;

  const tracker = new PortfolioTracker({
    startingCapital: config.portfolio.startingCapital,
    initialWeights:  weights,
    analysts:        config.agents.analysts,
  });

  // Restore positions from saved state
  if (savedState?.positions) {
    for (const [name, pos] of Object.entries(savedState.positions)) {
      const agentPos = tracker.getPosition(name);
      if (agentPos && pos.qty > 0) {
        Object.assign(agentPos, pos);
      }
    }
    tracker._cash = savedState.cash || config.portfolio.startingCapital;
  }

  const analysts = profiles.analysts.map((profile, i) => {
    const analystCfg = config.agents.analysts[i];
    return new AnalystAgent({
      profile: { ...profile, asset: analystCfg.asset, assetLabel: analystCfg.assetLabel },
      llm, memoryStore: memStore, embeddingProvider: embeddings,
      portfolioTracker: tracker, config, analystConfig: analystCfg,
    });
  });

  const manager = new ManagerAgent({
    profile: profiles.manager,
    llm, memoryStore: memStore, embeddingProvider: embeddings,
    portfolioTracker: tracker, config,
  });

  // Fetch today's market data
  const marketData   = new MarketDataProvider({ cacheTtlHours: 1 });
  const newsProvider = new NewsProvider(config);
  const ohlcvByAgent = {};
  const currentPrices = {};

  for (const agent of analysts) {
    const symbol = agent.profile.asset;
    logger.info(MOD, `Fetching: ${symbol}`);
    ohlcvByAgent[agent.name] = await marketData.getRecentOHLCV(symbol, 100);
    const closes = ohlcvByAgent[agent.name].closes;
    currentPrices[agent.name] = closes[closes.length - 1];
  }

  // Check EMC
  const emcCheck = manager.checkEMCTrigger(ohlcvByAgent, config.schedule);
  if (emcCheck.triggered) {
    logger.warn(MOD, `🚨 EMC triggered: ${emcCheck.crisisAgentName} — ${emcCheck.reason}`);
  }

  // Run agent ticks
  logger.info(MOD, '\n' + '─'.repeat(50));
  const decisions = {};
  for (const agent of analysts) {
    const news = await newsProvider.getHeadlines(agent.profile.asset, 10).catch(() => []);
    const result = await agent.tick({ date, ohlcv: ohlcvByAgent[agent.name], news, prices: currentPrices });
    decisions[agent.name] = result.decision;
    logger.info(MOD, `[${agent.name}] ${result.decision.action} | conf=${result.decision.confidence} | ${result.decision.rationale?.slice(0, 80)}...`);
  }

  // Record snapshot
  tracker.updatePrices(currentPrices);
  tracker.recordDailySnapshot(date);

  const snap = tracker.getSnapshot();
  logger.info(MOD, '\n' + '─'.repeat(50));
  logger.info(MOD, `Portfolio: $${snap.totalValue} | Return: ${snap.totalReturn}%`);

  // PRUDEX metrics (if enough history)
  const returns = tracker.getDailyReturns();
  if (returns.length >= 5) {
    const metrics = computePRUDEX(returns, tracker.getEquityCurve(), snap.budgetWeights);
    logger.info(MOD, '\n' + formatMetricsTable(metrics));
  }

  // Save state
  saveState({
    date, decisions,
    budgetWeights: snap.budgetWeights,
    positions: snap.positions,
    cash: snap.cash,
    totalValue: snap.totalValue,
  });

  logger.info(MOD, `State saved to ${STATE_FILE}`);
  memStore.close();
}

main().catch(err => {
  logger.error(MOD, `Paper trade failed: ${err.message}`);
  process.exit(1);
});
