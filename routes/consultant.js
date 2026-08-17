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
// groq/compound is Groq's agentic "compound system" — it wraps a strong
// underlying model (GPT-OSS-120B / Llama 4 Scout / Llama 3.3 70B) with
// real built-in tools, including live web search (via Tavily), and can
// make multiple tool calls in a single request. Using this instead of a
// plain chat model is what lets this endpoint name *actual* nearby
// businesses instead of the model guessing from training data alone.
// Docs: https://console.groq.com/docs/compound
const GROQ_MODEL = 'groq/compound';
// Lighter/faster variant of the same agentic system — used as a fallback
// if the full compound model's request (prompt + tool-call context from
// web search) exceeds Groq's request-size cap. See the 413 handling below.
const GROQ_MODEL_FALLBACK = 'groq/compound-mini';

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
Existing similar businesses already in this area (from census/registry data): ${existing_similar_businesses_in_area}
${roi_percent ? `Predicted annual ROI: ${roi_percent}%` : ''}
${breakeven_months ? `Predicted breakeven: ${breakeven_months} months` : ''}

The prediction above was generated from historical business-registry and census data
(location, capital tier, sector saturation). It does NOT account for real-world factors
like seasonality, competitor behavior, supplier reliability, regulatory changes, weather/
rainy-season effects on foot traffic, or currency/import cost shifts.

Before answering, use your web search tool to look for REAL, currently-listed businesses
doing "${activity}" (or the closest matching category) in or near ${ward ? ward + ', ' : ''}${district},
Dar es Salaam — e.g. via Google Maps/Places listings, TripAdvisor, local directories, or
news articles that name specific operators in that area. You are looking for concrete
examples of the competition this person would actually encounter, not a generic industry
description.

${languageInstruction}

Respond in JSON only, matching this exact structure, no markdown fences, no preamble:
{
  "three_month_outlook": "2-3 sentences on what's realistic in the first 3 months, referencing BOTH the model's factors (saturation/location/capital) and at least one real-world factor the model can't see",
  "six_month_outlook": "2-3 sentences, same approach, focused on what typically changes by month 6 for this type of business in Dar es Salaam",
  "twelve_month_outlook": "2-3 sentences on the one-year picture, being honest about risks not captured in the data",
  "first_30_days": ["4-6 short, concrete, ordered first steps to actually launch this specific business in this specific location"],
  "supplier_guidance": "2-3 sentences of GENERAL guidance on what type of suppliers/wholesalers this business typically needs and where in Dar es Salaam that category of supplier is commonly found (e.g. Kariakoo for general retail goods) — do not name specific company names, since you cannot verify current, real, operating suppliers",
  "risk_factors_outside_the_model": ["3-4 short bullet points naming specific real-world risks NOT captured by location/capital/saturation data alone"],
  "real_world_competition": ["3-5 items. Each item should name a REAL business you found via web search that this person would realistically compete with in or near this area, with a short note on what makes it relevant (e.g. 'XYZ Electronics, Kariakoo — established phone-accessories retailer with strong foot traffic'). If your search genuinely turns up nothing specific and verifiable for this exact activity/area, do NOT invent a business name — instead return a SINGLE item honestly stating that no specific verifiable listings were found for this area and describing the general competitive landscape from whatever your search did surface (e.g. broader district-level trends, directory category counts, or news coverage). Never fabricate a business name, address, or rating."]
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

  // Compound systems are agentic (they run a web-search tool loop before
  // answering), which needs more headroom than a plain chat call — both
  // in tokens (search results get folded into context) and in wall-clock
  // time (search + synthesis, not just generation).
  const requestBody = {
    model: GROQ_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a precise, honest business advisor with live web search. ' +
          'Use web search to find real, currently-listed competing businesses before ' +
          'answering. Respond with valid JSON only, no markdown fences, no preamble, ' +
          'no commentary about the search itself — just the JSON object.',
      },
      { role: 'user', content: buildPrompt(req.body) },
    ],
    temperature: 0.4,
    max_tokens: 1800,
  };

  // Extracts a JSON object from the model's reply even if it ignored the
  // "no preamble" instruction and wrapped the JSON in prose or fences —
  // compound systems narrate tool use more often than plain chat models.
  function extractJson(raw) {
    if (!raw) throw new Error('empty response');
    try {
      return JSON.parse(raw);
    } catch {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) {
        try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
      }
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        return JSON.parse(raw.slice(start, end + 1));
      }
      throw new Error('no JSON object found in response');
    }
  }

  async function callGroq(withJsonMode, model = GROQ_MODEL) {
    const body = { ...requestBody, model };
    // Visibility for the exact "Request Entity Too Large" failure we've
    // seen in prod — logs the real outgoing byte size so we can tell,
    // next time it happens, whether our own prompt genuinely grew huge
    // or whether this is Groq-side (web-search tool results folded into
    // context pushing an unrelated-looking small request over the cap).
    const finalBody = withJsonMode ? { ...body, response_format: { type: 'json_object' } } : body;
    const byteSize = Buffer.byteLength(JSON.stringify(finalBody), 'utf8');
    console.log(`Groq request (model=${model}, jsonMode=${withJsonMode}): ${byteSize} bytes`);
    return axios.post(
      GROQ_URL,
      finalBody,
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 35000,
      }
    );
  }

  try {
    // groq/compound is an agentic "system", not a plain chat model —
    // some Groq compound versions reject response_format alongside
    // built-in tool use. Try the stricter JSON mode first, and fall
    // back to prompt-only JSON (parsed defensively via extractJson)
    // if the API rejects that combination.
    //
    // 413 (request_too_large) gets its own fallback: retry once against
    // groq/compound-mini, a lighter variant of the same agentic system.
    // This is the actual error we saw in prod (see Railway logs,
    // 2026-08-09) — our own prompt is short, so the size almost
    // certainly comes from compound's built-in web-search tool folding
    // a large fetched page into context before answering. compound-mini
    // is more likely to stay under the cap for the same query.
    let response;
    try {
      response = await callGroq(true);
    } catch (jsonModeErr) {
      if (jsonModeErr.response?.status === 413) {
        console.warn('Groq 413 on groq/compound — retrying with groq/compound-mini');
        try {
          response = await callGroq(true, GROQ_MODEL_FALLBACK);
        } catch (miniErr) {
          if (miniErr.response?.status === 400) {
            response = await callGroq(false, GROQ_MODEL_FALLBACK);
          } else {
            throw miniErr;
          }
        }
      } else if (jsonModeErr.response?.status === 400) {
        response = await callGroq(false);
      } else {
        throw jsonModeErr;
      }
    }

    const raw = response.data?.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = extractJson(raw);
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
        ? 'Mshauri wa AI (pamoja na utafutaji wa mtandaoni kwa ushindani halisi — bado hakiki kabla ya kutegemea)'
        : 'AI consultant, with live web search for real competitors — cross-check specifics before relying on them',
    });

  } catch (err) {
    if (err.response) {
      console.error(
        'Groq API error:', err.response.status, err.response.data,
        err.response.status === 413
          ? '(413 persisted even after the compound-mini fallback — genuinely too large, not just a compound-vs-mini difference)'
          : ''
      );
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