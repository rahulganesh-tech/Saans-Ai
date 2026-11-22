// Saans AI — frontend. Renders the form and results, calls POST /api/plan,
// and implements the daily exposure-budget tracker (the app's twist)
// entirely client-side with no AI call. See server/index.js for the API.

// Deterministic, non-AI daily safe-outdoor-time budget (minutes), by AQI
// band. Mirrors server/config.js's EXPOSURE_BUDGET_BASE_MINUTES so the
// budget is computable even when Gemini is completely unavailable.
const EXPOSURE_BUDGET_BASE_MINUTES = {
  Good: 240,
  Satisfactory: 180,
  Moderate: 120,
  Poor: 60,
  "Very Poor": 30,
  Severe: 15,
};
const VULNERABLE_BUDGET_MULTIPLIER = 0.5;
const MIN_BUDGET_MINUTES = 5;

// ---------- Sample / demo data (works with zero API key) ----------
const SCENARIOS = {
  priya: {
    city: "Delhi",
    aqiBand: "Severe",
    household: ["School-age children", "Elderly member"],
    description: "Kids have school in the morning, I usually jog at 7am, and we have a market trip planned for the evening.",
  },
  rohan: {
    city: "Mumbai",
    aqiBand: "Moderate",
    household: ["Asthma or respiratory condition"],
    description: "Daily office commute on two-wheeler and evening gym or outdoor walk.",
  },
  ananya: {
    city: "Bengaluru",
    aqiBand: "Satisfactory",
    household: ["Infant or toddler"],
    description: "Morning stroller walk with baby, grocery shopping on foot, evening terrace playtime.",
  },
};

const DEMO_INPUT = SCENARIOS.priya;

const AQI_ADVISORIES = {
  Good: "CPCB 0–50: Minimal impact. Safe for all outdoor activities and natural ventilation.",
  Satisfactory: "CPCB 51–100: Minor breathing discomfort for sensitive individuals on prolonged exertion.",
  Moderate: "CPCB 101–200: Breathing discomfort for children, elderly, and people with lungs or heart issues.",
  Poor: "CPCB 201–300: Breathing discomfort to most people on prolonged exposure. Limit heavy workouts.",
  "Very Poor": "CPCB 301–400: Respiratory illness risk. Keep vulnerable members indoors and close windows.",
  Severe: "CPCB 401–500: Health emergency. Affects healthy people; serious risk for vulnerable members.",
};

const DEMO_PLAN = {
  routine: [
    { time: "Early morning (6-7am)", activity: "Swap your jog for an indoor bodyweight routine or stair climbs", why: "Very Poor AQI makes outdoor exertion the single biggest exposure risk today" },
    { time: "School drop-off (7:30am)", activity: "Drive or carpool the kids instead of walking", why: "Cuts a school-age child's direct exposure during a high-pollution window" },
    { time: "Midday (12-1pm)", activity: "If anyone needs to step out briefly, this is the least-bad window", why: "Winter smog is usually least concentrated around midday" },
    { time: "Afternoon (3-5pm)", activity: "Keep kids' outdoor playtime short and shift it indoors where possible", why: "Matches today's sharply reduced safe-outdoor-time budget" },
    { time: "Evening market trip (6pm)", activity: "Combine it into one quick car trip instead of walking, and go earlier if possible", why: "Pollution typically climbs again after sunset" },
    { time: "Evening (after 7pm)", activity: "Keep windows closed and avoid any outdoor lingering", why: "Protects the elderly household member during the worst exposure window" },
  ],
  indoorHacks: [
    { hack: "Set aside one low-clutter room as a 'clean air room' with the door kept shut", benefit: "Much easier to keep genuinely low-dust than the whole house" },
    { hack: "Damp-mop floors today instead of dry-sweeping or dry-dusting", benefit: "Dry sweeping re-suspends particulate matter that's already settled" },
    { hack: "Skip incense, agarbatti, or candles indoors today", benefit: "Avoids adding indoor particulate load on top of an already bad outdoor day" },
    { hack: "Ventilate for just 10 minutes around midday, not in the morning or evening", benefit: "Midday is usually the least polluted window to exchange indoor air" },
    { hack: "Keep the elderly household member's room doors closed when cooking", benefit: "Reduces their indirect exposure to kitchen fumes layered on top of smog" },
  ],
  alternatives: [
    { insteadOf: "Morning outdoor jog", tryThis: "Indoor stretching, bodyweight circuit, or stair climbs", impact: "Removes the highest-exertion outdoor exposure from your day entirely" },
    { insteadOf: "Kids walking to school", tryThis: "Drive or carpool with windows up", impact: "Meaningfully cuts a child's direct smog exposure time during a peak window" },
    { insteadOf: "Evening market trip on foot", tryThis: "One combined car trip, timed closer to midday", impact: "Less total time breathing outdoor air during a high-pollution evening window" },
    { insteadOf: "Opening windows whenever convenient", tryThis: "One deliberate 10-minute midday ventilation window", impact: "Keeps indoor air meaningfully cleaner across the rest of the day" },
  ],
};

