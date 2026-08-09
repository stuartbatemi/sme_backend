// utils/auditLog.js
// General-purpose activity logger — writes to audit_log (see
// migrations/13_audit_log.sql). Mirrors the non-fatal pattern used by
// logLoginEvent in routes/auth.js: a logging failure should NEVER
// block the actual request from succeeding, so every call swallows
// its own errors and just logs to the console.
//
// Usage:
//   const { logActivity } = require('../utils/auditLog');
//   await logActivity(req, {
//     userId: user.id,
//     action: 'payment.completed',
//     entityType: 'payment',
//     entityId: payment.id,
//     meta: { amount_tzs: 15000, method: 'demo' },
//   });

const db = require('../db');

async function logActivity(req, { userId = null, action, entityType = null, entityId = null, meta = null }) {
    if (!action) {
        console.error('logActivity called without required `action`');
        return;
    }
    try {
        await db.query(
            `INSERT INTO audit_log
             (user_id, action, entity_type, entity_id, meta, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                action,
                entityType,
                entityId,
                meta ? JSON.stringify(meta) : null,
                req?.ip || null,
                (req?.headers?.['user-agent'] || '').slice(0, 255) || null,
            ]
        );
    } catch (err) {
        console.error('logActivity failed (non-fatal):', err.message);
    }
}

module.exports = { logActivity };