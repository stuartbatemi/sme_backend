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
const cache   = require('../utils/cache');
const { logActivity } = require('../utils/auditLog');
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
    const { path_type, business_idea, funding_type, prior_experience, ...payload } = req.body;
    // path_type: 'A' or 'B'
    // funding_type (optional): 'personal' | 'loan' | 'expansion'
    // prior_experience (optional, only meaningful when funding_type === 'expansion'):
    //   [{ isic_detailed: 4711, years: 3, still_active: true }, ...]

    if (!['A', 'B'].includes(path_type)) {
        return res.status(400).json({ error: "path_type must be 'A' or 'B'" });
    }
    if (funding_type && !['personal', 'loan', 'expansion'].includes(funding_type)) {
        return res.status(400).json({ error: "funding_type must be 'personal', 'loan', or 'expansion'" });
    }

    // For Path B, if the person has prior business experience, pass the
    // ISIC codes through so the model can boost matching-sector results.
    if (path_type === 'B' && Array.isArray(prior_experience) && prior_experience.length > 0) {
        payload.prior_experience_isic = prior_experience
            .map(e => e.isic_detailed)
            .filter(code => Number.isInteger(code));
    }

    // For Path B, pull recent system-wide recommendation frequency so
    // the model can softly de-weight over-shown activities. Best-effort:
    // if this query fails for any reason, just skip the penalty rather
    // than blocking the whole prediction on it.
    if (path_type === 'B') {
        try {
            const [freqRows] = await db.query(
                `SELECT isic_detailed, COUNT(*) as cnt
                 FROM recommendation_events
                 WHERE recommended_at > NOW() - INTERVAL 7 DAY
                 GROUP BY isic_detailed
                 ORDER BY cnt DESC
                 LIMIT 30`
            );
            if (freqRows.length > 0) {
                payload.frequency_penalty_isic = Object.fromEntries(
                    freqRows.map(r => [r.isic_detailed, r.cnt])
                );
            }
        } catch (freqErr) {
            console.error('Frequency lookup failed (non-fatal):', freqErr.message);
        }
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

        // Log what was actually shown, for future frequency-penalty
        // queries — fire-and-forget, must never block/fail the response
        // the user is waiting on.
        if (path_type === 'B' && Array.isArray(result.recommendations)) {
            const rows = result.recommendations
                .filter(r => Number.isInteger(r.isic_detailed))
                .map(r => [r.isic_detailed, payload.district || null]);
            if (rows.length > 0) {
                db.query(
                    'INSERT INTO recommendation_events (isic_detailed, district) VALUES ?',
                    [rows]
                ).catch(logErr => console.error('Recommendation logging failed (non-fatal):', logErr.message));
            }
        }
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

    // ── Capital below minimum: model already short-circuited (result.blocked
    // === true) and did NOT run a prediction. Skip alternatives-fetch and
    // DB save below — nothing to save, just pass the message straight through.
    if (result.blocked) {
        return res.status(200).json({
            ...result,
            saved: false,
            model_tier: userTier === 'premium' ? 'premium' : 'regular',
        });
    }

    // ── Risk tier for loan-seeking users ───────────────────────────────
    // Simple, defensible mapping: the model's own predicted success
    // category IS the risk signal — High predicted success = Low loan
    // risk, and so on. Only computed/shown when the person indicated
    // they're seeking a loan, so it doesn't clutter results for people
    // using personal funds.
    function successToRiskTier(chance) {
        const c = String(chance || '').toLowerCase();
        if (c === 'high') return 'Low';
        if (c === 'medium') return 'Medium';
        if (c === 'low') return 'High';
        return null;
    }
    if (funding_type === 'loan') {
        if (path_type === 'A') {
            result.risk_tier = successToRiskTier(result.success_chance);
        } else if (Array.isArray(result.recommendations)) {
            result.recommendations = result.recommendations.map(r => ({
                ...r,
                risk_tier: successToRiskTier(r.success_chance),
            }));
        }
    }


    // ── Fetch alternatives for Low/Medium Path A results ──────────────
    // If Path A comes back Low or Medium, we silently call /predict/path-b
    // with the same location + capital + demographics and attach the top 5
    // results as `alternatives` so the frontend can show better options.
    if (path_type === 'A' && result.success_chance) {
        const chance = String(result.success_chance).toLowerCase();
        if (chance === 'low' || chance === 'medium') {
            try {
                const altPayload = {
                    district:    payload.district,
                    ward:        payload.ward,
                    village:     payload.village,
                    capital_tzs: payload.capital_tzs,
                    age:         payload.age,
                    gender:      payload.gender,
                    top_n:       5,
                };
                const altResponse = await axios.post(
                    `${modelBaseUrl}/predict/path-b`,
                    altPayload,
                    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
                );
                result.alternatives = altResponse.data?.recommendations || [];
            } catch (altErr) {
                // Non-critical — don't fail the main result if alternatives fetch fails
                console.error('Alternatives fetch failed:', altErr.message);
                result.alternatives = [];
            }
        }
    }

    // Save to DB if Premium user
    let sessionSaved = false;
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
                  capital_tzs, funding_type, prior_experience, age_at_query, gender, isic_code,
                  result_json, success_chance, risk_tier, monthly_profit, roi_percent, breakeven_months)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    path_type,
                    business_idea || null,
                    payload.district || null,
                    payload.ward || null,
                    payload.village || null,
                    payload.capital_tzs || null,
                    funding_type || null,
                    prior_experience ? JSON.stringify(prior_experience) : null,
                    payload.age || null,
                    payload.gender || null,
                    payload.isic_detailed || null,
                    JSON.stringify(result),
                    success_chance,
                    result.risk_tier || null,
                    monthly_profit,
                    roi_percent,
                    breakeven_months,
                ]
            );
            sessionSaved = true;
            await logActivity(req, {
                userId,
                action: 'advisory.predict',
                entityType: 'advisory_session',
                meta: { path_type, tier: userTier },
            });
        } catch (dbErr) {
            // Don't fail the request if DB save fails — just log it.
            // `saved` stays false so the frontend/caller isn't told a
            // save succeeded when it actually didn't.
            console.error('Failed to save advisory session:', dbErr.message);
        }
    }

    return res.status(200).json({
        ...result,
        saved: sessionSaved,
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
    const cacheKey = `districts:${userTier}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(cached);
    }

    try {
        const response = await axios.get(`${modelBaseUrl}/districts`, { timeout: 10000 });
        cache.set(cacheKey, response.data, 10 * 60 * 1000); // 10 min — this list basically never changes
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /districts error:', err.message);
        return res.status(500).json({ error: 'Could not fetch districts.' });
    }
});


// ── GET /api/advisory/sectors ────────────────────────────────────
// Tier-aware proxy for the sector dropdown (Path A's "browse by
// sector" narrowing, and Path B's "I know the sector but not the
// specific business" filter). Same caching pattern as /districts.
router.get('/sectors', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    const cacheKey = `sectors:${userTier}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(cached);
    }

    try {
        const response = await axios.get(`${modelBaseUrl}/sectors`, { timeout: 10000 });
        cache.set(cacheKey, response.data, 10 * 60 * 1000); // 10 min — basically static
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /sectors error:', err.message);
        return res.status(500).json({ error: 'Could not fetch sectors.' });
    }
});


