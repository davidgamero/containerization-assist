import { useEffect, useRef, useState } from 'react';
import { SessionEvent } from '../api/client';

export function useSSE(url: string | null) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!url) return;

    const connect = () => {
      try {
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
        };

        eventSource.addEventListener('init', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data.logs) && data.logs.length > 0) {
              setLogs(data.logs);
            }
          } catch (err) {
            console.error('Failed to parse init event:', err);
          }
        });

        eventSource.addEventListener('phase_change', (event) => {
          try {
            const data: SessionEvent = JSON.parse(event.data);
            setEvents((prev) => [...prev, data]);
          } catch (err) {
            console.error('Failed to parse phase_change event:', err);
          }
        });

        eventSource.addEventListener('artifact', (event) => {
          try {
            const data: SessionEvent = JSON.parse(event.data);
            setEvents((prev) => [...prev, data]);
          } catch (err) {
            console.error('Failed to parse artifact event:', err);
          }
        });

        eventSource.addEventListener('log', (event) => {
          try {
            const data: SessionEvent = JSON.parse(event.data);
            if (data.message) {
              setLogs((prev) => [...prev, data.message!]);
            }
          } catch (err) {
            console.error('Failed to parse log event:', err);
          }
        });

        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource.close();

          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, 3000);
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [url]);

  return { events, logs, isConnected, error };
}
