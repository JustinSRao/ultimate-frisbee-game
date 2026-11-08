// Entry point: load device storage (localStorage or the Tauri store) first, then boot the game.
import { initStorage } from './storage.js';
initStorage().catch(() => { }).then(() => import('./main.js'));
