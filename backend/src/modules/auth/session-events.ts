import type { Logger } from 'pino';

export type RevocationReason = 'logout' | 'reuse';

/** Emitted after the revoking write has committed. Carries ids only, never tokens. */
export interface SessionRevokedEvent {
  userId: string;
  familyId: string;
  /** Session rows newly revoked by this operation (never empty). */
  sessionIds: string[];
  reason: RevocationReason;
}

export type SessionRevokedListener = (event: SessionRevokedEvent) => void | Promise<void>;

/**
 * Revocation hook. Phase 5 realtime subscribes with onRevoked() to disconnect
 * the Socket.IO connections authenticated with a revoked session, so a logout
 * or a detected refresh-token reuse also ends live sockets.
 */
export interface SessionEvents {
  emitRevoked(event: SessionRevokedEvent): void;
  /** Returns the unsubscribe function. */
  onRevoked(listener: SessionRevokedListener): () => void;
}

/**
 * One instance per app. Listeners run synchronously in subscription order; a
 * listener that throws (or rejects) is logged and never affects the request
 * that revoked the session or the other listeners.
 */
export function createSessionEvents({ logger }: { logger?: Pick<Logger, 'error'> } = {}): SessionEvents {
  const listeners = new Set<SessionRevokedListener>();
  const report = (err: unknown) => {
    logger?.error({ err }, 'session.revoked listener failed');
  };
  return {
    emitRevoked(event) {
      for (const listener of [...listeners]) {
        try {
          const result = listener(event);
          if (result instanceof Promise) result.catch(report);
        } catch (err) {
          report(err);
        }
      }
    },
    onRevoked(listener) {
      // Wrapped so subscribing the same function twice gives two independent subscriptions.
      const entry: SessionRevokedListener = (event) => listener(event);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
}
