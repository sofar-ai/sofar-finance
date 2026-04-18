// POST /api/logout (also accepts GET for convenience)
// Clears the sofar_auth cookie.

const COOKIE_NAME = 'sofar_auth';

module.exports = async (req, res) => {
  const cookieAttrs = [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');

  res.setHeader('Set-Cookie', cookieAttrs);

  // If GET request (user navigated to /api/logout in browser), redirect to login
  if (req.method === 'GET') {
    res.setHeader('Location', '/login.html');
    res.status(302).end();
    return;
  }

  res.status(200).json({ ok: true });
};
