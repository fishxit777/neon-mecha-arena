export const FOUNDATION_VERSION = "step0-2026-06-07";

export const FOUNDATION_DOMAINS = Object.freeze({
  director: {
    label: "battle_director",
    purpose: "Scripted tension, prompts, overtime, and final-duel moments."
  },
  pilots: {
    label: "pilot_identity",
    purpose: "Persistent player identity, MVP records, titles, and cosmetics."
  },
  events: {
    label: "battle_events",
    purpose: "Timed arena events, buffs, debuffs, supply drops, and manual triggers."
  },
  metrics: {
    label: "admin_metrics",
    purpose: "Live counts, queue health, latency, round records, and exports."
  },
  assets: {
    label: "asset_generation",
    purpose: "Winner captures, MVP copy, recap reports, and creator materials."
  }
});

export const QA_EVIDENCE_SUITES = Object.freeze([
  "director",
  "pilots",
  "events",
  "metrics",
  "assets"
]);

const DEFAULT_TIMELINE_LIMIT = 240;
const DEFAULT_DETAIL_LIMIT = 2000;

export function createFoundationState(now = Date.now()) {
  return {
    version: FOUNDATION_VERSION,
    createdAt: now,
    timelineSeq: 0,
    timeline: [],
    domains: Object.fromEntries(
      Object.entries(FOUNDATION_DOMAINS).map(([key, value]) => [
        key,
        {
          key,
          label: value.label,
          status: "planned",
          updatedAt: now
        }
      ])
    ),
    qa: createQaEvidencePlan()
  };
}

export function createQaEvidencePlan() {
  return {
    requiredSuites: [...QA_EVIDENCE_SUITES],
    outputRoot: "qa/step0",
    requiredArtifacts: [
      "node-test-output",
      "socket-flow-output",
      "admin-screenshot",
      "player-screenshot",
      "spectator-screenshot"
    ]
  };
}

export function recordTimelineEvent(foundation, payload = {}, options = {}) {
  if (!foundation || typeof foundation !== "object") {
    throw new TypeError("foundation state is required");
  }
  if (!Array.isArray(foundation.timeline)) foundation.timeline = [];
  foundation.timelineSeq = Number.isInteger(foundation.timelineSeq) ? foundation.timelineSeq + 1 : 1;

  const entry = {
    id: `evt_${String(foundation.timelineSeq).padStart(6, "0")}`,
    sequence: foundation.timelineSeq,
    at: finiteNumber(payload.at, Date.now()),
    category: safeToken(payload.category || "system"),
    action: safeToken(payload.action || "unknown"),
    sessionId: payload.sessionId || null,
    roomId: payload.roomId || null,
    round: finiteNumber(payload.round, 0),
    tick: finiteNumber(payload.tick, 0),
    actorId: payload.actorId || null,
    details: normalizeDetails(payload.details)
  };

  foundation.timeline.push(entry);
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_TIMELINE_LIMIT;
  if (foundation.timeline.length > limit) {
    foundation.timeline.splice(0, foundation.timeline.length - limit);
  }
  return entry;
}

export function serializeTimeline(foundation, limit = 20) {
  const source = Array.isArray(foundation) ? foundation : foundation?.timeline || [];
  return source.slice(-limit).map((entry) => ({
    id: entry.id,
    sequence: entry.sequence,
    at: entry.at,
    category: entry.category,
    action: entry.action,
    sessionId: entry.sessionId,
    roomId: entry.roomId,
    round: entry.round,
    tick: entry.tick,
    actorId: entry.actorId,
    details: normalizeDetails(entry.details)
  }));
}

export function updateDomainStatus(foundation, key, status, now = Date.now()) {
  if (!Object.hasOwn(FOUNDATION_DOMAINS, key)) {
    throw new RangeError(`Unknown foundation domain: ${key}`);
  }
  foundation.domains[key] = {
    ...foundation.domains[key],
    status,
    updatedAt: now
  };
  return foundation.domains[key];
}

function safeToken(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 64);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeDetails(value) {
  if (value == null) return {};
  try {
    const json = JSON.stringify(value);
    if (!json) return {};
    const trimmed = json.length > DEFAULT_DETAIL_LIMIT ? json.slice(0, DEFAULT_DETAIL_LIMIT) : json;
    return JSON.parse(trimmed);
  } catch {
    return { value: String(value).slice(0, 240) };
  }
}