let currentAqiBand = "Moderate";
let currentHousehold = [];
let budgetTotal = 0;
let budgetUsed = 0;
let activityHistory = [];
let lastRenderedPlan = null;

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
}

function updateAqiAdvisory(band) {
  const adv = $("aqiAdvisory");
  if (!adv) return;
  adv.className = "aqi-advisory " + band.replace(/\s+/g, "-");
  adv.textContent = AQI_ADVISORIES[band] || "";
}

function applyScenario(key) {
  const sc = SCENARIOS[key];
  if (!sc) return;
  $("cityInput").value = sc.city;
  $("aqiSelect").value = sc.aqiBand;
  document.querySelectorAll(".chip[data-flag]").forEach((c) => {
    c.setAttribute("aria-pressed", String(sc.household.includes(c.dataset.flag)));
  });
  $("descInput").value = sc.description;
  document.querySelectorAll(".preset-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.scenario === key);
  });
  updateAqiAdvisory(sc.aqiBand);
}

/**
 * Computes today's deterministic safe-outdoor-time budget in minutes from
 * the AQI band and household vulnerability flags. Halved (and floored to a
 * 5-minute minimum) when any vulnerability flag is set.
 * @param {string} aqiBand
 * @param {string[]} household
 * @returns {number}
 */
function computeExposureBudget(aqiBand, household) {
  const base = EXPOSURE_BUDGET_BASE_MINUTES[aqiBand] ?? EXPOSURE_BUDGET_BASE_MINUTES.Moderate;
  const minutes = household.length > 0 ? base * VULNERABLE_BUDGET_MULTIPLIER : base;
  return Math.max(MIN_BUDGET_MINUTES, Math.round(minutes / 5) * 5);
}

/**
 * HTML-escapes a string before it is inserted via innerHTML. Model-sourced
 * text (routine/hacks/alternatives fields) always passes through this.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// ---------- Household chip toggles ----------
document.querySelectorAll(".chip[data-flag]").forEach((chip) => {
  chip.addEventListener("click", () => {
    const pressed = chip.getAttribute("aria-pressed") === "true";
    chip.setAttribute("aria-pressed", String(!pressed));
  });
});

function getSelectedHousehold() {
  return Array.from(document.querySelectorAll(".chip[data-flag]"))
    .filter((c) => c.getAttribute("aria-pressed") === "true")
    .map((c) => c.dataset.flag);
}

// ---------- Generate plan ----------
$("generateBtn").addEventListener("click", () => generatePlan(false));
$("demoBtn").addEventListener("click", () => generatePlan(true));

/**
 * Reads the form (or demo data), calls POST /api/plan, and renders the
 * result. On any failure (network error, non-OK response, backend-signaled
 * fallback) it renders the same sample plan used by "Try Demo" instead of
 * leaving the user with a blank screen.
 * @param {boolean} useDemo
 * @returns {Promise<void>}
 */
