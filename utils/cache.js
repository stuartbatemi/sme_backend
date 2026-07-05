// utils/cache.js — tiny in-memory TTL cache
//
// Why: /api/advisory/districts and /api/advisory/activities barely ever
// change, but every request was hitting the FastAPI model server again.
// That's extra latency for users and extra compute/bandwidth billed on
// Railway for no reason. This caches responses for a short time so
// repeat requests are served instantly from Node's memory instead.
//
// Note: this cache lives in the Node process's memory. If you ever run
// more than one server instance (horizontal scaling), each instance
// has its own cache — that's fine for this use case (worst case, one
// instance serves data that's a few minutes stale), but if you later
// need a *shared* cache across instances, swap this for Redis.

const store = new Map(); // key -> { value, expiresAt }

function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
    }
    return entry.value;
}

function set(key, value, ttlMs) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

module.exports = { get, set };
