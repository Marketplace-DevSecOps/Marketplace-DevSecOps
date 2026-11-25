// UI boundary only. No credentials, transport or persistence in this foundation.
export type Session = Readonly<{ userId: string }>;

export interface SessionService {
  // A future implementation must return a session only after server validation.
  restore(): Promise<Session | null>;
}

export const sessionService: SessionService = {
  // Authentication is not connected. Remain anonymous; never fabricate a login.
  async restore() { return null; },
};
