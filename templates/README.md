# Creating a New Domain with HedgeAgents

The entire system is configuration-driven. You can create a completely new analysis domain
(different assets, different analyst specialisations) without touching any core code.

## Step-by-Step

### 1. Copy and rename agent profiles

```bash
cp profiles/dave.xml profiles/btc-analyst.xml
cp profiles/otto.xml profiles/my-manager.xml
```

Edit the XML: change `<name>`, `<description>`, `<role>`, `<responsibleFor>`,
`<tool>` entries, and `<scope>` entries to match your domain.

### 2. Update config/agents.json

```json
{
  "manager": {
    "name": "Alexandra",
    "profile": "my-manager.xml",
    "type": "manager"
  },
  "analysts": [
    { "name": "Marco", "profile": "macro-analyst.xml", "type": "analyst", "asset": "GC=F",  "assetLabel": "Gold" },
    { "name": "Petra", "profile": "energy-analyst.xml","type": "analyst", "asset": "CL=F",  "assetLabel": "Crude Oil" },
    { "name": "Sven",  "profile": "rates-analyst.xml", "type": "analyst", "asset": "^TNX",  "assetLabel": "10Y Treasury" }
  ]
}
```

### 3. Update config/data-sources.json

Add RSS feeds or news keywords relevant to your domain.

### 4. Add domain-specific tools (optional)

In `src/tools/domain.cjs`, add functions for your domain and export them.
Then register them in `src/tools/registry.cjs` under the `TOOLS` object.

### 5. Seed expert knowledge

Edit `scripts/seed-memory.cjs` — add expert principles for each of your agents.
Then run:

```bash
node scripts/seed-memory.cjs
```

### 6. Run!

```bash
node src/index.cjs --mock --days 30    # test with synthetic data
node src/index.cjs --start 2024-01-01 --end 2024-12-31  # real backtest
```

---

## Example Domains

See `example-domains/` for ready-to-use configs:

| Domain | Analysts | Assets |
|--------|----------|--------|
| `crypto-only/` | BTC, ETH, SOL analysts | BTC-USD, ETH-USD, SOL-USD |
| `macro/` | Rates, Commodities, FX | ^TNX, GC=F, EURUSD=X |
| `equity-sector/` | Tech, Energy, Healthcare | XLK, XLE, XLV |

---

## Profile XML Reference

```xml
<profile>
  <name>YourAgentName</name>
  <description>
    Full personality description — will be used as the LLM system prompt.
    Be detailed. Include: expertise, style, risk tolerance, decision approach.
  </description>
  <basicInformation>
    <agentType>Investment Decision Agent</agentType>  <!-- or Portfolio Manager -->
    <role>Your Role Title</role>
    <responsibleFor>What asset or domain</responsibleFor>
    <roleAssignment>One-line summary of their job</roleAssignment>
  </basicInformation>
  <actionPermissions>
    <action>Buy</action>
    <action>Sell</action>
    <action>Hold</action>
    <!-- Add more as needed -->
  </actionPermissions>
  <toolPermissions>
    <!-- List tools from src/tools/registry.cjs TOOLS object -->
    <tool>technicalIndicators</tool>
    <tool>riskMetrics</tool>
    <tool>newsAnalysis</tool>
  </toolPermissions>
  <marketInformationPermissions>
    <scope>Your Asset Historical Price Data</scope>
    <scope>Your Asset News</scope>
  </marketInformationPermissions>
  <teamBackground>
    <description>Team context — who are the other agents, what is the fund's goal.</description>
  </teamBackground>
</profile>
```

## Available Tools

| Tool Name | Description |
|-----------|-------------|
| `technicalIndicators` | RSI, MACD, Bollinger Bands, EMA, SMA, ATR, Stochastic, OBV |
| `trendAnalysis` | Direction, strength, EMA crossovers |
| `supportResistance` | Key S/R levels, position in range |
| `volumeAnalysis` | Volume vs average, OBV trend |
| `riskMetrics` | VaR, CVaR, Sharpe, Sortino, MDD |
| `newsAnalysis` | Headline list for LLM sentiment analysis |
| `volatilityRegime` | Low/Medium/High/Extreme regime detection |
| `drawdownAnalysis` | Current drawdown, time underwater |
| `priceAlert` | Threshold breach detection |
| `correlationMatrix` | Cross-asset correlations (Otto only) |
| `blockchainMetrics` | BTC on-chain: hash rate, mempool, mining |
| `cryptoSentiment` | Fear & Greed Index |
| `regulatoryScanner` | Regulatory keyword news scan |
| `halvingCycleAnalysis` | Bitcoin halving cycle position |
| `earningsCalendar` | Upcoming earnings (equities) |
| `fundamentalValuation` | 52-week range, valuation signals |
| `sectorRotation` | Sector relative strength |
| `centralBankMonitor` | Fed/ECB/BOJ meeting calendar |
| `interestRateDifferential` | Carry trade opportunity scoring |
| `geopoliticalRisk` | Geo-risk keyword scanner |
| `macroEconomicCalendar` | CPI, NFP, GDP release calendar |
| `portfolioOptimizer` | Mean-variance + CVaR optimization |
| `stressTester` | Portfolio shock scenarios |
