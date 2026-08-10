import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

declare global {
  interface Window {
    __medautodataWsMetrics?: {
      enabled: boolean;
      connectStartedAt?: number;
      openedAt?: number;
      firstMessageAt?: number;
      lastMessageAt?: number;
      messageCount?: number;
      lastCloseAt?: number;
      lastErrorAt?: number;
      lastError?: unknown;
      url?: string | null;
    };
  }
}

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${protocol}//${window.location.host}/ws`;
};

const isWsMetricsEnabled = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('debug-ws-metrics') === '1';
  } catch {
    return false;
  }
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const isConnectingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token } = useAuth();

  // Message queue: ensures every WebSocket message is delivered to consumers
  // even when multiple arrive before React can re-render.
  const messageQueueRef = useRef<any[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outbound queue: ensures messages are not lost when the socket isn't open yet.
  const outboundQueueRef = useRef<string[]>([]);

  const drainQueue = useCallback(() => {
    drainTimerRef.current = null;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    setLatestMessage(next);
    if (messageQueueRef.current.length > 0) {
      drainTimerRef.current = setTimeout(drainQueue, 0);
    }
  }, []);

  // Mark unmounted only on actual provider unmount.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const flushOutbound = useCallback(() => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (outboundQueueRef.current.length === 0) return;
    const queued = outboundQueueRef.current;
    outboundQueueRef.current = [];
    for (const payload of queued) {
      try {
        socket.send(payload);
      } catch (error) {
        console.error('Error sending queued WebSocket message:', error);
        // Put it back at the front so we don't lose it.
        outboundQueueRef.current.unshift(payload);
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (isConnectingRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    try {
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) {
        setIsConnected(false);
        return;
      }
      const metricsEnabled = isWsMetricsEnabled();
      if (metricsEnabled && typeof window !== 'undefined') {
        window.__medautodataWsMetrics = {
          enabled: true,
          connectStartedAt: performance.now(),
          openedAt: undefined,
          firstMessageAt: undefined,
          lastMessageAt: undefined,
          messageCount: 0,
          lastCloseAt: undefined,
          lastErrorAt: undefined,
          lastError: undefined,
          url: wsUrl,
        };
      }
      
      isConnectingRef.current = true;
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        if (metricsEnabled && typeof window !== 'undefined' && window.__medautodataWsMetrics) {
          window.__medautodataWsMetrics.openedAt = performance.now();
        }
        setIsConnected(true);
        wsRef.current = websocket;
        isConnectingRef.current = false;
        flushOutbound();
      };

      websocket.onmessage = (event) => {
        try {
          if (metricsEnabled && typeof window !== 'undefined' && window.__medautodataWsMetrics) {
            const now = performance.now();
            const metrics = window.__medautodataWsMetrics;
            metrics.messageCount = (metrics.messageCount || 0) + 1;
            metrics.lastMessageAt = now;
            if (!metrics.firstMessageAt) {
              metrics.firstMessageAt = now;
              if (metrics.openedAt != null && metrics.connectStartedAt != null) {
                // eslint-disable-next-line no-console
                console.log(
                  `[WS metrics] connect→open=${Math.round(metrics.openedAt - metrics.connectStartedAt)}ms, open→firstMsg=${Math.round(now - metrics.openedAt)}ms`,
                );
              }
            }
          }
          const data = JSON.parse(event.data);
          if (metricsEnabled) {
            const type = (data && typeof data === 'object' && 'type' in data) ? (data as any).type : undefined;
            const sessionId = (data && typeof data === 'object' && 'sessionId' in data) ? (data as any).sessionId : undefined;
            // eslint-disable-next-line no-console
            console.log('[WS recv]', type || '(no type)', sessionId ? `session=${sessionId}` : '');
          }
          messageQueueRef.current.push(data);
          if (!drainTimerRef.current) {
            drainTimerRef.current = setTimeout(drainQueue, 0);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (metricsEnabled && typeof window !== 'undefined' && window.__medautodataWsMetrics) {
          window.__medautodataWsMetrics.lastCloseAt = performance.now();
        }
        setIsConnected(false);
        wsRef.current = null;
        isConnectingRef.current = false;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        if (metricsEnabled && typeof window !== 'undefined') {
          window.__medautodataWsMetrics = window.__medautodataWsMetrics || { enabled: true };
          window.__medautodataWsMetrics.lastErrorAt = performance.now();
          window.__medautodataWsMetrics.lastError = error;
        }
        isConnectingRef.current = false;
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      isConnectingRef.current = false;
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, drainQueue, flushOutbound]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
      }
      outboundQueueRef.current = [];
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, connect]);

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      try {
        outboundQueueRef.current.push(JSON.stringify(message));
      } catch (error) {
        console.error('Error serializing WebSocket message:', error);
      }
      console.warn('WebSocket not connected; message queued');
      // Try to connect immediately so queued messages flush ASAP.
      connect();
    }
  }, [connect]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
