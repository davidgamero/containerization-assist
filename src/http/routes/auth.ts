/**
 * GitHub OAuth routes.
 *
 * GET  /v1/auth/github          — redirect user to GitHub authorization page
 * GET  /v1/auth/github/callback — exchange code for token, set httpOnly cookie
 * GET  /v1/auth/me              — return current user info (if authenticated)
 * POST /v1/auth/logout          — clear auth cookie
 */

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import type { HonoEnv, ApiResponse } from '../types';

interface AuthConfig {
  githubClientId: string;
  githubClientSecret: string;
}

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const COOKIE_NAME = 'gh_token';

export function authRoutes(config: AuthConfig): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Redirect to GitHub OAuth page.
  router.get('/github', (c) => {
    if (!config.githubClientId) {
      return c.json(
        {
          ok: false,
          error: { code: 'NOT_CONFIGURED', message: 'GitHub OAuth not configured' },
        } satisfies ApiResponse,
        501,
      );
    }

    const state = randomUUID();
    // Store state in a short-lived cookie for CSRF verification.
    setCookie(c, 'gh_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 600, // 10 minutes
    });

    const redirectUri = new URL(c.req.url);
    redirectUri.pathname = '/v1/auth/github/callback';

    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: redirectUri.toString(),
      scope: 'repo user:email',
      state,
    });

    return c.redirect(`${GITHUB_AUTH_URL}?${params.toString()}`);
  });

  // OAuth callback — exchange code for access token.
  router.get('/github/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const storedState = getCookie(c, 'gh_oauth_state');

    deleteCookie(c, 'gh_oauth_state');

    if (!code || !state || state !== storedState) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_STATE', message: 'OAuth state mismatch' },
        } satisfies ApiResponse,
        400,
      );
    }

    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      return c.json(
        {
          ok: false,
          error: { code: 'TOKEN_ERROR', message: tokenData.error ?? 'Failed to exchange code' },
        } satisfies ApiResponse,
        400,
      );
    }

    setCookie(c, COOKIE_NAME, tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year — OAuth tokens don't expire
    });

    // Redirect back to UI after login.
    return c.redirect('/');
  });

  // Return current user profile (if authenticated).
  router.get('/me', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) {
      return c.json(
        {
          ok: false,
          error: { code: 'UNAUTHENTICATED', message: 'Not logged in' },
        } satisfies ApiResponse,
        401,
      );
    }

    const userRes = await fetch(GITHUB_USER_URL, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'containerization-assist' },
    });

    if (!userRes.ok) {
      deleteCookie(c, COOKIE_NAME);
      return c.json(
        {
          ok: false,
          error: { code: 'TOKEN_INVALID', message: 'GitHub token invalid' },
        } satisfies ApiResponse,
        401,
      );
    }

    const user = await userRes.json();
    return c.json({ ok: true, value: user } satisfies ApiResponse);
  });

  // Logout.
  router.post('/logout', (c) => {
    deleteCookie(c, COOKIE_NAME);
    return c.json({ ok: true } satisfies ApiResponse);
  });

  return router;
}
