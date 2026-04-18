// POST /api/login
// Body: { password: string }
// Success: 200 { ok: true } + Set-Cookie sofar_auth=<signed>; 30 days
// Failure: 401 { error: "invalid" }

const crypto = require('crypto');
const COOKIE_NAME = 'sofar_auth';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmacSign(secret, message) {
  return b64url(crypto.createHmac('sha256', secret).update(message).digest());
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
    // Still do a compare of equal-length buffers to keep timing similar
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = async (req, res) => {
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

  // Parse body (Vercel parses JSON automatically when content-type is json)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const pw = (body && body.password) || '';

  // Check against owner first, then trusted (if set)
  const isOwner = safeCompare(pw, ownerPw);
  const isTrusted = trustedPw ? safeCompare(pw, trustedPw) : false;

  if (!isOwner && !isTrusted) {
    // Small artificial delay to blunt timing / rapid-fire attempts
    await new Promise(r => setTimeout(r, 300));
    res.status(401).json({ error: 'invalid password' });
    return;
  }

  // Build signed cookie payload
  const payload = {
    iat: Date.now(),
    exp: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000
    // Not encoding role since both passwords grant identical access
  };
  const token = signPayload(secret, payload);

  // Set HttpOnly Secure SameSite=Strict cookie
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
};
