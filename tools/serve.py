#!/usr/bin/env python3
"""Local dev server for the static site.

Plain `python -m http.server` sends no Cache-Control, so browsers fall
back to heuristic freshness and happily serve a stale .js or .json for
minutes after you edit it. On a site with no build step and no
fingerprinted filenames that is the single most confusing thing that
can happen while testing: the page runs code you already changed.

This is http.server with `Cache-Control: no-store` on everything, and
the right content types for the file kinds this site serves.

    python tools/serve.py [port]        # default 4173
"""

import sys
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.js':   'text/javascript; charset=utf-8',
        '.mjs':  'text/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg':  'image/svg+xml',
        '.html': 'text/html; charset=utf-8',
    })

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # A 304 would defeat the point — always send the body. headers is an
    # email.message.Message, so it has __delitem__ (a no-op when absent)
    # but no pop().
    def send_head(self):
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().send_head()

    def log_message(self, fmt, *args):
        # Quieter than the default: one line per request, no timestamp noise.
        sys.stderr.write('%s %s\n' % (self.command, self.path))


if __name__ == '__main__':
    handler = functools.partial(NoCacheHandler, directory='.')
    with ThreadingHTTPServer(('127.0.0.1', PORT), handler) as httpd:
        print('Serving on http://localhost:%d  (no-store; edits show on reload)' % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')
