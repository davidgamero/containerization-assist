/**
 * API Key Authentication Middleware
 *
 * Simple API key validation for all /api/* routes.
 * The key is configured via CA_API_KEY environment variable.
 * If CA_API_KEY is not set, authentication is disabled (development mode).
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

const API_KEY = process.env.CA_API_KEY;

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip auth if no API key is configured (development mode)
  if (!API_KEY) {
    return;
  }

  // Skip health endpoints
  if (request.url === '/health' || request.url === '/ready') {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.status(401).send({ error: 'Missing Authorization header' });
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== API_KEY) {
    return reply.status(403).send({ error: 'Invalid API key' });
  }
}
