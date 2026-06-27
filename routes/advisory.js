// routes/advisory.js
// Handles: POST /api/advisory/predict
//
// FLOW:
//   1. Receive request from React
//   2. If user is Premium (has valid JWT), note their user_id
//   3. Forward the payload to FastAPI model server
//   4. If Premium user, save result to advisory_sessions table
//   5. Return result to React

const express = require('express');
const axios   = require('axios');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

// ── Two model servers: Regular (original) and Premium (Lonet 2.5) ──────
// Regular users always hit FASTAPI_URL. Premium users (valid JWT with
// tier === 'premium') get routed to FASTAPI_URL_PREMIUM instead — the
// stronger, faster Lonet 2.5 model trained on the bigger merged dataset.
// If FASTAPI_URL_PREMIUM isn't set yet (e.g. not deployed), premium
// users safely fall back to the regular model rather than breaking.
const FASTAPI          = process.env.FASTAPI_URL          || 'http://127.0.0.1:8000';
const FASTAPI_PREMIUM  = process.env.FASTAPI_URL_PREMIUM  || FASTAPI;

function resolveModelBaseUrl(userTier) {
    return userTier === 'premium' ? FASTAPI_PREMIUM : FASTAPI;
}

// Reads the Authorization header (if present) and returns { userId, userTier }.
// Never throws — an invalid/missing token just means "treat as regular user".
function identifyUser(req) {
    let userId = null;
    let userTier = 'regular';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const { verifyAccessToken } = require('../utils/jwt');
            const payload_jwt = verifyAccessToken(authHeader.split(' ')[1]);
            userId = payload_jwt.userId;
            userTier = payload_jwt.tier;
        } catch (_) {
            // Token invalid/expired — treat as regular user, don't block
        }
    }
    return { userId, userTier };
}


// ── POST /api/advisory/predict ────────────────────────────────────
// Works for BOTH Regular (no token) and Premium (with token) users.
// Regular: result returned, nothing saved.
// Premium: result returned AND saved to DB.
router.post('/predict', async (req, res) => {
    const { path_type, business_idea, ...payload } = req.body;
    // path_type: 'A' or 'B'

    if (!['A', 'B'].includes(path_type)) {
        return res.status(400).json({ error: "path_type must be 'A' or 'B'" });
    }

    // Detect if this is a Premium user (optional auth) — Premium users get
    // routed to Lonet 2.5, the stronger/faster model.
    const { userId, userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);

    // Forward to FastAPI (whichever server this user's tier resolves to)
    const endpoint = path_type === 'A' ? '/predict/path-a' : '/predict/path-b';
    let result;
    try {
        const response = await axios.post(`${modelBaseUrl}${endpoint}`, payload, {
            timeout: 30000,   // 30 second timeout
            headers: { 'Content-Type': 'application/json' }
        });
        result = response.data;
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        console.error('FastAPI error:', err.message);
        return res.status(500).json({ error: 'Prediction failed. Please try again.' });
    }

    // Save to DB if Premium user
    if (userId && userTier === 'premium') {
        try {
            // Extract quick-access fields from result
            let success_chance = null, monthly_profit = null,
                roi_percent = null, breakeven_months = null;

            if (path_type === 'A') {
                success_chance   = result.success_chance   || null;
                monthly_profit   = result.expected_monthly_profit_tzs || null;
                roi_percent      = result.roi_percent_per_year || null;
                breakeven_months = result.breakeven_months  || null;
            } else {
                // Path B: take the first/top recommendation's values
                const top = result.recommendations?.[0];
                if (top) {
                    success_chance   = top.success_chance || null;
                    monthly_profit   = top.expected_monthly_profit_tzs || null;
                    roi_percent      = top.roi_percent_per_year || null;
                    breakeven_months = top.breakeven_months || null;
                }
            }

            await db.query(
                `INSERT INTO advisory_sessions
                 (user_id, path_type, business_idea, district, ward, village,
                  capital_tzs, age_at_query, gender, isic_code,
                  result_json, success_chance, monthly_profit, roi_percent, breakeven_months)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    path_type,
                    business_idea || null,
                    payload.district || null,
                    payload.ward || null,
                    payload.village || null,
                    payload.capital_tzs || null,
                    payload.age || null,
                    payload.gender || null,
                    payload.isic_detailed || null,
                    JSON.stringify(result),
                    success_chance,
                    monthly_profit,
                    roi_percent,
                    breakeven_months,
                ]
            );
        } catch (dbErr) {
            // Don't fail the request if DB save fails — just log it
            console.error('Failed to save advisory session:', dbErr.message);
        }
    }

    return res.status(200).json({
        ...result,
        saved: userId && userTier === 'premium' ? true : false,
        model_tier: userTier === 'premium' ? 'premium' : 'regular',
    });
});


// ── GET /api/advisory/history ─────────────────────────────────────
// Premium only — returns this user's past advisory sessions.
router.get('/history', requireAuth, async (req, res) => {
    if (req.user.tier !== 'premium') {
        return res.status(403).json({
            error: 'Premium subscription required to view history.'
        });
    }

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    try {
        const [rows] = await db.query(
            `SELECT id, path_type, business_idea, district, ward,
                    capital_tzs, success_chance, monthly_profit,
                    roi_percent, breakeven_months, created_at
             FROM advisory_sessions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.userId, limit, offset]
        );

        const [[{ total }]] = await db.query(
            'SELECT COUNT(*) as total FROM advisory_sessions WHERE user_id = ?',
            [req.user.userId]
        );

        return res.status(200).json({
            sessions: rows,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });

    } catch (err) {
        console.error('History error:', err);
        return res.status(500).json({ error: 'Failed to fetch history.' });
    }
});


// ── GET /api/advisory/history/:id ────────────────────────────────
// Returns a specific session's FULL result_json for Premium users.
router.get('/history/:id', requireAuth, async (req, res) => {
    if (req.user.tier !== 'premium') {
        return res.status(403).json({ error: 'Premium required.' });
    }

    try {
        const [rows] = await db.query(
            'SELECT * FROM advisory_sessions WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Session not found.' });
        }

        return res.status(200).json(rows[0]);

    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch session.' });
    }
});

// ── GET /api/advisory/districts ────────────────────────────────────
// Proxies to whichever model server matches the caller's tier, so
// Premium users searching for a business idea see Lonet 2.5's district
// list (same 5 districts today, but keeps both models in sync if that
// ever changes) instead of always hitting the Regular model directly
// from the browser.
router.get('/districts', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    try {
        const response = await axios.get(`${modelBaseUrl}/districts`, { timeout: 10000 });
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /districts error:', err.message);
        return res.status(500).json({ error: 'Could not fetch districts.' });
    }
});


// ── GET /api/advisory/activities ───────────────────────────────────
// Same tier-aware proxy, for the business-activity search/autocomplete
// used in Path A ("I have a business idea"). Premium users searching
// will match against Lonet 2.5's fuller activity catalog (covers
// machinga, daladala, kandoro water sellers, etc. that the Regular
// model's catalog may not have).
router.get('/activities', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    try {
        const response = await axios.get(`${modelBaseUrl}/activities`, {
            timeout: 10000,
            params: req.query.sector ? { sector: req.query.sector } : {},
        });
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /activities error:', err.message);
        return res.status(500).json({ error: 'Could not fetch activities.' });
    }
});


module.exports = router;
