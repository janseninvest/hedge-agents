# HedgeAgents 🏦

**Modular multi-agent LLM financial analysis system** — faithful replication of the [HedgeAgents paper](https://arxiv.org/abs/2502.13165) (WWW '25), packaged as a reusable template for trading, investment, and risk analysis.

> "70% annualised return, 400% total return over 3 years" — the original paper with GPT-4.  
> This implementation uses **Claude Sonnet 4.6** via the Anthropic API.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    ORCHESTRATOR                      │
│  Daily tick driver + conference scheduler            │
└──────────────┬─────────────────────────┬─────────────┘
               │                         │
      ┌────────▼──────┐        ┌─────────▼──────────────┐
      │   Otto        │◄──────►│  Dave / Bob / Emily     │
      │  (Manager)    │ 3 conf │  (Analyst Agents)       │
      └───────────────┘        └────────────────────────┘
```

**4 Agents** (all XML-profile-driven, swappable):
| Agent | Role | Asset | Key Tools |
|-------|------|-------|-----------|
| **Dave** | Bitcoin Analyst | BTC-USD | Technical indicators, blockchain metrics, Fear & Greed |
| **Bob** | DJ30 Analyst | ^DJI | Technical, fundamental valuation, sector rotation |
| **Emily** | FX Analyst | EURUSD=X | Central bank monitor, IR differential, geo-risk |
| **Otto** | Fund Manager | All | Portfolio optimizer, stress test, correlation matrix |

**3 Conference Types** (from paper):
| Conference | Trigger | Purpose |
|------------|---------|---------|
| **BAC** (Budget Allocation) | Every 30 trading days | Re-allocate capital based on performance |
| **ESC** (Experience Sharing) | Every 30 trading days | Cross-domain learning, update M_GE memory |
| **EMC** (Extreme Market) | >5% daily or >10% 3-day move | Crisis management |

**Memory System** (3 types per agent):
- `M_MI` — Market Information (raw market state per tick)
- `M_IR` — Investment Reflection (post-decision outcomes + lessons)
- `M_GE` — General Experience (cross-agent wisdom from ESC)

## Quick Start

```bash
git clone https://github.com/janseninvest/hedge-agents
cd hedge-agents
npm install

# Copy and fill in your API key
cp .env.example .secrets
# Edit .secrets: add ANTHROPIC_API_KEY=sk-ant-...

# Run a 30-day mock simulation (no API keys needed for market data)
node src/index.cjs --mock --days 30

# Backtest on real data
node src/index.cjs --start 2024-01-01 --end 2024-01-31

# Paper trade (today's real market)
node scripts/paper-trade.cjs
```

## Configuration

All config is in `config/` — no code changes needed to customise:

| File | Controls |
|------|----------|
| `agents.json` | Which agents, which assets |
| `data-sources.json` | Market data + news feeds |
| `portfolio.json` | Starting capital, risk params (λ1, λ2, λ3) |
| `schedule.json` | BAC/ESC intervals, EMC thresholds |
| `llm.json` | Model, max tokens per prompt type |

Agent personas are XML files in `profiles/` — fully swappable.

## Creating a New Domain

1. Copy `templates/new-analyst.xml` → `profiles/your-analyst.xml`
2. Edit `config/agents.json` — change names, assets, profile filenames
3. Edit `config/data-sources.json` — point to your data sources
4. Add domain-specific tools to `src/tools/domain.cjs`
5. Run `node scripts/seed-memory.cjs` to pre-populate expert rules

See `templates/README.md` for detailed guide and examples (crypto-only, macro, equity-sector).

## Performance Metrics (PRUDEX)

| Metric | Description |
|--------|-------------|
| **TR** | Total Return (%) |
| **ARR** | Annual Return Rate (%) |
| **SR** | Sharpe Ratio |
| **CR** | Calmar Ratio |
| **SoR** | Sortino Ratio |
| **MDD** | Maximum Drawdown (%) |
| **Vol** | Annualised Volatility (%) |
| **ENT** | Portfolio Entropy (diversity) |
| **ENB** | Effective Number of Bets |

## Stack

- **LLM**: Claude Sonnet 4.6 (Anthropic API) — same as BrewBoard
- **Memory**: SQLite (`better-sqlite3`) + TF-IDF cosine similarity retrieval
- **Embeddings**: Voyage AI (`voyage-finance-2`) optional upgrade for better memory retrieval
- **Market data**: `yahoo-finance2` (free, no API key required)
- **News**: Alpaca News API (free tier) or RSS feeds (zero config)
- **Runtime**: Node.js 18+ CJS — no transpile, no bundler

## Based On

> Ziyan Liu, Yilin Guo et al. (2025). *HedgeAgents: A Balanced-aware Multi-agent Financial Trading System.* WWW '25.  
> Paper: https://arxiv.org/abs/2502.13165  
> Demo: https://hedgeagents.github.io

## License

MIT
