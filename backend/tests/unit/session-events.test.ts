import { describe, expect, it, vi } from 'vitest';
import { createSessionEvents, type SessionRevokedEvent } from '../../src/modules/auth/session-events.js';

const EVENT: SessionRevokedEvent = {
  userId: '11111111-1111-4111-8111-111111111111',
  familyId: '33333333-3333-4333-8333-333333333333',
  sessionIds: ['22222222-2222-4222-8222-222222222222'],
  reason: 'logout',
};

describe('session revocation events', () => {
  it('delivers the payload to every listener', () => {
    const events = createSessionEvents();
    const first = vi.fn();
    const second = vi.fn();
    events.onRevoked(first);
    events.onRevoked(second);
    events.emitRevoked(EVENT);
    expect(first).toHaveBeenCalledWith(EVENT);
    expect(second).toHaveBeenCalledWith(EVENT);
  });

  it('stops delivering after unsubscribe', () => {
    const events = createSessionEvents();
    const listener = vi.fn();
    const off = events.onRevoked(listener);
    off();
    events.emitRevoked(EVENT);
    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates a throwing or rejecting listener and logs it', async () => {
    const logger = { error: vi.fn() };
    const events = createSessionEvents({ logger });
    const after = vi.fn();
    events.onRevoked(() => {
      throw new Error('boom');
    });
    events.onRevoked(async () => {
      throw new Error('async boom');
    });
    events.onRevoked(after);
    expect(() => {
      events.emitRevoked(EVENT);
    }).not.toThrow();
    expect(after).toHaveBeenCalledWith(EVENT);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('keeps instances independent', () => {
    const a = createSessionEvents();
    const b = createSessionEvents();
    const listener = vi.fn();
    a.onRevoked(listener);
    b.emitRevoked(EVENT);
    expect(listener).not.toHaveBeenCalled();
  });
});