async function generatePlan(useDemo) {
  $("errorBox").classList.remove("show");
  $("loading").classList.add("show");
  $("emptyState").classList.add("hide");

  let aqiBand, household, description, city;

  if (useDemo) {
    ({ city, aqiBand, household, description } = DEMO_INPUT);
    $("cityInput").value = city;
    $("aqiSelect").value = aqiBand;
    document.querySelectorAll(".chip[data-flag]").forEach((c) => {
      c.setAttribute("aria-pressed", String(household.includes(c.dataset.flag)));
    });
    $("descInput").value = description;
  } else {
    city = $("cityInput").value.trim();
    aqiBand = $("aqiSelect").value;
    household = getSelectedHousehold();
    description = $("descInput").value.trim();
  }

  if (!useDemo && !description) {
    $("loading").classList.remove("show");
    $("errorBox").textContent = "Tell us a bit about today's plans first.";
    $("errorBox").classList.add("show");
    $("emptyState").classList.remove("hide");
    return;
  }

  currentAqiBand = aqiBand;
  currentHousehold = household;

  if (useDemo) {
    $("loading").classList.remove("show");
    renderPlan(DEMO_PLAN, { source: "demo" });
    return;
  }

  try {
    const resp = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, city, aqiBand, household }),
    });
    const data = await resp.json();
    $("loading").classList.remove("show");

    if (!resp.ok) {
      $("errorBox").textContent = data.error || "Something went wrong. Showing a sample plan instead.";
      $("errorBox").classList.add("show");
      renderPlan(DEMO_PLAN, { source: "fallback" });
      return;
    }

    renderPlan(data, { source: data.source || "live" });
  } catch {
    $("loading").classList.remove("show");
    $("errorBox").textContent = "Couldn't reach the server. Showing a sample plan instead.";
    $("errorBox").classList.add("show");
    renderPlan(DEMO_PLAN, { source: "fallback" });
  }
}

// ---------- Render ----------
/**
 * Renders a full plan (live, demo, or fallback) into the results panel:
 * source badge, exposure budget, routine, hacks, and alternatives.
 * @param {{routine: Array, indoorHacks: Array, alternatives: Array}} plan
 * @param {{source: "live"|"demo"|"fallback"}} meta
 */
function renderPlan(plan, { source }) {
  lastRenderedPlan = plan;
  $("results").classList.add("show");

  const badge = $("sourceBadge");
  badge.className = "badge " + source;
  badge.textContent = source === "live" ? "Live AI plan" : source === "demo" ? "Demo plan" : "Sample plan";

  budgetTotal = computeExposureBudget(currentAqiBand, currentHousehold);
  budgetUsed = 0;
  activityHistory = [];
  renderBudget();

  renderList("routineList", plan.routine, (item) => `
    <span class="item-time">${escapeHtml(item.time)}</span>
    <div class="item-title">${escapeHtml(item.activity)}</div>
    <div class="item-sub">${escapeHtml(item.why)}</div>
  `);

  renderList("hacksList", plan.indoorHacks, (item) => `
    <div class="item-title">${escapeHtml(item.hack)}</div>
    <div class="item-sub">${escapeHtml(item.benefit)}</div>
  `);

  renderList("altsList", plan.alternatives, (item) => `
    <div class="item-title">Instead of ${escapeHtml(item.insteadOf)} &rarr; ${escapeHtml(item.tryThis)}</div>
    <div class="item-sub">${escapeHtml(item.impact)}</div>
  `);
}

/**
 * Renders an array of plan items into a container, one .item-row per item.
 * @param {string} containerId
 * @param {Array<object>} items
 * @param {(item: object) => string} toHtml
 */
