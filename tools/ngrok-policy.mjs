// Public playtesting exposes player routes only, not the editor or staff vault.
export const publicPaths = ['/', '/index.html', '/favicon.ico', '/ws',
  '/api/register', '/api/login', '/api/map', '/api/event', '/api/account'];

export const playerTrafficPolicy = {
  on_http_request: [{
    expressions: [
      // Only literal safe asset paths: encoded Windows separators must never
      // reach the asset handler, which resolves paths on the host filesystem.
      `!(req.url.path in ${JSON.stringify(publicPaths)} || (req.url.raw_path.matches('^/(assets|art)/[A-Za-z0-9_./-]+$') && !req.url.raw_path.contains('..')))`,
    ],
    actions: [{
      type: 'custom-response',
      config: {
        status_code: 404,
        body: 'Not found',
        headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      },
    }],
  }],
};
