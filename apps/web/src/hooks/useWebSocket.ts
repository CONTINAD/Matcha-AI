'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Standardized WebSocket event envelope
 */
export interface WebSocketMessage {
  type: 'price' | 'trade' | 'performance' | 'status' | 'connected' | 'subscribed';
  strategyId?: string;
  payload: any; // Renamed from 'data' for consistency
  timestamp: number;
}

export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10; // Increased max attempts
    const baseReconnectDelay = 1000; // Start with 1 second
    const maxReconnectDelay = 30000; // Cap at 30 seconds

    const connect = () => {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          reconnectAttempts = 0; // Reset on successful connection
          console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            // Validate message structure (support both 'data' and 'payload' for backward compatibility)
            if (message.type && (message.payload || message.data) && message.timestamp) {
              // Normalize to 'payload' if message uses 'data'
              if (message.data && !message.payload) {
                message.payload = message.data;
                delete (message as any).data;
              }
              setLastMessage(message);
            } else {
              console.warn('Invalid WebSocket message format:', message);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          // Only log if not already reconnecting to avoid spam
          if (reconnectAttempts === 0) {
            console.warn('WebSocket connection error (will retry):', error);
          }
          setIsConnected(false);
        };

        ws.onclose = (event) => {
          setIsConnected(false);
          
          // Don't reconnect if closed normally (code 1000) or if max attempts reached
          if (event.code === 1000) {
            console.log('WebSocket closed normally');
            return;
          }
          
          if (reconnectAttempts >= maxReconnectAttempts) {
            console.warn('WebSocket max reconnection attempts reached. Please check if the server is running.');
            return;
          }

          // Exponential backoff: delay = min(baseDelay * 2^attempts, maxDelay)
          reconnectAttempts++;
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttempts - 1),
            maxReconnectDelay
          );
          
          // Only log first few attempts to avoid spam
          if (reconnectAttempts <= 3) {
            console.log(`WebSocket reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        };
      } catch (error) {
        console.error('Error creating WebSocket:', error);
        setIsConnected(false);
        
        // Retry on error with backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttempts - 1),
            maxReconnectDelay
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [url]);

  const sendMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  return { isConnected, lastMessage, sendMessage };
}

