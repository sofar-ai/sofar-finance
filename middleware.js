// SOFAR Finance — Auth middleware
// Runs on every request via Vercel Edge runtime.
// Validates sofar_auth cookie (HMAC-signed). If missing/invalid:
//   - HTML requests → redirect to /login.html
//   - /api/* requests → return 401 JSON
// Exempt paths: /login.html, /api/login, /api/logout, /favicon.ico, /_next/*

export const config = {
  // Match all paths EXCEPT the exempt ones
  // Using negative lookahead so exempt paths are never matched
  matcher: [
    '/((?!login\\.html$|api/login$|api/logout$|favicon\\.ico$|_next/|assets/).*)'
  ]
};

const COOKIE_NAME = 'sofar_auth';

// HMAC-SHA256 using Web Crypto API (available in Vercel Edge runtime)
async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  // Convert ArrayBuffer to base64url
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyCookie(cookieValue, secret) {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;

  // Recompute signature
  const expected = await hmacSign(secret, payload);
  if (signature !== expected) return false;

  // Decode payload and check expiry
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!decoded.exp || Date.now() > decoded.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Exempt paths — double-check beyond matcher (belt + suspenders)
  const exempt = [
    '/login.html',
    '/api/login',
    '/api/logout',
    '/favicon.ico'
  ];
  if (exempt.includes(pathname) || pathname.startsWith('/_next/') || pathname.startsWith('/assets/')) {
    return; // let request pass through to origin
  }

  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret) {
    // Misconfigured — fail closed
    return new Response('Auth not configured', { status: 503 });
  }

  // Parse cookies from Cookie header
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=', 2).map(decodeURIComponent))
      .filter(p => p.length === 2)
  );
  const authCookie = cookies[COOKIE_NAME];

  const isValid = await verifyCookie(authCookie, secret);
  if (isValid) {
    return; // authenticated — pass through
  }

  // Not authenticated — branch by request type
  const isApi = pathname.startsWith('/api/');
  if (isApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  // HTML request — redirect to login, preserving destination
  const loginUrl = new URL('/login.html', request.url);
  loginUrl.searchParams.set('next', pathname + url.search);
  return Response.redirect(loginUrl.toString(), 302);
}
