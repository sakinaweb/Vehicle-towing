import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL, ApiClient } from './api';

/** Socket.IO lives on the API origin, namespace /realtime. */
const REALTIME_URL = `${new URL(API_BASE_URL).origin}/realtime`;

export type RealtimeHandlers = Record<string, (payload: never) => void>;

/**
 * Authenticated Socket.IO connection for a signed-in user. Connects with the
 * in-memory access token; if the server rejects it (expired), the token is
 * refreshed once and the connection retried. Disconnects on sign-out.
 */
export function useRealtime(client: ApiClient, signedInUserId: string | null, handlers: RealtimeHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!signedInUserId) return;
    let disposed = false;
    let retriedAuth = false;

    const socket = io(REALTIME_URL, {
      transports: ['websocket'],
      autoConnect: false,
      // Called on every (re)connect, so a refreshed token is always used.
      auth: (cb) => cb({ token: client.getAccessToken() ?? '' }),
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'unauthorized' && !retriedAuth) {
        retriedAuth = true;
        void client.refresh().then((session) => {
          if (session && !disposed) socket.connect();
        });
      }
    });
    socket.onAny((event: string, payload: unknown) => {
      const handler = handlersRef.current[event] as ((p: unknown) => void) | undefined;
      handler?.(payload);
    });

    // Make sure there is a fresh access token before the first handshake.
    void (client.getAccessToken() ? Promise.resolve() : client.refresh()).then(() => {
      if (!disposed) socket.connect();
    });

    return () => {
      disposed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [client, signedInUserId]);

  /** Emits with an acknowledgement; resolves null if not connected. */
  const emitWithAck = async <T,>(event: string, payload: unknown): Promise<T | null> => {
    const socket = socketRef.current;
    if (!socket?.connected) return null;
    return (await socket.timeout(5000).emitWithAck(event, payload).catch(() => null)) as T | null;
  };

  return { connected, emitWithAck };
}
