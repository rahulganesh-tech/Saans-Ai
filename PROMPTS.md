# 📝 Comprehensive Prompt Engineering Log (PROMPTS.md)

> **Project:** Saans AI — Winter Smog Daily Planner
> **Hackathon:** PromptWars x HackArena (Google Developer Community + Hack2Skill)
> **Challenge:** Challenge 6 — Urban Air Quality Assistant
> **Model:** Google Gemini 2.0 Flash (REST API, server-side only)
> **Tooling:** Google Antigravity Agentic Assistant

---

## 🧭 1. Executive Summary & Prompt Philosophy

Building an assistant for a family facing severe winter smog requires prompting that produces *decisions*, not a health-news summary:

1. **Structured JSON, Not Prose:** The family needs a routine, hacks, and swaps as distinct, renderable sections — not a paragraph to parse themselves. The model is instructed to return strict JSON matching an exact schema.
2. **Three Fixed Deliverables, Grounded in the Day:** The prompt enumerates exactly the three outputs the problem statement names, and requires every entry to reference the family's own stated plans — not generic "avoid outdoor exercise" advice that would fit any smoggy city.
3. **AQI-Band-Proportional Behavior:** The same prompt must behave differently for "Good" vs. "Severe" — the rules explicitly require Severe/Very Poor days to visibly minimize outdoor exposure, so the model's output tracks the actual air-quality tier rather than giving the same generic caution regardless of how bad today is.
4. **No Fabricated Health Claims:** Because this touches family health, the prompt explicitly forbids invented statistics or unexplained medical jargon — every explanation must be plain-language and actionable, and the app separately carries a visible "not medical advice" disclaimer next to the one feature (the exposure budget) that makes a numeric claim.

---

## 🏛️ 2. Production Prompt Specification (Verbatim)

Below is the exact production prompt template implemented in [`server/gemini.js`](./server/gemini.js) (`buildPrompt()`):

```text
You are a public-health-aware air quality assistant helping a family in {city} get through a day during winter smog. Today's air quality band is "{aqiBand}" (Indian CPCB scale: Good, Satisfactory, Moderate, Poor, Very Poor, Severe). Household vulnerability: {householdText}.

Today's plans, in the family's own words: "{description}"

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
7. Return ONLY the JSON object. No markdown fences, no explanation, no leading or trailing text.
```

---

## 🔄 3. Prompt Iteration & Ablation History

The prompt underwent four distinct evolutionary stages during development:

### Iteration 1: Naive Direct Prompting
- **Prompt:** `"Give me air quality tips for {city} today."`
- **Model Output:** A generic listicle of standard AQI advice ("wear a mask", "use an air purifier", "avoid outdoor exercise") with no reference to the family's actual day, the specific AQI band, or who's in the household.
- **Failure Mode:** Indistinguishable from a static public-health pamphlet — doesn't answer "what should *I* do *today*."
- **Verdict:** ❌ Complete mismatch with the problem statement's "tailored to their location and lifestyle."

### Iteration 2: Structured JSON Request, No Day-Grounding Constraint
- **Prompt Modification:** Added `"Respond in JSON with keys: routine, indoorHacks, alternatives."`
- **Model Output:** Valid JSON shape, but routine entries were still generic ("go for a walk if AQI improves") rather than referencing the family's stated plans (a specific jog, a specific market trip).
- **Failure Mode:** Structurally correct but still reads like a template, not personalized guidance.
- **Verdict:** ⚠️ Correct shape, not grounded in the actual input.

### Iteration 3: Explicit Grounding + AQI-Proportional Rule
- **Prompt Modification:** Added rule 1 (must reference specific details from the description) and rule 5 (visibly scale caution to the AQI band).
- **Model Output:** Routine entries started directly naming the family's stated activities (the jog, the school walk, the market trip) and swapping them appropriately; Severe-day outputs became noticeably more restrictive than Good-day outputs for the same described plans.
- **Verdict:** ✅ Personalized and AQI-aware.

### Iteration 4: Health-Claim Guardrail + Strict-JSON-Only Output
- **Insight:** Early outputs occasionally included specific-sounding but unverifiable claims ("reduces PM2.5 exposure by 40%") and sometimes wrapped the JSON in a markdown fence, breaking `JSON.parse()`.
- **Prompt/Logic Solution:**
  - Added rule 4's explicit ban on fabricated statistics and jargon.
  - Added rule 7: *"Return ONLY the JSON object. No markdown fences, no explanation."*
  - Backend defense-in-depth: `gemini.js` strips any leading/trailing markdown fence before `JSON.parse()`, and `isValidPlanShape()` rejects any response missing a required key, triggering the graceful fallback instead of crashing or rendering a broken plan.
