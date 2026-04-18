// POST /api/login
// Body: { password: string }
// Success: 200 { ok: true } + Set-Cookie sofar_auth=<signed>; 30 days
// Failure: 401 { error: "invalid password" }

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'sofar_auth';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmacSign(secret, message) {
  return b64url(createHmac('sha256', secret).update(message).digest());
}

function signPayload(secret, payload) {
  const encoded = b64url(JSON.stringify(payload));
  const sig = hmacSign(secret, encoded);
  return `${encoded}.${sig}`;
}

// Timing-safe string compare to prevent timing attacks on password check
function safeCompare(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Keep timing similar by doing an equal-length compare on dummy data
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const secret = process.env.AUTH_COOKIE_SECRET;
  const ownerPw = process.env.AUTH_PASSWORD_OWNER;
  const trustedPw = process.env.AUTH_PASSWORD_TRUSTED;

  if (!secret || !ownerPw) {
    res.status(503).json({ error: 'auth not configured' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const pw = (body && body.password) || '';

  const isOwner = safeCompare(pw, ownerPw);
  const isTrusted = trustedPw ? safeCompare(pw, trustedPw) : false;

  if (!isOwner && !isTrusted) {
    // Small artificial delay to blunt rapid-fire attempts
    await new Promise(r => setTimeout(r, 300));
    res.status(401).json({ error: 'invalid password' });
    return;
  }

  const payload = {
    iat: Date.now(),
    exp: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000
  };
  const token = signPayload(secret, payload);

  const cookieAttrs = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');

  res.setHeader('Set-Cookie', cookieAttrs);
  res.status(200).json({ ok: true });
}
