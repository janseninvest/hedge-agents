'use strict';

/**
 * memory-store.cjs — SQLite-backed memory store for all 3 memory types.
 *
 * Memory types (from paper Section 3.3):
 *   M_MI — Market Information Memory (raw market state per tick)
 *   M_IR — Investment Reflection Memory (post-decision reflections)
 *   M_GE — General Experience Memory (distilled cross-agent wisdom from ESC)
 *
 * Schema:
 *   memories(id, agent_name, memory_type, content, embedding, tfidf_tokens,
 *            created_at, asset, pnl_outcome, experience_score)
 *   portfolio_state(id, timestamp, state_json)
 *   conference_logs(id, conference_type, timestamp, transcript, outcome)
 */

const path    = require('path');
const fs      = require('fs');
const logger  = require('../utils/logger.cjs');

const MOD = 'memory:store';

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  logger.error(MOD, 'better-sqlite3 not available:', e.message);
  throw e;
}

class MemoryStore {
  /**
   * @param {string} dbPath  - Path to SQLite file
   * @param {object} [cfg]   - { retentionDays: { M_MI, M_IR, M_GE } }
   */
  constructor(dbPath, cfg = {}) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this._db  = new Database(dbPath);
    this._cfg = cfg;

    this._init();
    logger.info(MOD, `Opened database: ${dbPath}`);
  }

  // ─── Schema ────────────────────────────────────────────────────────────────

  _init() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name       TEXT    NOT NULL,
        memory_type      TEXT    NOT NULL CHECK(memory_type IN ('M_MI','M_IR','M_GE')),
        content          TEXT    NOT NULL,
        embedding        TEXT,
        tfidf_tokens     TEXT,
        created_at       INTEGER NOT NULL,
        asset            TEXT,
        pnl_outcome      REAL,
        experience_score REAL    DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent_type
        ON memories(agent_name, memory_type);

      CREATE INDEX IF NOT EXISTS idx_memories_created
        ON memories(created_at);

      CREATE TABLE IF NOT EXISTS portfolio_state (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  INTEGER NOT NULL,
        state_json TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conference_logs (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        conference_type   TEXT    NOT NULL CHECK(conference_type IN ('BAC','ESC','EMC')),
        timestamp         INTEGER NOT NULL,
        transcript        TEXT    NOT NULL,
        outcome           TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_reflections (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name     TEXT    NOT NULL,
        asset          TEXT    NOT NULL,
        decision_json  TEXT    NOT NULL,
        created_at     INTEGER NOT NULL,
        resolved       INTEGER DEFAULT 0
      );
    `);
  }

  // ─── Memory CRUD ──────────────────────────────────────────────────────────

  /**
   * Insert a new memory.
   *
   * @param {object} memory
   * @param {string} memory.agentName
   * @param {'M_MI'|'M_IR'|'M_GE'} memory.memoryType
   * @param {object|string} memory.content   - Will be JSON.stringify'd if object
   * @param {string}  [memory.asset]
   * @param {number}  [memory.pnlOutcome]
   * @param {number}  [memory.experienceScore]
   * @param {number[]}[memory.embedding]     - Float array from embedding provider
   * @param {string[]}[memory.tfidfTokens]   - Tokenized content for TF-IDF fallback
   * @returns {number} Inserted row id
   */
  insertMemory(memory) {
    const {
      agentName,
      memoryType,
      content,
      asset         = null,
      pnlOutcome    = null,
      experienceScore = 0,
      embedding     = null,
      tfidfTokens   = null,
    } = memory;

    const contentStr   = typeof content === 'string' ? content : JSON.stringify(content);
    const embeddingStr = embedding   ? JSON.stringify(embedding)   : null;
    const tokensStr    = tfidfTokens ? JSON.stringify(tfidfTokens) : null;
    const now          = Math.floor(Date.now() / 1000);

    const stmt = this._db.prepare(`
      INSERT INTO memories
        (agent_name, memory_type, content, embedding, tfidf_tokens, created_at, asset, pnl_outcome, experience_score)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(agentName, memoryType, contentStr, embeddingStr, tokensStr, now, asset, pnlOutcome, experienceScore);
    return result.lastInsertRowid;
  }

  /**
   * Get all memories for an agent (optionally filtered by type).
   *
   * @param {string} agentName
   * @param {'M_MI'|'M_IR'|'M_GE'|null} [memoryType]
   * @param {number} [limit=1000]
   * @returns {object[]}
   */
  getMemories(agentName, memoryType = null, limit = 1000) {
    const rows = memoryType
      ? this._db.prepare('SELECT * FROM memories WHERE agent_name=? AND memory_type=? ORDER BY created_at DESC, id DESC LIMIT ?').all(agentName, memoryType, limit)
      : this._db.prepare('SELECT * FROM memories WHERE agent_name=? ORDER BY created_at DESC, id DESC LIMIT ?').all(agentName, limit);

    return rows.map(r => ({
      ...r,
      content:     this._parseJSON(r.content),
      embedding:   r.embedding   ? JSON.parse(r.embedding)   : null,
      tfidfTokens: r.tfidf_tokens ? JSON.parse(r.tfidf_tokens) : null,
    }));
  }

  /**
   * Get memories for retrieval — returns those with embeddings or tfidf_tokens.
   */
  getRetrievableMemories(agentName, limit = 2000) {
    const rows = this._db.prepare(`
      SELECT * FROM memories
      WHERE agent_name = ?
        AND (embedding IS NOT NULL OR tfidf_tokens IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(agentName, limit);

    return rows.map(r => ({
      id:              r.id,
      agentName:       r.agent_name,
      memoryType:      r.memory_type,
      content:         this._parseJSON(r.content),
      embedding:       r.embedding    ? JSON.parse(r.embedding)    : null,
      tfidfTokens:     r.tfidf_tokens ? JSON.parse(r.tfidf_tokens) : null,
      createdAt:       r.created_at,
      asset:           r.asset,
      pnlOutcome:      r.pnl_outcome,
      experienceScore: r.experience_score,
    }));
  }

  /**
   * Update an existing memory with embedding or pnl outcome.
   */
  updateMemory(id, updates) {
    const fields = [];
    const values = [];
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      values.push(updates.embedding ? JSON.stringify(updates.embedding) : null);
    }
    if (updates.tfidfTokens !== undefined) {
      fields.push('tfidf_tokens = ?');
      values.push(updates.tfidfTokens ? JSON.stringify(updates.tfidfTokens) : null);
    }
    if (updates.pnlOutcome !== undefined) {
      fields.push('pnl_outcome = ?');
      values.push(updates.pnlOutcome);
    }
    if (updates.experienceScore !== undefined) {
      fields.push('experience_score = ?');
      values.push(updates.experienceScore);
    }
    if (!fields.length) return;
    values.push(id);
    this._db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Purge old M_MI memories beyond retention window.
   */
  purgeOldMemories(retentionDays = 365) {
    // Add 1s buffer so records inserted "now" are included when retentionDays=0
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400 + 1;
    const result = this._db.prepare(
      "DELETE FROM memories WHERE memory_type='M_MI' AND created_at <= ?"
    ).run(cutoff);
    if (result.changes > 0) {
      logger.info(MOD, `Purged ${result.changes} old M_MI memories`);
    }
  }

  // ─── Portfolio State ───────────────────────────────────────────────────────

  savePortfolioState(stateJson) {
    const now = Math.floor(Date.now() / 1000);
    this._db.prepare('INSERT INTO portfolio_state (timestamp, state_json) VALUES (?, ?)').run(now, JSON.stringify(stateJson));
  }

  getPortfolioHistory(limit = 100) {
    return this._db.prepare('SELECT * FROM portfolio_state ORDER BY timestamp DESC, id DESC LIMIT ?').all(limit)
      .map(r => ({ ...r, state: JSON.parse(r.state_json) }));
  }

  getLatestPortfolioState() {
    const row = this._db.prepare('SELECT * FROM portfolio_state ORDER BY timestamp DESC LIMIT 1').get();
    return row ? { ...row, state: JSON.parse(row.state_json) } : null;
  }

  // ─── Conference Logs ───────────────────────────────────────────────────────

  saveConferenceLog(type, transcript, outcome = null) {
    const now = Math.floor(Date.now() / 1000);
    this._db.prepare(
      'INSERT INTO conference_logs (conference_type, timestamp, transcript, outcome) VALUES (?, ?, ?, ?)'
    ).run(type, now, JSON.stringify(transcript), outcome ? JSON.stringify(outcome) : null);
  }

  getConferenceLogs(type = null, limit = 50) {
    const rows = type
      ? this._db.prepare('SELECT * FROM conference_logs WHERE conference_type=? ORDER BY timestamp DESC LIMIT ?').all(type, limit)
      : this._db.prepare('SELECT * FROM conference_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
    return rows.map(r => ({
      ...r,
      transcript: JSON.parse(r.transcript),
      outcome:    r.outcome ? JSON.parse(r.outcome) : null,
    }));
  }

  // ─── Pending Reflections ──────────────────────────────────────────────────

  savePendingReflection(agentName, asset, decisionJson) {
    const now = Math.floor(Date.now() / 1000);
    this._db.prepare(
      'INSERT INTO pending_reflections (agent_name, asset, decision_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(agentName, asset, JSON.stringify(decisionJson), now);
  }

  getPendingReflections(agentName) {
    return this._db.prepare(
      'SELECT * FROM pending_reflections WHERE agent_name=? AND resolved=0 ORDER BY created_at ASC'
    ).all(agentName).map(r => ({ ...r, decision: JSON.parse(r.decision_json) }));
  }

  markReflectionResolved(id) {
    this._db.prepare('UPDATE pending_reflections SET resolved=1 WHERE id=?').run(id);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  getMemoryStats(agentName) {
    const rows = this._db.prepare(`
      SELECT memory_type, COUNT(*) as count
      FROM memories WHERE agent_name=?
      GROUP BY memory_type
    `).all(agentName);
    return rows.reduce((o, r) => { o[r.memory_type] = r.count; return o; }, {});
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _parseJSON(str) {
    if (typeof str !== 'string') return str;
    try { return JSON.parse(str); } catch { return str; }
  }

  close() {
    this._db.close();
  }
}

module.exports = { MemoryStore };
