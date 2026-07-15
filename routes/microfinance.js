// routes/microfinance.js
// GET /api/microfinance?risk_tier=Low|Medium|High
//
// Returns matching microfinance institutions/banks for a given risk
// tier, sorted with banks/larger institutions first for Low risk and
// more accessible microfinance/digital lenders first for High risk.

const express = require('express');
const db = require('../db');
const cache = require('../utils/cache');

const router = express.Router();

router.get('/', async (req, res) => {
  const riskTier = req.query.risk_tier;
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  if (!['Low', 'Medium', 'High'].includes(riskTier)) {
    return res.status(400).json({ error: "risk_tier must be 'Low', 'Medium', or 'High'." });
  }

  const cacheKey = `microfinance:${riskTier}:${lang}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(cached);
  }

  try {
    const [rows] = await db.query(
      `SELECT id, name, type, min_loan_tzs, max_loan_tzs, typical_interest_note,
              eligibility_summary, eligibility_summary_sw, website, last_verified
       FROM microfinance_institutions
       WHERE active = TRUE AND FIND_IN_SET(?, suited_risk_tiers)
       ORDER BY
         CASE type
           WHEN 'bank' THEN 1
           WHEN 'microfinance' THEN 2
           WHEN 'sacco' THEN 3
           WHEN 'digital_lender' THEN 4
         END ASC,
         name ASC
       LIMIT 20`,
      [riskTier]
    );

    // Use the Swahili summary when requested and available; otherwise
    // fall back to English rather than showing blank/missing text.
    const localized = rows.map(({ eligibility_summary_sw, ...row }) => ({
      ...row,
      eligibility_summary: lang === 'sw' && eligibility_summary_sw
        ? eligibility_summary_sw
        : row.eligibility_summary,
    }));

    const payload = { risk_tier: riskTier, count: localized.length, institutions: localized };
    cache.set(cacheKey, payload, 60 * 60 * 1000); // 1 hour — this reference data barely changes
    res.set('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(payload);

  } catch (err) {
    console.error('Microfinance lookup error:', err.message);
    return res.status(500).json({ error: 'Could not fetch microfinance options.' });
  }
});

module.exports = router;
