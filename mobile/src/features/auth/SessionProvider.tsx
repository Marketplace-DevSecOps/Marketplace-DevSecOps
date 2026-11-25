import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { sessionService, type SessionService, type Session } from '../../services/session';

type SessionState =
  | { status: 'restoring' | 'anonymous' | 'error' }
  | { status: 'authenticated'; session: Session };

const SessionContext = createContext<{ state: SessionState; retry: () => void } | null>(null);

export function SessionProvider({ children, service = sessionService }: PropsWithChildren<{ service?: SessionService }>) {
  const [state, setState] = useState<SessionState>({ status: 'restoring' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'restoring' });
    void (async () => {
      try {
        const session = await service.restore();
        if (active) setState(session ? { status: 'authenticated', session } : { status: 'anonymous' });
      } catch {
        if (active) setState({ status: 'error' });
      }
    })();
    return () => { active = false; };
  }, [service, attempt]);

  return (
    <SessionContext.Provider value={{ state, retry: () => {
      setState({ status: 'restoring' });
      setAttempt((value) => value + 1);
    } }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is required');
  return context;
}