// ── GET /api/advisory/skills ─────────────────────────────────────
router.get('/skills', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    const cacheKey = `skills:${userTier}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(cached);
    }

    try {
        const response = await axios.get(`${modelBaseUrl}/skills`, { timeout: 10000 });
        cache.set(cacheKey, response.data, 10 * 60 * 1000);
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /skills error:', err.message);
        return res.status(500).json({ error: 'Could not fetch skills.' });
    }
});


// ── GET /api/advisory/hobbies ────────────────────────────────────
router.get('/hobbies', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    const cacheKey = `hobbies:${userTier}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(cached);
    }

    try {
        const response = await axios.get(`${modelBaseUrl}/hobbies`, { timeout: 10000 });
        cache.set(cacheKey, response.data, 10 * 60 * 1000);
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /hobbies error:', err.message);
        return res.status(500).json({ error: 'Could not fetch hobbies.' });
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
    const sector = req.query.sector || '';
    const cacheKey = `activities:${userTier}:${sector}`;

    const cached = cache.get(cacheKey);
    if (cached) {
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(cached);
    }

    try {
        const response = await axios.get(`${modelBaseUrl}/activities`, {
            timeout: 10000,
            params: sector ? { sector } : {},
        });
        cache.set(cacheKey, response.data, 10 * 60 * 1000);
        res.set('Cache-Control', 'public, max-age=300');
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('FastAPI /activities error:', err.message);
        return res.status(500).json({ error: 'Could not fetch activities.' });
    }
});


// ── GET /api/advisory/experience-search ──────────────────────────────
// Searchable business-type lookup for the "have you owned a business
// before?" step (funding_type === 'expansion'). Reuses the SAME
// activity catalog as Path A's business-idea search — no new data
// needed, just a friendlier alias so the frontend can use a distinct
// endpoint name for this step of the flow.
router.get('/experience-search', async (req, res) => {
    const { userTier } = identifyUser(req);
    const modelBaseUrl = resolveModelBaseUrl(userTier);
    const query = req.query.q || '';

    try {
        const response = await axios.get(`${modelBaseUrl}/activities`, {
            timeout: 10000,
            params: query ? { search: query } : {},
        });
        return res.status(200).json(response.data);
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'Advisory model is offline. Please try again shortly.' });
        }
        console.error('experience-search error:', err.message);
        return res.status(500).json({ error: 'Could not search business types.' });
    }
});


module.exports = router;