# Chapter 4 — The Memory System

## Why Memory Matters

An LLM without memory has no history. It can't say "I tried this in a similar situation before and it failed." It can't learn from mistakes. It can't apply patterns from months ago. HedgeAgents solves this with a **three-tier persistent memory system** stored in SQLite.

The memory system answers the question: *"Have I seen a situation like this before, and what happened?"*

---

## Three Memory Types

```mermaid
graph TB
    subgraph MI["M_MI — Market Information Memory"]
        MI_DESC["When: Every tick (every trading day)<br/>What: Raw market snapshot<br/>Purpose: 'What was the market like in past similar situations?'<br/>Retention: 365 days rolling"]
        MI_EX["Example content:<br/>{date: '2024-01-15', price: 45200,<br/>rsi: 63, macd_histogram: 0.42,<br/>trend: 'BULLISH', f&g: 62,<br/>news_count: 8, action_taken: 'Buy'}"]
    end

    subgraph IR["M_IR — Investment Reflection Memory"]
        IR_DESC["When: After reflecting on each decision<br/>What: Decision + rationale + outcome + lesson<br/>Purpose: 'What did I learn from past trades?'<br/>Retention: Permanent"]
        IR_EX["Example content:<br/>{action: 'Buy', price: 45200,<br/>rationale: 'ETF inflows + RSI room',<br/>outcome_pnl: 0.042,<br/>lesson: 'ETF flows reliable signal',<br/>experience_score: 0.85}"]
    end

    subgraph GE["M_GE — General Experience Memory"]
        GE_DESC["When: During Experience Sharing Conference<br/>What: Cross-agent distilled principles<br/>Purpose: 'What general investment wisdom do I carry?'<br/>Retention: Permanent"]
        GE_EX["Example content:<br/>{principle: 'Never go all-in when RSI>70,<br/>history shows 80% chance correction follows',<br/>source: 'ESC session 2024-02-15',<br/>applicable_to: 'All volatile assets'}"]
    end

    MI --> RETRIEVAL[Memory Retrieval System]
    IR --> RETRIEVAL
    GE --> RETRIEVAL
    RETRIEVAL --> DECISION[Agent Decision Prompt]
```

---

## Memory Store Architecture

```mermaid
erDiagram
    memories {
        INTEGER id PK
        TEXT agent_name
        TEXT memory_type "M_MI | M_IR | M_GE"
        TEXT content "JSON blob"
        TEXT embedding "JSON float array (Voyage AI)"
        TEXT tfidf_tokens "JSON string array (TF-IDF)"
        INTEGER created_at "Unix timestamp"
        TEXT asset "BTC-USD | ^DJI | etc"
        REAL pnl_outcome "Actual P&L after reflection"
        REAL experience_score "0.0-1.0 importance"
    }

    portfolio_state {
        INTEGER id PK
        INTEGER timestamp
        TEXT state_json "Full portfolio snapshot"
    }

    conference_logs {
        INTEGER id PK
        TEXT conference_type "BAC | ESC | EMC"
        INTEGER timestamp
        TEXT transcript "Full JSON transcript"
        TEXT outcome "Decisions made"
    }

    pending_reflections {
        INTEGER id PK
        TEXT agent_name
        TEXT asset
        TEXT decision_json "Decision that needs reflection"
        INTEGER created_at
        INTEGER resolved "0 or 1"
    }
```

---

## Memory Insertion Flow

```mermaid
sequenceDiagram
    participant AGENT as Agent
    participant STORE as MemoryStore
    participant DB as SQLite
    participant EMB as Embeddings

    AGENT->>STORE: insertMemory({agentName, memoryType, content, ...})
    STORE->>STORE: contentStr = JSON.stringify(content)
    STORE->>DB: INSERT INTO memories (...) VALUES (...)
    DB-->>STORE: id = 42 (lastInsertRowid)
    STORE-->>AGENT: id = 42

    Note over AGENT: Async indexing — non-blocking
    AGENT->>EMB: embed(JSON.stringify(content))

    alt Voyage AI available
        EMB->>EMB: POST api.voyageai.com/v1/embeddings
        EMB-->>AGENT: [0.023, -0.145, 0.891, ...] (1024-dim)
        AGENT->>STORE: updateMemory(42, { embedding: [...] })
    else TF-IDF fallback
        EMB->>EMB: tokenize(text) → ['bitcoin','rsi','bullish','etf','inflow']
        EMB-->>AGENT: ['bitcoin', 'rsi', 'bullish', 'etf', 'inflow']
        AGENT->>STORE: updateMemory(42, { tfidfTokens: [...] })
    end
    STORE->>DB: UPDATE memories SET embedding=? WHERE id=?
```

