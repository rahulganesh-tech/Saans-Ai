/**
 * Shared configuration constants for Saans AI. Centralized here so every
 * limit, timeout, and tunable value has one name and one source of truth —
 * no magic numbers scattered across the codebase.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PUBLIC_DIR = path.join(__dirname, "..", "public");
export const PORT = process.env.PORT || 8080;

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_MODEL = "gemini-2.0-flash";
export const GEMINI_TIMEOUT_MS = 15000;
export const GEMINI_TEMPERATURE = 0.8;
export const GEMINI_ERROR_SNIPPET_LENGTH = 200; // chars of an error body to log, never more

export const MAX_REQUEST_BODY_BYTES = 10 * 1024; // 10KB — a plan request is small text, never more
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_FREEFORM_LENGTH = 200; // city name, etc.
export const MAX_HOUSEHOLD_FLAGS = 6;

export const STATIC_CACHE_CONTROL = "public, max-age=300";

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Official CPCB-style AQI bands, in order from best to worst air quality.
export const AQI_BANDS = ["Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"];

// Household vulnerability flags a family can select.
export const HOUSEHOLD_FLAGS = [
  "Infant or toddler",
  "School-age children",
  "Elderly member",
  "Asthma or respiratory condition",
  "Pregnant member",
];

/**
 * Deterministic, non-AI daily safe-outdoor-exposure budget (in minutes), by
 * AQI band. Modeled on the shape of published general air-quality advisories
 * (CPCB/WHO style "limit prolonged outdoor exertion" guidance) — general
 * guidance only, not medical advice, and not tied to any one pollutant
 * concentration. Halved when any vulnerability flag is selected.
 */
export const EXPOSURE_BUDGET_BASE_MINUTES = {
  Good: 240,
  Satisfactory: 180,
  Moderate: 120,
  Poor: 60,
  "Very Poor": 30,
  Severe: 15,
};
export const VULNERABLE_BUDGET_MULTIPLIER = 0.5;
export const MIN_BUDGET_MINUTES = 5;

// Shared fallback plan used when Gemini is unconfigured, timed out, or rate-limited.
export const FALLBACK_PLAN = {
  routine: [
    { time: "Morning (7-9am)", activity: "Keep windows closed; run the kitchen exhaust while cooking breakfast", why: "Indoor cooking fumes add to an already poor outdoor AQI" },
    { time: "School drop-off (8am)", activity: "Drive or carpool with windows up instead of walking", why: "Cuts direct exposure during the coldest, smoggiest part of the morning" },
    { time: "Midday (12-2pm)", activity: "If you must go out, go now — AQI is usually at its least-bad this window", why: "Winter smog is typically worst at night and early morning" },
    { time: "Afternoon (3-5pm)", activity: "Move outdoor play to an indoor activity today", why: "Matches today's reduced safe-outdoor-time budget" },
    { time: "Evening (6-8pm)", activity: "Keep windows shut as temperatures drop and smog settles", why: "Pollutant levels typically spike again after sunset" },
  ],
  indoorHacks: [
    { hack: "Keep one indoor plant-free, clutter-free room as a 'clean air room' with the door shut", benefit: "Easier to keep genuinely low-dust than the whole house" },
    { hack: "Damp-mop floors instead of dry-sweeping", benefit: "Dry sweeping re-suspends settled particulate matter" },
    { hack: "Avoid burning incense, candles, or agarbatti indoors today", benefit: "Adds to indoor particulate load on an already bad air day" },
    { hack: "Crack a single window for 10 minutes around midday only, if ventilating", benefit: "Midday is usually the least polluted window" },
  ],
  alternatives: [
    { insteadOf: "Morning jog outdoors", tryThis: "Indoor bodyweight routine or stair climbs", impact: "Avoids peak-exposure outdoor exertion that increases how much polluted air you breathe in" },
    { insteadOf: "Walking kids to school", tryThis: "Drive or carpool with windows up", impact: "Meaningfully cuts a vulnerable child's direct smog exposure time" },
    { insteadOf: "Burning leaves or waste in the yard", tryThis: "Compost or municipal waste collection", impact: "Removes a direct, local source of smoke on top of the regional smog" },
    { insteadOf: "Evening market errands on foot", tryThis: "Combine errands into one short car trip, or shift to midday", impact: "Less time breathing outdoor air during the worst pollution window" },
  ],
};
