// /api/logout — clears the sofar_auth cookie.
// POST returns JSON. GET redirects to /login.html.

const COOKIE_NAME = 'sofar_auth';

export default async function handler(req, res) {
  const cookieAttrs = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');

  res.setHeader('Set-Cookie', cookieAttrs);

  if (req.method === 'GET') {
    res.setHeader('Location', '/login.html');
    res.status(302).end();
    return;
  }

  res.status(200).json({ ok: true });
}