---

## Memory Retrieval: How Similarity Works

The retrieval system answers: *"Which past memories are most relevant to the current situation?"*

### TF-IDF Retrieval (Default)

**TF-IDF** = Term Frequency × Inverse Document Frequency. It measures how important a word is to a document relative to all documents in the corpus.

```mermaid
flowchart TD
    QT["Qt: 'Bitcoin ETF institutional inflows<br/>strong momentum RSI 63 bullish'"]

    QT --> TOK_Q[Tokenize + filter stop words<br/>→ ['bitcoin','etf','institutional','inflows','strong','momentum','rsi','bullish']]

    subgraph MEMORIES["Memory Bank (simplified)"]
        M1["Memory 1 tokens:<br/>['bitcoin','etf','approval','price','surge','rsi','65']"]
        M2["Memory 2 tokens:<br/>['stocks','earnings','dj30','resistance','volume']"]
        M3["Memory 3 tokens:<br/>['bitcoin','institutional','demand','momentum','bullish']"]
    end

    TOK_Q --> VOCAB[Build vocabulary:<br/>union of all tokens]
    VOCAB --> VECTORS[Build TF-IDF vectors<br/>for query + each memory]

    VECTORS --> SIM1["cos_sim(Q, M1) = 0.81"]
    VECTORS --> SIM2["cos_sim(Q, M2) = 0.04"]
    VECTORS --> SIM3["cos_sim(Q, M3) = 0.88"]

    SIM1 & SIM2 & SIM3 --> RANK["Ranked: M3(0.88) > M1(0.81) > M2(0.04)"]
    RANK --> TOP5["Return top K=5 memories"]
```

**Cosine similarity formula:**
```
cos(Q, M) = (Q · M) / (|Q| × |M|)
```

Where Q and M are TF-IDF weighted vectors. Result: 1.0 = identical, 0.0 = completely different.

### Voyage AI Retrieval (Upgraded)

When `VOYAGE_API_KEY` is set, the system uses `voyage-finance-2` — a model specifically fine-tuned on financial text. It produces 1024-dimensional float vectors that capture semantic meaning:

- "Bull market ETF inflows" and "institutional buying driving price up" will have **high similarity** even though they share no words
- TF-IDF would score these as 0 similarity (different tokens)

```mermaid
graph LR
    TEXT["Text: 'Bitcoin ETF inflows,<br/>institutional demand strong'"]
    TEXT --> API["POST api.voyageai.com/v1/embeddings<br/>model: voyage-finance-2"]
    API --> VEC["[0.023, -0.145, 0.891, 0.002, ...<br/>1024 dimensions]"]
    VEC --> DB[(Stored in memories.embedding)]
    VEC --> COMPARE["Cosine similarity vs<br/>all stored embeddings<br/>→ top K=5 returned"]
```

**Recommendation:** Use Voyage AI for production. TF-IDF is fine for testing and works well for structured financial text with repeated terminology.

---

## Memory Retrieval at Decision Time

```mermaid
sequenceDiagram
    participant AGENT as Agent
    participant STORE as MemoryStore
    participant EMB as Embeddings
    participant MATH as math.cjs

    AGENT->>STORE: getRetrievableMemories(agentName, limit=2000)
    STORE-->>AGENT: All memories with embeddings or tfidfTokens

    AGENT->>EMB: indexMemories(unindexed memories)
    Note over EMB: Re-fetch and index any new unindexed memories

    AGENT->>STORE: getRetrievableMemories(agentName, limit=2000)
    STORE-->>AGENT: 2000 candidate memories (indexed)

    AGENT->>EMB: retrieveTopK(provider, queryText=Qt, memories, K=5)
    EMB->>EMB: embed(Qt) → queryVector
    loop For each memory
        EMB->>MATH: cosineSimilarity(queryVector, memory.embedding)
        MATH-->>EMB: score: 0.0-1.0
    end
    EMB->>EMB: sort by score DESC, take top 5
    EMB-->>AGENT: [mem1(0.91), mem2(0.84), mem3(0.79), mem4(0.71), mem5(0.68)]
```

