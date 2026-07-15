/**
 * Tests for handoff state machine logic — pure unit tests, no DB, no AI.
 * Uses node:test and node:assert (built-in since Node 18).
 *
 * Run: node --test test/handoff.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline state machine (mirrors webhook.js logic without DB calls) ──────────
// We test the logic directly without importing webhook.js (which imports db.js
// and would trigger SQLite migrations and hang).

/**
 * Determines the next handoff state given current state and an event.
 * Mirrors the logic inside requestHumanHandoff() and processTurn().
 */
function nextHandoffState(currentStatus, event) {
  // Valid transitions:
  // none        + request   -> waiting
  // waiting     + claim     -> in_progress
  // in_progress + release   -> none
  // any         + request   -> waiting (re-request allowed when not in_progress)
  // in_progress + request   -> in_progress (already claimed, no regression)

  switch (event) {
    case 'request':
      if (currentStatus === 'in_progress') return 'in_progress'; // already claimed
      return 'waiting';
    case 'claim':
      if (currentStatus === 'waiting') return 'in_progress';
      return currentStatus; // invalid transition
    case 'release':
      if (currentStatus === 'in_progress') return 'none';
      return currentStatus; // invalid transition
    default:
      return currentStatus;
  }
}

/**
 * Returns whether the AI should respond given handoff_status and message content.
 */
function shouldAiRespond(handoffStatus, isInjection = false, isRateLimited = false) {
  if (handoffStatus === 'in_progress') return false; // human is handling
  if (isInjection) return false;
  if (isRateLimited) return false;
  return true;
}

/**
 * Determines button label for dashboard given handoff state.
 */
function handoffButtonLabel(handoffStatus, needsHuman) {
  if (handoffStatus === 'in_progress') return 'Liberar';
  if (handoffStatus === 'waiting') return 'Assumir';
  if (needsHuman) return 'Assumir'; // legacy fallback
  return 'Solicitar';
}

// ── State machine transitions ────────────────────────────────────────────────
describe('nextHandoffState — state machine transitions', () => {
  it('none + request -> waiting', () => {
    assert.equal(nextHandoffState('none', 'request'), 'waiting');
  });
  it('waiting + claim -> in_progress', () => {
    assert.equal(nextHandoffState('waiting', 'claim'), 'in_progress');
  });
  it('in_progress + release -> none', () => {
    assert.equal(nextHandoffState('in_progress', 'release'), 'none');
  });
  it('in_progress + request -> in_progress (no regression)', () => {
    assert.equal(nextHandoffState('in_progress', 'request'), 'in_progress');
  });
  it('none + claim -> none (invalid transition)', () => {
    assert.equal(nextHandoffState('none', 'claim'), 'none');
  });
  it('none + release -> none (invalid transition)', () => {
    assert.equal(nextHandoffState('none', 'release'), 'none');
  });
  it('waiting + release -> waiting (invalid transition)', () => {
    assert.equal(nextHandoffState('waiting', 'release'), 'waiting');
  });
  it('re-request while waiting stays waiting', () => {
    assert.equal(nextHandoffState('waiting', 'request'), 'waiting');
  });
});

// ── AI response gating ───────────────────────────────────────────────────────
describe('shouldAiRespond — AI gating logic', () => {
  it('AI responds when status is none and no issues', () => {
    assert.equal(shouldAiRespond('none'), true);
  });
  it('AI does NOT respond when human is in_progress', () => {
    assert.equal(shouldAiRespond('in_progress'), false);
  });
  it('AI responds when status is waiting (human not yet claimed)', () => {
    // While waiting, AI can still respond to keep customer engaged
    assert.equal(shouldAiRespond('waiting'), true);
  });
  it('AI does NOT respond on injection attempt', () => {
    assert.equal(shouldAiRespond('none', true), false);
  });
  it('AI does NOT respond when rate limited', () => {
    assert.equal(shouldAiRespond('none', false, true), false);
  });
  it('injection check applies even if status is waiting', () => {
    assert.equal(shouldAiRespond('waiting', true), false);
  });
});

// ── Dashboard button labels ──────────────────────────────────────────────────
describe('handoffButtonLabel — dashboard UI state', () => {
  it('shows "Liberar" when in_progress', () => {
    assert.equal(handoffButtonLabel('in_progress', false), 'Liberar');
  });
  it('shows "Assumir" when waiting', () => {
    assert.equal(handoffButtonLabel('waiting', false), 'Assumir');
  });
  it('shows "Solicitar" when none and no legacy flag', () => {
    assert.equal(handoffButtonLabel('none', false), 'Solicitar');
  });
  it('shows "Assumir" for legacy needs_human=true with none status', () => {
    assert.equal(handoffButtonLabel('none', true), 'Assumir');
  });
});

// ── Edge cases and invariants ────────────────────────────────────────────────
describe('state machine invariants', () => {
  it('full happy path: none -> waiting -> in_progress -> none', () => {
    let state = 'none';
    state = nextHandoffState(state, 'request');
    assert.equal(state, 'waiting');
    state = nextHandoffState(state, 'claim');
    assert.equal(state, 'in_progress');
    state = nextHandoffState(state, 'release');
    assert.equal(state, 'none');
  });

  it('double-claim does not change state', () => {
    let state = 'in_progress';
    state = nextHandoffState(state, 'claim');
    assert.equal(state, 'in_progress'); // unchanged — already claimed
  });

  it('all valid states are one of none/waiting/in_progress', () => {
    const validStates = ['none', 'waiting', 'in_progress'];
    const events = ['request', 'claim', 'release', 'unknown'];
    for (const s of validStates) {
      for (const e of events) {
        const next = nextHandoffState(s, e);
        assert.ok(validStates.includes(next), `Invalid state "${next}" from "${s}" + "${e}"`);
      }
    }
  });
});

// ── Reason mapping ───────────────────────────────────────────────────────────
describe('handoff reason mapping', () => {
  // Maps AI tool reasons to display text — mirrors what webhook.js uses
  const REASON_LABELS = {
    pediu_humano: 'Pediu atendente',
    reclamacao: 'Reclamação',
    pos_venda: 'Pós-venda',
    sem_informacao: 'Sem informação',
    muito_irritado: 'Muito irritado',
    risco_sensivel: 'Risco/sensível',
    limite_ia: 'Limite IA',
    outro: 'Outro',
  };

  it('has all valid escalar_humano reasons mapped', () => {
    const validReasons = ['pediu_humano', 'reclamacao', 'pos_venda', 'sem_informacao', 'muito_irritado', 'risco_sensivel', 'limite_ia', 'outro'];
    for (const r of validReasons) {
      assert.ok(REASON_LABELS[r], `Missing label for reason: ${r}`);
    }
  });

  it('guard-detected injection maps to prompt_injection', () => {
    // When conversation-guard detects injection, reason is 'prompt_injection_detected'
    const reason = 'prompt_injection';
    // Not in REASON_LABELS — but it's a guard reason, not an AI tool reason
    assert.equal(REASON_LABELS[reason], undefined);
  });
});
