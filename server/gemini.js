// Builds the air-quality-guidance prompt and calls the Gemini API
// server-side. The API key never leaves this module.
import {
  GEMINI_API_KEY,
  GEMINI_MODEL,
  GEMINI_TIMEOUT_MS,
  GEMINI_TEMPERATURE,
  GEMINI_ERROR_SNIPPET_LENGTH,
} from "./config.js";

/**
 * Builds the production prompt sent to Gemini for a validated plan request.
 * @param {{description: string, city: string, aqiBand: string, household: string[]}} data
 * @returns {string}
 */
export function buildPrompt({ description, city, aqiBand, household }) {
  const householdText = household.length
    ? household.join(", ")
    : "no specific vulnerability noted";

  return `You are a public-health-aware air quality assistant helping a family in ${city} get through a day during winter smog. Today's air quality band is "${aqiBand}" (Indian CPCB scale: Good, Satisfactory, Moderate, Poor, Very Poor, Severe). Household vulnerability: ${householdText}.

Today's plans, in the family's own words: "${description}"

Generate a complete response as STRICT JSON with exactly this shape (no markdown, no commentary, JSON only):

{
  "routine": [
    { "time": "<e.g. 'Morning (7-9am)'>", "activity": "<low-emission suggestion>", "why": "<short reason tied to the AQI band>" }
  ],
  "indoorHacks": [
    { "hack": "<practical indoor air-quality action>", "benefit": "<short plain-language benefit>" }
  ],
  "alternatives": [
    { "insteadOf": "<a higher-emission or higher-exposure habit>", "tryThis": "<lower-emission or lower-exposure swap>", "impact": "<short plain-language explanation of the direct impact of switching>" }
  ]
}

Rules:
1. "routine" must have 5-8 entries, ordered through a realistic day, and must reference specific details from the family's own description — not generic advice that would fit any day.
2. "indoorHacks" must have 4-6 entries, each a concrete, doable-today action (no products requiring special purchase beyond common household items).
3. "alternatives" must have 4-6 entries, each naming a real emission-contributing habit (commute choice, cooking method, errand timing, outdoor exercise timing) and a concrete lower-impact swap.
4. Every "why", "benefit", and "impact" field must be plain language a non-expert can act on immediately — no jargon, no unexplained acronyms, no fabricated statistics or numeric health claims.
5. Tailor every section to the stated AQI band: Severe/Very Poor plans should visibly minimize outdoor exposure; Good/Satisfactory plans can be lighter-touch.
6. If any household vulnerability is noted, give it extra weight in the routine and alternatives (e.g. school-age children, elderly, asthma).
7. Return ONLY the JSON object. No markdown fences, no explanation, no leading or trailing text.`;
}

/**
 * Checks that a parsed Gemini response has every required array field with
 * at least one entry. Anything that fails this is treated as a failure and
 * routed to the fallback plan, never rendered as-is.
 * @param {unknown} plan
 * @returns {boolean}
 */
export function isValidPlanShape(plan) {
  if (typeof plan !== "object" || plan === null) return false;
  const keys = ["routine", "indoorHacks", "alternatives"];
  return keys.every((k) => Array.isArray(plan[k]) && plan[k].length > 0);
}

/**
 * Strips a leading/trailing markdown code fence from a model response, if
 * present, so JSON.parse never trips on ```json ... ``` wrapping.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Calls the Gemini API with a bounded timeout and returns a validated plan.
 * Any failure (missing key, network error, timeout, invalid shape) throws,
 * so the caller can fall back to the sample plan — this function never
 * returns a partially-formed or unvalidated result.
 * @param {{description: string, city: string, aqiBand: string, household: string[]}} data
 * @returns {Promise<object>}
 */
export async function callGemini(data) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(data) }] }],
        generationConfig: { temperature: GEMINI_TEMPERATURE, responseMimeType: "application/json" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Gemini API error ${resp.status}: ${text.slice(0, GEMINI_ERROR_SNIPPET_LENGTH)}`);
    }

    const json = await resp.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("Gemini response missing text content");

    const parsed = JSON.parse(stripMarkdownFence(rawText));
    if (!isValidPlanShape(parsed)) throw new Error("Gemini response failed shape validation");

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}
