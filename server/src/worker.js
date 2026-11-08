// ============================================================================
// WORKER: HTTP API for online rooms. One Durable Object (Room) per room code.
//   POST /api/rooms            -> { code }             create a room
//   GET  /api/rooms/:code      -> room info            (404 if none)
//   GET  /api/rooms/:code/ws   -> WebSocket upgrade into the room
//   GET  /api/health           -> { ok: true }
// ============================================================================
import { randomCode, validCode, PROTO } from '../../shared/protocol.js';
export { Room } from './room.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    try {
      if (url.pathname === '/api/health') return json({ ok: true, proto: PROTO });
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        let body = {}; try { body = await request.json(); } catch (e) { }
        const kind = body.kind === 'tournament' ? 'tournament' : 'match';
        const tournament = kind === 'tournament' && body.tournament && JSON.stringify(body.tournament).length < 20000 ? body.tournament : null;
        for (let i = 0; i < 6; i++) {
          const code = randomCode();
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const r = await stub.init(code, kind, tournament);
          if (r && r.ok) return json({ code, kind });
        }
        return json({ error: 'busy' }, 503);
      }
      const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{5})(\/ws)?$/);
      if (m) {
        const code = m[1].toUpperCase();
        if (!validCode(code)) return json({ error: 'bad code' }, 400);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (m[2]) {
          if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
          return stub.fetch(request);
        }
        const info = await stub.info();
        return info ? json(info) : json({ error: 'not found' }, 404);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server error' }, 500);
    }
  },
};