---

## Memory Lifecycle

```mermaid
gantt
    title Memory Lifecycle Over Time
    dateFormat  YYYY-MM-DD
    axisFormat  Day %j

    section M_MI (Market Info)
    Inserted each tick     :active, m1, 2024-01-01, 365d
    Auto-purged at 365d    :crit, 2024-12-31, 1d

    section M_IR (Reflections)
    Inserted after each reflection :active, m2, 2024-01-02, 400d
    Kept forever           :active, m3, 2024-01-02, 700d

    section M_GE (General Experience)
    Pre-seeded by seed-memory.cjs :milestone, m4, 2024-01-01, 0d
    Added during each ESC  :active, m5, 2024-01-31, 700d
    Kept forever           :active, m6, 2024-01-01, 700d
```

**Purge strategy:**
- M_MI: Rolling 365-day window. Older market snapshots are less relevant than recent ones.
- M_IR: Never purged. Past investment reflections and lessons remain valuable indefinitely.
- M_GE: Never purged. General principles don't expire.

---

## Memory Volume Estimates

Running the system for 1 year:

| Memory Type | Insert Rate | Annual Volume | DB Size (est.) |
|-------------|------------|---------------|----------------|
| M_MI | 3 per day (1 per analyst) | ~756 records | ~500KB |
| M_IR | ~2 per day (some days = Hold, no reflection) | ~500 records | ~400KB |
| M_GE | ~15 per ESC × 12 ESC/year | ~180 records | ~200KB |
| **Total** | | **~1,436** | **~1.1MB** |

SQLite handles this trivially. Even at 100× scale (100 analysts, 10 years), the database stays well under 100MB.

---

## The Expert Seed: Pre-Populating Memory

Running `node scripts/seed-memory.cjs` inserts **19 expert investment principles** into each agent's M_GE before first run. This gives agents a head start:

```mermaid
graph LR
    SEED[seed-memory.cjs] --> DAVE_MEM["Dave M_GE (5 principles):<br/>• Halving cycle patterns<br/>• Never >70% in one position<br/>• RSI 63-70 = reduce, not all-in<br/>• Regulatory news → reduce leverage<br/>• ADL divergence = reversal signal"]

    SEED --> BOB_MEM["Bob M_GE (5 principles):<br/>• Earnings season volatility<br/>• Yield curve as leading indicator<br/>• P/E > 25x = reduce exposure<br/>• Sector rotation signals<br/>• Fed tightening = compress multiples"]

    SEED --> EMILY_MEM["Emily M_GE (5 principles):<br/>• Rate differentials drive trends<br/>• Reduce size before CPI/NFP<br/>• Geopolitical → EUR weakness<br/>• Fibonacci + 200d SMA confluence<br/>• VIX > 25 = carry trade unwind"]

    SEED --> OTTO_MEM["Otto M_GE (4 principles):<br/>• Crisis correlation → 1.0<br/>• Half-Kelly position sizing<br/>• CVaR > 8% monthly → reduce<br/>• ENB target > 2.5"]
```

Each seed principle is indexed with TF-IDF immediately, making it retrievable from day one.

---

## Why Three Memory Types?

Each memory type captures a different kind of knowledge:

| Type | Analogy | What it captures |
|------|---------|-----------------|
| M_MI | **Short-term memory** | "The market looked like X on day Y" |
| M_IR | **Personal experience** | "I did X, it resulted in Y, I learned Z" |
| M_GE | **Collective wisdom** | "We all agreed: when A happens, do B" |

The combination creates an agent that:
1. **Recognises patterns** (M_MI: "this looks like that time in October...")
2. **Learns from mistakes** (M_IR: "I went all-in then and got burned...")
3. **Applies principles** (M_GE: "never deploy more than 70% in crypto...")

This mirrors how an experienced human trader thinks: pattern recognition + personal history + absorbed wisdom from mentors.
