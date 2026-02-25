'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadProfile, loadAllProfiles } = require('../../src/agents/profile-loader.cjs');
const config = require('../../src/config.cjs');

describe('Profile Loader', () => {
  test('Dave profile loads correctly', () => {
    const p = loadProfile('dave.xml');
    assert.strictEqual(p.name, 'Dave');
    assert.ok(p.description.length > 50);
    assert.ok(p.tools.includes('technicalIndicators'));
    assert.ok(p.actions.includes('Buy'));
    assert.ok(p.actions.includes('Sell'));
    assert.ok(p.actions.includes('Hold'));
  });

  test('Otto profile has Portfolio Manager type', () => {
    const p = loadProfile('otto.xml');
    assert.strictEqual(p.name, 'Otto');
    assert.strictEqual(p.agentType, 'Portfolio Manager');
    assert.ok(p.tools.includes('portfolioOptimizer'));
  });

  test('Bob profile has DJ30 role', () => {
    const p = loadProfile('bob.xml');
    assert.strictEqual(p.role, 'DJ30 Analyst');
    assert.ok(p.tools.includes('fundamentalValuation'));
  });

  test('Emily profile has FX role', () => {
    const p = loadProfile('emily.xml');
    assert.strictEqual(p.role, 'FX Analyst');
    assert.ok(p.tools.includes('centralBankMonitor'));
    assert.ok(p.marketScopes.some(s => s.toLowerCase().includes('fx')));
  });

  test('loadAllProfiles returns manager + 3 analysts', () => {
    const { manager, analysts } = loadAllProfiles(config.agents);
    assert.strictEqual(manager.name, 'Otto');
    assert.strictEqual(analysts.length, 3);
    assert.ok(analysts.map(a => a.name).includes('Dave'));
    assert.ok(analysts.map(a => a.name).includes('Bob'));
    assert.ok(analysts.map(a => a.name).includes('Emily'));
  });

  test('All profiles have non-empty description and teamBackground', () => {
    for (const filename of ['dave.xml', 'bob.xml', 'emily.xml', 'otto.xml']) {
      const p = loadProfile(filename);
      assert.ok(p.description.length > 100, `${filename}: description too short`);
      assert.ok(p.teamBackground.length > 50, `${filename}: teamBackground missing`);
    }
  });

  test('Non-existent profile throws error', () => {
    assert.throws(() => loadProfile('nonexistent.xml'), /not found/i);
  });
});
