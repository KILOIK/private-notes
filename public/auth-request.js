const SESSION_PRESERVING_UNAUTHORIZED_PATHS = new Set([
  '/api/login/totp',
  '/api/auth/reauth',
]);

/**
 * Interactive authentication forms use 401 for invalid credentials or codes.
 * Those failures must not erase the current page/session state.
 * @param {string} url
 */
export function shouldPreserveSessionOnUnauthorized(url) {
  const path = String(url).split('?', 1)[0];
  return SESSION_PRESERVING_UNAUTHORIZED_PATHS.has(path);
}
