import React, { createContext, useContext, useEffect, useState } from 'react';
import type { TransportAdapter } from './types.js';
import { WebSocketAdapter } from './ws-adapter.js';

const TransportContext = createContext<TransportAdapter | null>(null);

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const [transport] = useState<TransportAdapter>(() => new WebSocketAdapter());

  useEffect(() => {
    transport.connect();
    return () => transport.disconnect();
  }, [transport]);

  return (
    <TransportContext.Provider value={transport}>
      {children}
    </TransportContext.Provider>
  );
}

export function useTransport(): TransportAdapter {
  const ctx = useContext(TransportContext);
  if (!ctx) throw new Error('useTransport must be used within TransportProvider');
  return ctx;
}
