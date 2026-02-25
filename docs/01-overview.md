# Chapter 1 — System Overview

## What Is HedgeAgents?

HedgeAgents is a **multi-agent LLM-powered financial analysis system** that simulates the internal architecture of a real hedge fund. Instead of a single AI making all investment decisions, it deploys a team of specialized agents — each with their own domain expertise, memory, tools, and decision-making process — that collaborate through structured conferences.

The system was originally described in the academic paper:
> *"HedgeAgents: A Balanced-aware Multi-agent Financial Trading System"*  
> Ziyan Liu et al., WWW '25 — [arxiv.org/abs/2502.13165](https://arxiv.org/abs/2502.13165)

The original paper demonstrated **70% annualised return, 400% total return over 3 years** using GPT-4. This implementation uses **Claude Sonnet 4.6**.

---

## The Core Problem Being Solved

Single-agent LLM trading systems suffer from several fundamental weaknesses:

| Problem | Single Agent | HedgeAgents Solution |
|---------|-------------|----------------------|
| **Narrow expertise** | One model covers all assets | Specialist agents per asset class |
| **No learning** | No memory between sessions | 3 memory types persist decisions + lessons |
| **No cross-validation** | Decisions unchecked | Peers challenge each other in conferences |
| **Static risk** | Fixed allocation | Dynamic budget reallocation every 30 days |
| **Crisis blindness** | No emergency response | Automatic Extreme Market Conference |
| **Overconfidence** | Self-consistent echo chamber | Manager synthesizes divergent views |

---

## High-Level Architecture

```mermaid
graph TB
    subgraph EXTERNAL["External Data Sources"]
        MD[Market Data<br/>Yahoo Finance]
        NEWS[News Feeds<br/>RSS / Alpaca]
    end

    subgraph CORE["HedgeAgents Core System"]
        ORCH[Orchestrator<br/>Daily Tick Driver]
        
        subgraph AGENTS["Agent Layer"]
            OTTO[Otto<br/>Fund Manager]
            DAVE[Dave<br/>Bitcoin Analyst]
            BOB[Bob<br/>DJ30 Analyst]
            EMILY[Emily<br/>FX Analyst]
        end

        subgraph MEMORY["Memory Layer"]
            MMI[(M_MI<br/>Market Info)]
            MIR[(M_IR<br/>Reflections)]
            MGE[(M_GE<br/>Experience)]
        end

        subgraph TOOLS["Tool Layer"]
            TECH[Technical<br/>Indicators]
            RISK[Risk<br/>Metrics]
            DOM[Domain<br/>Tools]
        end

        subgraph CONFERENCES["Conference Layer"]
            BAC[BAC<br/>Budget]
            ESC[ESC<br/>Experience]
            EMC[EMC<br/>Crisis]
        end

        LLM[Claude Sonnet 4.6<br/>Anthropic API]
        PORT[Portfolio Tracker]
        PRUDEX[PRUDEX Metrics]
    end

    MD --> ORCH
    NEWS --> ORCH
    ORCH --> DAVE & BOB & EMILY
    ORCH --> OTTO
    DAVE & BOB & EMILY --> TOOLS
    TOOLS --> LLM
    MEMORY --> LLM
    LLM --> DAVE & BOB & EMILY
    DAVE & BOB & EMILY --> PORT
    DAVE & BOB & EMILY --> MEMORY
    OTTO --> BAC & ESC & EMC
    BAC & ESC & EMC --> LLM
    PORT --> PRUDEX

    style EXTERNAL fill:#f0f4f8
    style CORE fill:#fff
    style AGENTS fill:#e8f4fd
    style MEMORY fill:#fef9e7
    style TOOLS fill:#e9f7ef
    style CONFERENCES fill:#fdf2f8
```

---

## The Four Agents at a Glance

