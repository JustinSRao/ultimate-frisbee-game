// Where the online server lives. One place only.
// Priority: ?server=URL in the page address > saved override > build-time WUL_SERVER_URL > local dev > production default.
import { getItem } from './storage.js';

export const PROD_SERVER = 'https://wul-ultimate.traveltoolkit-proxy.workers.dev';

export function serverUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q.replace(/\/$/, ''); // this page load only
  } catch (e) { }
  const saved = getItem('wul-server'); if (saved) return saved.replace(/\/$/, '');
  // eslint-disable-next-line no-undef
  const built = typeof __SERVER_URL__ !== 'undefined' ? __SERVER_URL__ : '';
  if (built) return built.replace(/\/$/, '');
  try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return 'http://127.0.0.1:8787'; } catch (e) { }
  return PROD_SERVER;
}
export const wsUrl = (base) => base.replace(/^http/, 'ws');
