// Input validation and sanitization for POST /api/plan. This is the single
// choke point where untrusted client input is type-checked, length-capped,
// and whitelisted before it is interpolated into the Gemini prompt or used
// to compute the deterministic exposure budget.
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_FREEFORM_LENGTH,
  MAX_HOUSEHOLD_FLAGS,
  AQI_BANDS,
  HOUSEHOLD_FLAGS,
} from "./config.js";

/**
 * Coerces a value to a trimmed string capped at maxLength. Non-strings
 * become an empty string rather than throwing, so a malformed payload can
 * never crash validation.
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function clampString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * Validates and normalizes a POST /api/plan payload.
 * @param {unknown} payload
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function validatePlanRequest(payload) {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const description = clampString(payload.description, MAX_DESCRIPTION_LENGTH);
  if (!description) {
    return { ok: false, error: "A description of today's plans is required." };
  }

  const city = clampString(payload.city, MAX_FREEFORM_LENGTH) || "your city";

  const aqiBand = AQI_BANDS.includes(payload.aqiBand) ? payload.aqiBand : "Moderate";

  let household = Array.isArray(payload.household) ? payload.household : [];
  household = household
    .filter((flag) => typeof flag === "string" && HOUSEHOLD_FLAGS.includes(flag))
    .slice(0, MAX_HOUSEHOLD_FLAGS);

  return {
    ok: true,
    data: { description, city, aqiBand, household },
  };
}
