// routes/consultant.js
// POST /api/consultant/analyze
//
// Takes a completed advisory result (Path A or a chosen Path B
// recommendation) and asks an LLM to explain WHY it will/won't work at
// 3/6/12 months, given both the model's own factors (location,
// saturation, capital, sector) AND real-world factors the model never
// saw (seasonality, competition behavior, supply chains, regulation,
// weather/rainy season effects on foot traffic, etc.), then gives
// concrete first-30-days initiatives and general supplier guidance.
//
// Uses Groq's free API (OpenAI-compatible) — sign up at console.groq.com,
// get a free API key, set GROQ_API_KEY in .env. No cost at reasonable
// volumes for a capstone project's usage level.

const express = require('express');
const axios = require('axios');
require('dotenv').config();

const router = express.Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile'; // free tier, strong reasoning, fast

function buildPrompt({ activity, sector, district, ward, capital_tzs, monthly_profit,
                        success_chance, existing_similar_businesses_in_area, roi_percent,
                        breakeven_months, language }) {
  const languageInstruction = language === 'sw'
    ? 'Respond entirely in Swahili (Kiswahili) — every string value in the JSON must be in Swahili, not English.'
    : 'Respond entirely in English.';
  return `You are a business advisor for Dar es Salaam, Tanzania SMEs. A person has been
recommended this business:

Activity: ${activity}
Sector: ${sector}
Location: ${ward ? ward + ', ' : ''}${district}, Dar es Salaam
Starting capital: TZS ${Number(capital_tzs).toLocaleString()}
Model-predicted monthly profit: TZS ${Number(monthly_profit).toLocaleString()}
Model-predicted success category: ${success_chance}
Existing similar businesses already in this area: ${existing_similar_businesses_in_area}
${roi_percent ? `Predicted annual ROI: ${roi_percent}%` : ''}
${breakeven_months ? `Predicted breakeven: ${breakeven_months} months` : ''}

The prediction above was generated from historical business-registry and census data
(location, capital tier, sector saturation). It does NOT account for real-world factors
like seasonality, competitor behavior, supplier reliability, regulatory changes, weather/
rainy-season effects on foot traffic, or currency/import cost shifts.

${languageInstruction}

Respond in JSON only, matching this exact structure, no markdown fences, no preamble:
{
  "three_month_outlook": "2-3 sentences on what's realistic in the first 3 months, referencing BOTH the model's factors (saturation/location/capital) and at least one real-world factor the model can't see",
  "six_month_outlook": "2-3 sentences, same approach, focused on what typically changes by month 6 for this type of business in Dar es Salaam",
  "twelve_month_outlook": "2-3 sentences on the one-year picture, being honest about risks not captured in the data",
  "first_30_days": ["4-6 short, concrete, ordered first steps to actually launch this specific business in this specific location"],
  "supplier_guidance": "2-3 sentences of GENERAL guidance on what type of suppliers/wholesalers this business typically needs and where in Dar es Salaam that category of supplier is commonly found (e.g. Kariakoo for general retail goods) — do not name specific company names, since you cannot verify current, real, operating suppliers",
  "risk_factors_outside_the_model": ["3-4 short bullet points naming specific real-world risks NOT captured by location/capital/saturation data alone"]
}`;
}

router.post('/analyze', async (req, res) => {
  const isSw = req.body?.language === 'sw';

  if (!GROQ_API_KEY) {
    return res.status(503).json({
      error: isSw
        ? 'Mshauri wa AI bado hajawekwa. Ongeza GROQ_API_KEY kwenye .env ya backend (funguo bila malipo kutoka console.groq.com).'
        : 'AI consultant is not configured yet. Add GROQ_API_KEY to the backend .env (free key from console.groq.com).'
    });
  }

  const {
    activity, sector, district, ward, capital_tzs, monthly_profit,
    success_chance, existing_similar_businesses_in_area, roi_percent, breakeven_months,
    language,
  } = req.body;

  if (!activity || !district || capital_tzs == null || monthly_profit == null) {
    return res.status(400).json({
      error: isSw
        ? 'Taarifa zinazohitajika hazipo: activity, district, capital_tzs, monthly_profit.'
        : 'Missing required fields: activity, district, capital_tzs, monthly_profit.'
    });
  }

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are a precise, honest business advisor. You always respond with valid JSON only, no other text.' },
          { role: 'user', content: buildPrompt(req.body) },
        ],
        temperature: 0.4,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.error('Consultant JSON parse failed:', raw);
      return res.status(502).json({
        error: isSw
          ? 'Mshauri wa AI amerudisha muundo usiotarajiwa. Tafadhali jaribu tena.'
          : 'AI consultant returned an unexpected format. Please try again.'
      });
    }

    return res.status(200).json({
      ...parsed,
      generated_by: isSw
        ? 'Mshauri wa AI (ushauri wa jumla, haujathibitishwa eneo — hakiki kabla ya kutegemea)'
        : 'AI consultant (general guidance, not location-verified — cross-check before relying on it)',
    });

  } catch (err) {
    if (err.response) {
      console.error('Groq API error:', err.response.status, err.response.data);
      return res.status(502).json({
        error: isSw
          ? 'Huduma ya mshauri wa AI imerudisha hitilafu. Tafadhali jaribu tena.'
          : 'AI consultant service returned an error. Please try again.'
      });
    }
    console.error('Consultant route error:', err.message);
    return res.status(500).json({
      error: isSw
        ? 'Mshauri wa AI haupatikani kwa sasa.'
        : 'AI consultant is temporarily unavailable.'
    });
  }
});

module.exports = router;