- **Verdict:** 🏆 Production Standard — grounded, AQI-proportional, free of fabricated health claims, and strictly parseable.

---

## 🛡️ 4. Safety Guardrails & Hallucination Prevention

To ensure a family is never misled by a fabricated health claim or an unsafe suggestion:

1. **Server-Side Whitelisting Before the Prompt Is Ever Built:** `validate.js` restricts the AQI band to the 6 valid CPCB categories and filters household flags against a fixed allowlist, *before* any value is interpolated into the prompt — a malformed or malicious input can never corrupt the prompt structure or smuggle in an unexpected category.
2. **No Fabricated Statistics, By Rule:** rule 4 explicitly forbids invented numeric health claims — the one feature that does make a numeric claim (the exposure budget) is deliberately kept outside the AI entirely (see §5) so it can be labeled and verified, rather than trusting a model-generated number.
3. **Shape Validation on Every Response:** `isValidPlanShape()` checks the parsed response has all three required keys with non-empty arrays before it is ever sent to the browser; anything else is treated as a failure and triggers the fallback path.
4. **Bounded, Timed-Out Calls:** every Gemini call is wrapped in an `AbortController` with a 15-second timeout, so a hung upstream call can never hang the user's request.
5. **Visible "Not Medical Advice" Disclaimer:** the exposure-budget card carries a persistent, visible note: *"General guidance based on published air-quality advisories — not medical advice. If anyone has a respiratory condition, follow your doctor's guidance."*
6. **Fail-Safe Fallback, Never a Raw Error:** if the API key is missing, the call times out, the network fails, or the response fails shape validation, the server returns the same realistic sample plan used by **Try Demo** — tagged `source: "fallback"` — instead of a raw error or a blank screen.

---

## ⚖️ 5. The Original Twist: Deterministic Daily Exposure Budget (Not a Prompt)

Asking Gemini to invent a "safe outdoor minutes" number for a health-adjacent decision would mean trusting an ungrounded, unverifiable model guess for the app's single most consequential number. Instead, the twist is handled entirely outside the LLM:

```js
// public/app.js — computeExposureBudget(): a fixed lookup table by AQI band,
// halved for any household vulnerability flag, floored at a 5-minute minimum.
const EXPOSURE_BUDGET_BASE_MINUTES = {
  Good: 240, Satisfactory: 180, Moderate: 120, Poor: 60, "Very Poor": 30, Severe: 15,
};
function computeExposureBudget(aqiBand, household) { /* ... */ }
```

### Why this isn't a prompt
- **Trustworthiness:** a fixed, documented, inspectable table beats an LLM inventing a number for a family's actual health decision.
- **Explainability:** the exact rule (band → base minutes → halved if vulnerable) is visible in the README and the source, not hidden inside a model's reasoning.
- **Resilience:** works even if Gemini is down, over quota, or the user is entirely offline from the AI — the app's core decision-support value doesn't depend on every feature being an LLM call.

---

## 📊 6. Evaluation Rubric for AI Response Quality

Every prompt revision was evaluated against the criteria the hackathon's own evaluator scores:

| Metric | Target Standard | Achieved Result | Verification Method |
|---|---|:---:|---|
| **Day-Grounding** | Routine entries reference the family's actual stated plans, not generic advice | **Verified** | Manual review across multiple distinct sample descriptions |
| **AQI-Proportional Caution** | Severe/Very Poor outputs visibly more restrictive than Good/Satisfactory for the same input | **Verified** | Manual side-by-side comparison across AQI bands |
| **Structural Completeness** | All 3 required sections present with correct shape | **100%** | `isValidPlanShape()` rejects anything incomplete, triggers fallback |
| **No Fabricated Health Claims** | Zero invented statistics or unexplained jargon in output | **Enforced by rule 4** | Manual review; the one numeric claim in the app (exposure budget) is deliberately non-AI |
| **Graceful Degradation** | Never a blank screen or raw error, even on total API failure | **100%** | `test/server.test.js` — valid-input test passes with and without a configured API key |
| **Response Latency Bound** | No request can hang indefinitely | **100%** | 15s `AbortController` timeout, verified in code review |

---

## 🏆 7. Summary

Through day-grounded, AQI-proportional prompting, an explicit ban on fabricated health claims, and a deterministic (non-AI) solution for the one feature that most needed to be trustworthy and explainable, Saans AI turns "today's AQI is Severe" from a vague news alert into a concrete, personalized, numerically-manageable daily plan for one specific family — one that never shows a blank screen, never invents a health statistic, and never leaves them guessing what to actually do today.
