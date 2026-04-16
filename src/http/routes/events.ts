import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { HonoEnv } from '../types';
import type { SessionStore } from '../sessions/store';

export function eventRoutes(sessionStore: SessionStore): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id');
    const session = sessionStore.get(sessionId);

    if (!session) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }

    return streamSSE(c, async (stream) => {
      let eventId = 0;

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'phase_change',
          sessionId,
          phase: session.phase,
          logs: session.logs,
          artifacts: session.artifacts.map((a) => ({
            id: a.id,
            name: a.name,
            phase: a.phase,
            version: a.version,
          })),
        }),
        event: 'init',
        id: String(eventId++),
      });

      const buffered = sessionStore.getEventHistory(sessionId);
      for (const event of buffered) {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
            id: String(eventId++),
          });
        } catch {
          return;
        }
      }

      const unsubscribe = sessionStore.subscribe(sessionId, async (event) => {
        try {
          await stream.writeSSE({
            data: JSON.stringify(event),
            event: event.type,
            id: String(eventId++),
          });
        } catch {
          // Client disconnected.
        }
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      while (true) {
        const current = sessionStore.get(sessionId);
        if (!current || current.phase === 'complete' || current.phase === 'failed') {
          break;
        }
        await stream.sleep(1000);
      }

      unsubscribe();
    });
  });

  return router;
}