```mermaid
graph LR
    subgraph ANALYSTS["Specialist Analysts"]
        DAVE["🟠 Dave<br/>Bitcoin Analyst<br/>Asset: BTC-USD<br/>Tools: 12 (crypto-focused)"]
        BOB["🔵 Bob<br/>DJ30 Analyst<br/>Asset: ^DJI<br/>Tools: 12 (equities-focused)"]
        EMILY["🟣 Emily<br/>FX Analyst<br/>Asset: EURUSD=X<br/>Tools: 12 (forex-focused)"]
    end

    subgraph MANAGER["Portfolio Manager"]
        OTTO["🟢 Otto<br/>Hedge Fund Manager<br/>Asset: ALL<br/>Tools: 6 (portfolio-level)"]
    end

    DAVE -->|Reports performance,<br/>requests budget| OTTO
    BOB -->|Reports performance,<br/>requests budget| OTTO
    EMILY -->|Reports performance,<br/>requests budget| OTTO
    OTTO -->|Allocates budget weights<br/>Issues guidance| DAVE & BOB & EMILY

    DAVE <-->|Share cases &<br/>cross-domain insight| BOB
    BOB <-->|Share cases &<br/>cross-domain insight| EMILY
    DAVE <-->|Share cases &<br/>cross-domain insight| EMILY
```

---

## Three Types of Collaboration (Conferences)

```mermaid
graph TD
    subgraph BAC["💼 Budget Allocation Conference (Every 30 days)"]
        B1[Analysts report P&L + budget request] --> B2[Otto runs portfolio optimizer]
        B2 --> B3[Otto decides final weights]
        B3 --> B4[Budget weights updated]
    end

    subgraph ESC["🔄 Experience Sharing Conference (Every 30 days)"]
        E1[Each analyst presents best trade] --> E2[Peers give cross-domain feedback]
        E2 --> E3[Insights distilled into M_GE]
    end

    subgraph EMC["🚨 Extreme Market Conference (Triggered by >5% daily move)"]
        C1[Crisis agent presents loss situation] --> C2[Peers offer aggressive/conservative suggestions]
        C2 --> C3[Otto synthesizes balanced guidance]
        C3 --> C4[Crisis agent makes final decision]
    end
```

---

## Technology Stack

```mermaid
graph LR
    subgraph RUNTIME["Runtime"]
        NODE[Node.js v22<br/>CommonJS modules]
    end

    subgraph LLM_LAYER["LLM Layer"]
        CLAUDE[Anthropic API<br/>Claude Sonnet 4.6<br/>Pure HTTPS, no SDK]
        VOYAGE[Voyage AI<br/>voyage-finance-2<br/>Embeddings - optional]
    end

    subgraph DATA_LAYER["Data Layer"]
        SQLITE[SQLite<br/>better-sqlite3<br/>Memory + Portfolio]
        YAHOO[Yahoo Finance<br/>yahoo-finance2<br/>OHLCV data]
        RSS[RSS Feeds<br/>News headlines<br/>Free, no API key]
    end

    subgraph MATH["Math Layer"]
        MATH[Pure JS Math<br/>No native deps<br/>Portfolio optimization]
    end

    NODE --> CLAUDE
    NODE --> VOYAGE
    NODE --> SQLITE
    NODE --> YAHOO
    NODE --> RSS
    NODE --> MATH
```

---

## Data Flow: One Trading Day

```mermaid
sequenceDiagram
    participant ORCH as Orchestrator
    participant MD as Market Data
    participant NEWS as News Provider
    participant OTTO as Otto (Manager)
    participant DAVE as Dave (Bitcoin)
    participant BOB as Bob (DJ30)
    participant EMILY as Emily (FX)
    participant PORT as Portfolio
    participant DB as SQLite DB

    ORCH->>MD: Fetch OHLCV for BTC, DJI, EURUSD
    MD-->>ORCH: Price data (cached if available)
    ORCH->>NEWS: Fetch headlines per asset
    NEWS-->>ORCH: Up to 10 headlines each

    ORCH->>OTTO: checkEMCTrigger(priceChanges)
    Note over OTTO: Check if any asset moved >5%
    OTTO-->>ORCH: triggered=false (normal day)

    par Parallel analyst ticks
        ORCH->>DAVE: tick(date, btcOHLCV, btcNews)
        ORCH->>BOB: tick(date, djiOHLCV, djiNews)
        ORCH->>EMILY: tick(date, fxOHLCV, fxNews)
    end

    Note over DAVE,EMILY: Each runs: tools → Qt → memory → LLM → action

    DAVE-->>PORT: executeAction(Buy, 0.30, $45000)
    BOB-->>PORT: executeAction(Hold, 0, $38000)
    EMILY-->>PORT: executeAction(Buy, 0.20, $1.09)

    DAVE->>DB: insertMemory(M_MI: market snapshot)
    BOB->>DB: insertMemory(M_MI: market snapshot)
    EMILY->>DB: insertMemory(M_MI: market snapshot)

    ORCH->>DAVE: processPendingReflections (from yesterday)
    ORCH->>PORT: recordDailySnapshot
    PORT->>DB: savePortfolioState
    ORCH->>DB: check if BAC/ESC due
```

