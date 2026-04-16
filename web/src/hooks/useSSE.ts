import { useEffect, useRef, useState } from 'react';
import { PolicyResult, SessionEvent } from '../api/client';

export function useSSE(url: string | null) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [policyResults, setPolicyResults] = useState<PolicyResult[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!url || done) return;

    const stopStreaming = () => {
      doneRef.current = true;
      setDone(true);
      setIsConnected(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const connect = () => {
      if (doneRef.current) return;

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
            if (Array.isArray(data.policies) && data.policies.length > 0) {
              setPolicyResults(data.policies);
            }
            if (data.phase === 'complete' || data.phase === 'failed') {
              stopStreaming();
            }
          } catch (err) {
            console.error('Failed to parse init event:', err);
          }
        });

        eventSource.addEventListener('phase_change', (event) => {
          try {
            const data: SessionEvent = JSON.parse(event.data);
            setEvents((prev) => [...prev, data]);
            if (data.phase === 'complete' || data.phase === 'failed') {
              stopStreaming();
            }
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

        eventSource.addEventListener('policy_result', (event) => {
          try {
            const data: SessionEvent = JSON.parse(event.data);
            if (data.result) {
              setPolicyResults((prev) => [...prev, data.result!]);
              setEvents((prev) => [...prev, data]);
            }
          } catch (err) {
            console.error('Failed to parse policy_result event:', err);
          }
        });

        eventSource.addEventListener('complete', () => {
          stopStreaming();
        });

        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource.close();

          if (!doneRef.current) {
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connect();
            }, 3000);
          }
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
  }, [url, done]);

  return { events, logs, policyResults, isConnected, error, done };
}
