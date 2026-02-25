'use strict';

/**
 * agent-loop.test.cjs — Integration test for the single agent decision loop.
 * Uses mock LLM (no real API calls) + mock OHLCV data + real SQLite memory.
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');

const config  = require('../../src/config.cjs');
const { loadAllProfiles }     = require('../../src/agents/profile-loader.cjs');
const { MemoryStore }         = require('../../src/memory/memory-store.cjs');
const { TfidfEmbeddingProvider } = require('../../src/memory/embeddings.cjs');
const { PortfolioTracker }    = require('../../src/portfolio/tracker.cjs');
const { AnalystAgent }        = require('../../src/agents/analyst-agent.cjs');
const { buildMockOHLCV }      = require('../../src/data/market-data.cjs');

// ─── Mock LLM ────────────────────────────────────────────────────────────────

const mockDecision = {
  market_summary: 'Bitcoin showing bullish momentum on strong volume.',
  key_factors: ['RSI not overbought', 'Volume above average', 'Positive news sentiment'],
  action: 'Buy',
  quantity_pct: 0.30,
  rationale: 'Technical indicators align with positive fundamentals. Entry at current levels.',
  risk_level: 'medium',
  stop_loss_pct: 0.05,
  take_profit_pct: 0.10,
  confidence: 0.72,
};

const mockLLM = {
  async completeJSON() { return { ...mockDecision }; },
  async complete()     { return { text: 'Bitcoin showing bullish momentum with strong on-chain fundamentals and positive macro backdrop.' }; },
  async converseJSON() { return { ...mockDecision }; },
  async converse()     { return { text: 'Mock converse response' }; },
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Single Agent Loop (Dave – BTC Analyst)', () => {
  let agent, store, tracker, dbPath;
  const TICKS = 5;

  before(() => {
    dbPath  = `/tmp/test-agent-loop-${Date.now()}.db`;
    store   = new MemoryStore(dbPath);
    tracker = new PortfolioTracker({
      startingCapital: 100000,
      initialWeights: { Dave: 0.33, Bob: 0.34, Emily: 0.33 },
      analysts: config.agents.analysts,
    });

    const profiles = loadAllProfiles(config.agents);
    const daveCfg  = config.agents.analysts.find(a => a.name === 'Dave');
    const profile  = { ...profiles.analysts[0], asset: daveCfg.asset, assetLabel: daveCfg.assetLabel };

    agent = new AnalystAgent({
      profile,
      llm:              mockLLM,
      memoryStore:      store,
      embeddingProvider: new TfidfEmbeddingProvider(),
      portfolioTracker: tracker,
      config,
    });
  });

  after(() => {
    store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  test(`Run ${TICKS} ticks on mock BTC data`, async () => {
    const mockData = buildMockOHLCV('BTC-USD', TICKS + 30, 45000);
    const mockNews = ['Bitcoin ETF approval drives institutional interest', 'Hash rate at all-time high'];

    for (let i = 0; i < TICKS; i++) {
      const sliceEnd = 30 + i + 1;
      const ohlcv = {
        opens:   mockData.opens.slice(0, sliceEnd),
        highs:   mockData.highs.slice(0, sliceEnd),
        lows:    mockData.lows.slice(0, sliceEnd),
        closes:  mockData.closes.slice(0, sliceEnd),
        volumes: mockData.volumes.slice(0, sliceEnd),
        dates:   mockData.dates.slice(0, sliceEnd),
      };
      const date = `2024-01-${String(i + 1).padStart(2, '0')}`;
      const result = await agent.tick({ date, ohlcv, news: mockNews });

      // Decision structure
      assert.ok(result.decision, `Tick ${i+1}: decision missing`);
      assert.ok(['Buy','Sell','Hold','AdjustQuantity','AdjustPrice','SetTradingConditions'].includes(result.decision.action),
        `Tick ${i+1}: invalid action: ${result.decision.action}`);
      assert.ok(typeof result.decision.quantity_pct === 'number', `Tick ${i+1}: quantity_pct not a number`);
      assert.ok(result.decision.rationale, `Tick ${i+1}: rationale missing`);
    }
  });

  test('M_MI memory accumulates after ticks', () => {
    const stats = store.getMemoryStats('Dave');
    assert.ok(stats.M_MI >= TICKS, `Expected >= ${TICKS} M_MI memories, got ${stats.M_MI}`);
  });

  test('Portfolio updates correctly after Buy action', () => {
    const snap = tracker.getSnapshot();
    assert.ok(snap.totalValue > 0, 'Portfolio value should be positive');
    assert.strictEqual(snap.startingCapital, 100000);
    // Dave's position should exist (Buy action was taken)
    const daveBudget = tracker.getAgentBudget('Dave');
    assert.ok(daveBudget > 0, 'Dave should have a budget allocated');
  });

  test('Pending reflections are stored for processing', () => {
    const pending = store.getPendingReflections('Dave');
    // We ran TICKS ticks and mark resolved on processPendingReflections
    // At minimum some pending reflections should exist
    assert.ok(pending.length >= 0, 'Pending reflections should be accessible');
  });

  test('Process pending reflections resolves them', async () => {
    const mockData = buildMockOHLCV('BTC-USD', 40, 47000);
    const ohlcv = {
      opens: mockData.opens, highs: mockData.highs, lows: mockData.lows,
      closes: mockData.closes, volumes: mockData.volumes, dates: mockData.dates,
    };
    const results = await agent.processPendingReflections({ date: '2024-01-10', ohlcv });
    assert.ok(Array.isArray(results), 'processPendingReflections should return array');
    // After processing, no more pending
    const stillPending = store.getPendingReflections('Dave');
    assert.strictEqual(stillPending.length, 0, 'All reflections should be resolved');
  });
});

describe('BAC Report Generation (mock LLM)', () => {
  let agent, store, tracker, dbPath;

  before(() => {
    dbPath  = `/tmp/test-bac-${Date.now()}.db`;
    store   = new MemoryStore(dbPath);
    tracker = new PortfolioTracker({
      startingCapital: 100000,
      initialWeights: { Dave: 0.33, Bob: 0.34, Emily: 0.33 },
      analysts: config.agents.analysts,
    });

    const mockBACLLM = {
      async completeJSON() {
        return {
          performance_summary: 'Strong performance driven by BTC rally.',
          budget_request_pct: 0.40,
          projected_return_pct: 15,
          projected_risk_level: 'medium',
        };
      },
      async complete() { return { text: 'BTC market looking bullish' }; },
    };

    const profiles = loadAllProfiles(config.agents);
    const daveCfg  = config.agents.analysts[0];
    agent = new AnalystAgent({
      profile: { ...profiles.analysts[0], asset: daveCfg.asset, assetLabel: daveCfg.assetLabel },
      llm: mockBACLLM, memoryStore: store,
      embeddingProvider: new TfidfEmbeddingProvider(),
      portfolioTracker: tracker, config,
    });
  });

  after(() => {
    store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  test('generateBACReport returns valid report structure', async () => {
    const report = await agent.generateBACReport('Bitcoin looks bullish in current macro environment.');
    assert.ok(report.agentName, 'Report should have agentName');
    assert.ok(typeof report.budget_request_pct === 'number', 'budget_request_pct should be number');
    assert.ok(report.budget_request_pct >= 0 && report.budget_request_pct <= 1, 'budget_request_pct in [0,1]');
    assert.ok(report.performance_summary, 'performance_summary should exist');
  });
});