---

## File Structure

```
hedge-agents/
├── config/                 ← All configuration (no code changes needed)
│   ├── agents.json         ← Who the agents are + which assets
│   ├── data-sources.json   ← Market data + news feed config
│   ├── portfolio.json      ← Capital, risk params (λ1, λ2, λ3)
│   ├── schedule.json       ← Conference intervals, EMC thresholds
│   └── llm.json            ← Model, tokens per prompt type
│
├── profiles/               ← Agent personalities (XML, swappable)
│   ├── dave.xml            ← Bitcoin Analyst
│   ├── bob.xml             ← DJ30 Analyst
│   ├── emily.xml           ← FX Analyst
│   └── otto.xml            ← Hedge Fund Manager
│
├── src/
│   ├── config.cjs          ← Config loader (merges JSON + env vars)
│   ├── index.cjs           ← Main orchestrator
│   ├── llm/
│   │   ├── claude-client.cjs   ← Anthropic API client
│   │   └── prompt-builder.cjs  ← All 12 prompt templates
│   ├── memory/
│   │   ├── memory-store.cjs    ← SQLite CRUD for all memory types
│   │   └── embeddings.cjs      ← TF-IDF + Voyage AI retrieval
│   ├── tools/
│   │   ├── technical.cjs       ← RSI, MACD, BB, ATR, Stochastic...
│   │   ├── risk.cjs            ← VaR, CVaR, Sharpe, Sortino, MDD
│   │   ├── domain.cjs          ← Crypto, equities, FX, portfolio tools
│   │   └── registry.cjs        ← Tool dispatcher
│   ├── agents/
│   │   ├── base-agent.cjs      ← Core loop (all agents inherit)
│   │   ├── analyst-agent.cjs   ← Dave, Bob, Emily
│   │   ├── manager-agent.cjs   ← Otto
│   │   └── profile-loader.cjs  ← XML → JS object
│   ├── conferences/
│   │   ├── bac.cjs             ← Budget Allocation Conference
│   │   ├── esc.cjs             ← Experience Sharing Conference
│   │   └── emc.cjs             ← Extreme Market Conference
│   ├── data/
│   │   ├── market-data.cjs     ← Yahoo Finance wrapper + mock
│   │   └── news-provider.cjs   ← Alpaca / RSS / mock headlines
│   ├── portfolio/
│   │   ├── tracker.cjs         ← Position tracking, trade execution
│   │   └── metrics.cjs         ← PRUDEX (9 metrics)
│   └── utils/
│       ├── logger.cjs          ← Structured colored console logger
│       ├── math.cjs            ← Stats, portfolio optimizer, cosine sim
│       └── date-utils.cjs      ← Trading calendar helpers
│
├── scripts/
│   ├── backtest.cjs        ← Historical simulation runner
│   ├── paper-trade.cjs     ← Live paper trading (one day)
│   └── seed-memory.cjs     ← Pre-populate expert principles
│
├── templates/
│   ├── README.md           ← Domain swap guide
│   └── example-domains/    ← Crypto-only, macro, equity-sector configs
│
├── tests/
│   ├── unit/               ← 87 unit tests (tools, memory, portfolio, profiles)
│   └── integration/        ← 6 integration tests (agent loop, BAC)
│
└── data/
    └── hedge-agents.db     ← SQLite database (auto-created)
```