function renderList(containerId, items, toHtml) {
  const el = $(containerId);
  el.innerHTML = (items || [])
    .map((item) => `<div class="item-row">${toHtml(item)}</div>`)
    .join("");
}

// ---------- Exposure Budget Tracker (the twist) ----------
/**
 * Renders the current budget bar, remaining minutes, and note.
 */
function renderBudget() {
  const remaining = budgetTotal - budgetUsed;
  const pct = budgetTotal > 0 ? Math.min(100, (budgetUsed / budgetTotal) * 100) : 0;
  const over = remaining < 0;

  $("budgetRemaining").textContent = over ? "0" : String(remaining);
  $("budgetBar").style.width = pct + "%";
  $("budgetBar").classList.toggle("over", over);
  $("budgetNote").textContent = `Today's AQI (${currentAqiBand}) gives a safe-outdoor budget of ${budgetTotal} minutes${currentHousehold.length ? ", halved for household vulnerability" : ""}.`;

  const logEl = $("activityLog");
  if (logEl) {
    logEl.innerHTML = activityHistory
      .map(
        (item) => `
      <div class="log-item">
        <span>${escapeHtml(item.text)}</span>
        <span class="log-item-time">${escapeHtml(item.time)}</span>
      </div>`
      )
      .join("");
  }

  checkOverBudget(remaining);
}

/**
 * Shows or hides the rebalance box depending on whether the logged
 * activities have exceeded today's budget.
 * @param {number} remaining
 */
function checkOverBudget(remaining) {
  const box = $("rebalanceBox");
  if (remaining < 0) {
    box.classList.add("show");
    $("rebalanceText").textContent = `You're ${Math.abs(remaining)} minutes over today's safe-outdoor budget. Swap your next outdoor activity for an indoor alternative from today's hacks above.`;
  } else {
    box.classList.remove("show");
  }
}

$("logActivityBtn").addEventListener("click", () => {
  if (budgetTotal === 0) return; // no plan generated yet
  const sel = $("activitySelect");
  const minutes = Number(sel.value) || 0;
  const text = sel.options[sel.selectedIndex]?.text || `${minutes} min`;
  budgetUsed += minutes;
  activityHistory.push({
    text,
    minutes,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  renderBudget();
});

$("resetBudgetBtn").addEventListener("click", () => {
  budgetUsed = 0;
  activityHistory = [];
  renderBudget();
});

// ---------- Scenario Presets & AQI Listeners ----------
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyScenario(btn.dataset.scenario);
  });
});

$("aqiSelect").addEventListener("change", (e) => {
  updateAqiAdvisory(e.target.value);
});

// ---------- Copy & Print Plan ----------
$("copyPlanBtn")?.addEventListener("click", async () => {
  if (!lastRenderedPlan) return;
  const city = $("cityInput").value.trim() || "Your City";
  const lines = [
    `*Saans AI Daily Plan — ${city}*`,
    `Air Quality: ${currentAqiBand} | Safe Outdoor Budget: ${budgetTotal} min`,
    ``,
    `*Daily Low-Emission Routine:*`,
    ...lastRenderedPlan.routine.map((r) => `• ${r.time}: ${r.activity} (${r.why})`),
    ``,
    `*Indoor Air Quality Hacks:*`,
    ...lastRenderedPlan.indoorHacks.map((h) => `• ${h.hack} — ${h.benefit}`),
    ``,
    `*Sustainable Swaps:*`,
    ...lastRenderedPlan.alternatives.map((a) => `• Instead of ${a.insteadOf} ➔ ${a.tryThis} (${a.impact})`),
    ``,
    `_Generated by Saans AI · Powered by Google Gemini 2.0 Flash_`
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Plan copied for WhatsApp!");
  } catch {
    showToast("Plan generated above!");
  }
});

$("printPlanBtn")?.addEventListener("click", () => {
  window.print();
});

// Initial state
updateAqiAdvisory($("aqiSelect").value);
