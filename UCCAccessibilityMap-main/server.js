import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(WORKSPACE_ROOT, "public", "dist");
const DIST_ASSETS_DIR = path.join(DIST_DIR, "assets");
const PUBLIC_ASSETS_DIR = path.join(WORKSPACE_ROOT, "public", "assets");
const PUBLIC_UPLOADS_DIR = path.join(WORKSPACE_ROOT, "public", "uploads");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "state.json");
const GH_BASE = "http://localhost:8989";
const CAMPUS_CENTER = { lat: 51.893, lng: -8.492 };
const PROFILE_OPTIONS = [
  { id: "default-walking", name: "Default walking" },
  { id: "manual-wheelchair", name: "Manual wheelchair" },
  { id: "powered-wheelchair", name: "Powered wheelchair" },
  { id: "mobility-scooter", name: "Mobility scooter" },
  { id: "crutches", name: "Crutches" },
  { id: "blind-low-vision", name: "Blind or low vision" },
  { id: "sensory-sensitive", name: "Sensory sensitive" },
];

const POI_SEED = [
  { label: "UCC Main Campus", lat: 51.893, lng: -8.492, source: "campus" },
  { label: "Boole Library", lat: 51.8932, lng: -8.4901, source: "campus" },
  { label: "O'Rahilly Building", lat: 51.8939, lng: -8.4905, source: "campus" },
  { label: "Kane Building", lat: 51.8929, lng: -8.4940, source: "campus" },
  { label: "Aula Maxima", lat: 51.8941, lng: -8.4925, source: "campus" },
  { label: "Western Road Crossing", lat: 51.8945, lng: -8.4910, source: "campus" },
];

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_UPLOADS_DIR)) fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PUBLIC_UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname || "upload").replace(/\s+/g, "_")}`),
});
const upload = multer({ storage });

function maybeUpload(req, res, next) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) return next();
  return upload.single("photo")(req, res, next);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSeverity(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinatesInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function inferBand(absSlope, threshold = 8) {
  if (!Number.isFinite(absSlope)) return "green";
  if (absSlope >= threshold + 2) return "red";
  if (absSlope >= threshold) return "amber";
  return "green";
}

function buildRoutePayload(input = {}) {
  const profile = String(input.profile || "foot").trim().toLowerCase() || "foot";
  const explicitPoints = Array.isArray(input.points) ? input.points : null;
  let points = explicitPoints;
  if (!points || points.length < 2) {
    const startLat = toNumber(input.startLat);
    const startLon = toNumber(input.startLon);
    const endLat = toNumber(input.endLat);
    const endLon = toNumber(input.endLon);
    if ([startLat, startLon, endLat, endLon].every(Number.isFinite)) {
      points = [
        [startLon, startLat],
        [endLon, endLat],
      ];
    }
  }
  if (!points || points.length < 2) {
    throw new Error("Invalid routing payload: missing start/end points");
  }
  return {
    points,
    profile,
    points_encoded: false,
    instructions: input.instructions !== false,
    elevation: input.elevation !== false,
    alternatives: Number.isFinite(toNumber(input.alternatives)) ? Math.max(1, Math.round(toNumber(input.alternatives))) : 1,
    details: Array.isArray(input.details) && input.details.length ? input.details : ["average_slope", "max_slope"],
  };
}

async function graphhopperRoute(payload) {
  const resp = await fetch(`${GH_BASE}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.message || data?.error || `GraphHopper route failed (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

function buildSegmentsFromCoordinates(coordinates = [], thresholdPercent = 8, criticalThreshold = 10) {
  const segments = [];
  let startMeters = 0;
  let maxSlope = 0;
  let weightedSlope = 0;
  let weightedDistance = 0;
  let steepDistance = 0;
  let criticalEdgeCount = 0;
  let hasElevation = false;

  for (let i = 1; i < coordinates.length; i += 1) {
    const a = coordinates[i - 1];
    const b = coordinates[i];
    const startLng = toNumber(a?.[0]);
    const startLat = toNumber(a?.[1]);
    const endLng = toNumber(b?.[0]);
    const endLat = toNumber(b?.[1]);
    if (![startLng, startLat, endLng, endLat].every(Number.isFinite)) continue;
    const len = haversineMeters(startLat, startLng, endLat, endLng);
    if (!Number.isFinite(len) || len <= 0) continue;

    const elevA = toNumber(a?.[2], NaN);
    const elevB = toNumber(b?.[2], NaN);
    const slopeRaw = Number.isFinite(elevA) && Number.isFinite(elevB) ? ((elevB - elevA) / len) * 100 : 0;
    if (Number.isFinite(elevA) && Number.isFinite(elevB)) hasElevation = true;
    const absSlope = Math.abs(slopeRaw);
    if (absSlope >= thresholdPercent) steepDistance += len;
    if (absSlope >= criticalThreshold) criticalEdgeCount += 1;
    if (absSlope > maxSlope) maxSlope = absSlope;
    weightedSlope += absSlope * len;
    weightedDistance += len;

    const endMeters = startMeters + len;
    segments.push({
      startLat,
      startLng,
      endLat,
      endLng,
      startMeters,
      endMeters,
      lengthMeters: len,
      rawSlopePercent: slopeRaw,
      slopePercent: slopeRaw,
      absSlopePercent: absSlope,
      calibrationBiasPercent: 0,
      confidencePercent: hasElevation ? 90 : 45,
      confidenceLabel: hasElevation ? "strong" : "emerging",
      evidenceCount: hasElevation ? 1 : 0,
      maePercent: hasElevation ? 1.8 : null,
      rmsePercent: hasElevation ? 2.4 : null,
      segmentKey: `${Math.round(startMeters)}-${Math.round(endMeters)}`,
      calibrationSource: hasElevation ? "graphhopper" : "fallback",
      highConfidenceBlocked: false,
      band: inferBand(absSlope, thresholdPercent),
    });
    startMeters = endMeters;
  }

  const sustained = [];
  let current = null;
  for (const seg of segments) {
    const absSlope = Math.abs(toNumber(seg.absSlopePercent, 0));
    if (absSlope >= thresholdPercent) {
      if (!current) {
        current = {
          startMeters: seg.startMeters,
          endMeters: seg.endMeters,
          lengthMeters: seg.lengthMeters,
          maxSlopePercent: absSlope,
          weightedSlope: absSlope * seg.lengthMeters,
        };
      } else {
        current.endMeters = seg.endMeters;
        current.lengthMeters += seg.lengthMeters;
        current.maxSlopePercent = Math.max(current.maxSlopePercent, absSlope);
        current.weightedSlope += absSlope * seg.lengthMeters;
      }
    } else if (current) {
      sustained.push(current);
      current = null;
    }
  }
  if (current) sustained.push(current);

  const sustainedSections = sustained.map((s) => ({
    startMeters: s.startMeters,
    endMeters: s.endMeters,
    lengthMeters: s.lengthMeters,
    maxSlopePercent: s.maxSlopePercent,
    averageSlopePercent: s.lengthMeters > 0 ? s.weightedSlope / s.lengthMeters : s.maxSlopePercent,
  }));

  return {
    segments,
    sustainedSections,
    hasElevation,
    maxSlopePercent: maxSlope,
    averageSlopePercent: weightedDistance > 0 ? weightedSlope / weightedDistance : 0,
    steepDistanceMeters: steepDistance,
    criticalEdgeCount,
    pointCount: coordinates.length,
  };
}

function confidenceFromSeverity(severity) {
  if (severity === "high") return 0.9;
  if (severity === "low") return 0.45;
  return 0.65;
}

function distancePointToCoordsMeters(lat, lng, coords) {
  let min = Number.POSITIVE_INFINITY;
  for (const c of coords) {
    const d = haversineMeters(lat, lng, toNumber(c?.[1], lat), toNumber(c?.[0], lng));
    if (d < min) min = d;
  }
  return min;
}

function scoreAccessibleRoute(path, barriers) {
  const coords = Array.isArray(path?.points?.coordinates) ? path.points.coordinates : [];
  const maxSlopeDetails = Array.isArray(path?.details?.max_slope) ? path.details.max_slope : [];
  let maxSlope = 0;
  for (const item of maxSlopeDetails) {
    const s = Math.abs(toNumber(item?.[2], 0));
    if (s > maxSlope) maxSlope = s;
  }
  if (!maxSlope && Number.isFinite(toNumber(path?.ascend))) {
    maxSlope = clamp(toNumber(path?.ascend) / Math.max(1, toNumber(path?.distance)) * 100, 0, 20);
  }
  const activeBarriers = (Array.isArray(barriers) ? barriers : []).filter(
    (b) => String(b.status || "").toLowerCase() !== "resolved"
  );
  const nearbyBarriers = activeBarriers.filter((b) => {
    const lat = toNumber(b.lat);
    const lng = toNumber(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return distancePointToCoordsMeters(lat, lng, coords) <= 20;
  });

  const barrierPenalty = nearbyBarriers.length * 8;
  const slopePenalty = maxSlope > 8 ? (maxSlope - 8) * 2.2 : 0;
  const missingDataPenalty = coords.some((c) => !Number.isFinite(toNumber(c?.[2], NaN))) ? 8 : 0;
  const totalPenalty = barrierPenalty + slopePenalty + missingDataPenalty;
  const confidence = clamp(0.92 - nearbyBarriers.length * 0.08 - Math.max(0, maxSlope - 6) * 0.02 - missingDataPenalty * 0.01, 0.25, 0.98);

  const reasons = [];
  if (barrierPenalty > 0) reasons.push({ term: "nearby_barriers", total: Number(barrierPenalty.toFixed(2)) });
  if (slopePenalty > 0) reasons.push({ term: "max_slope_pct", total: Number(slopePenalty.toFixed(2)) });
  if (missingDataPenalty > 0) reasons.push({ term: "missing_elevation_data", total: Number(missingDataPenalty.toFixed(2)) });

  return {
    maxSlope,
    confidence,
    reasons,
    score: clamp(100 - totalPenalty, 0, 100),
  };
}

function loadBuildingPoints() {
  const points = [...POI_SEED];
  const file = path.join(PUBLIC_ASSETS_DIR, "buildings.geojson");
  if (!fs.existsSync(file)) return points;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const features = Array.isArray(raw?.features) ? raw.features : [];
    for (const feature of features) {
      const name = String(feature?.properties?.name || "").trim();
      const coords = feature?.geometry?.coordinates;
      const ring = Array.isArray(coords?.[0]) ? coords[0] : null;
      if (!name || !ring || !ring.length) continue;
      let latSum = 0;
      let lngSum = 0;
      let n = 0;
      for (const p of ring) {
        const lng = toNumber(p?.[0], NaN);
        const lat = toNumber(p?.[1], NaN);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        latSum += lat;
        lngSum += lng;
        n += 1;
      }
      if (!n) continue;
      points.push({
        label: name,
        lat: latSum / n,
        lng: lngSum / n,
        source: "building",
      });
    }
  } catch {
    // no-op: keep seed points
  }
  return points;
}

const searchablePoints = loadBuildingPoints();

function defaultState() {
  return {
    counters: {
      barrier: 0,
      feedback: 0,
      routeFeedback: 0,
      spotCheck: 0,
      gradientProfile: 0,
      predictiveFeedback: 0,
    },
    barriers: [],
    feedback: [],
    routeFeedback: [],
    spotChecks: [],
    gradientProfiles: [],
    predictiveFeedback: [],
  };
}

function readState() {
  if (!fs.existsSync(DATA_FILE)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      counters: { ...defaultState().counters, ...(parsed?.counters || {}) },
      barriers: Array.isArray(parsed?.barriers) ? parsed.barriers : [],
      feedback: Array.isArray(parsed?.feedback) ? parsed.feedback : [],
      routeFeedback: Array.isArray(parsed?.routeFeedback) ? parsed.routeFeedback : [],
      spotChecks: Array.isArray(parsed?.spotChecks) ? parsed.spotChecks : [],
      gradientProfiles: Array.isArray(parsed?.gradientProfiles) ? parsed.gradientProfiles : [],
      predictiveFeedback: Array.isArray(parsed?.predictiveFeedback) ? parsed.predictiveFeedback : [],
    };
  } catch {
    return defaultState();
  }
}

let state = readState();

function saveState() {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function nextId(counterKey) {
  const current = Number(state.counters[counterKey] || 0) + 1;
  state.counters[counterKey] = current;
  return current;
}

const sseClients = new Set();

function publishAdminEvent(type, payload = {}) {
  const message = JSON.stringify({ type, at: nowIso(), ...payload });
  for (const client of sseClients) {
    try {
      client.write(`data: ${message}\n\n`);
    } catch {
      // stale connection
    }
  }
}

function computeGradientAccuracy() {
  const checks = Array.isArray(state.spotChecks) ? state.spotChecks : [];
  const valid = checks.filter((c) => Number.isFinite(toNumber(c.measured_slope_percent)));
  if (!valid.length) {
    return {
      global: { maePercent: 0, rmsePercent: 0 },
      dataCoverageScore: 0,
      confidence: { confidencePercent: 50 },
      segments: [],
    };
  }

  const errors = valid.map((c) => {
    const measured = toNumber(c.measured_slope_percent, 0);
    const estimated = Number.isFinite(toNumber(c.estimated_segment_slope_percent))
      ? toNumber(c.estimated_segment_slope_percent, 0)
      : toNumber(c.estimated_max_slope_percent, 0);
    return Math.abs(measured - estimated);
  });
  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length);
  const coverage = clamp(valid.length * 8, 0, 100);
  const confidence = clamp(100 - mae * 8, 10, 99);

  const grouped = new Map();
  for (const check of valid) {
    const key = String(check.segment_key || "unknown");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(check);
  }
  const segments = [];
  for (const [segmentKey, list] of grouped.entries()) {
    const localErrors = list.map((c) => {
      const measured = toNumber(c.measured_slope_percent, 0);
      const estimated = Number.isFinite(toNumber(c.estimated_segment_slope_percent))
        ? toNumber(c.estimated_segment_slope_percent, 0)
        : toNumber(c.estimated_max_slope_percent, 0);
      return Math.abs(measured - estimated);
    });
    const localMae = localErrors.reduce((a, b) => a + b, 0) / localErrors.length;
    const localRmse = Math.sqrt(localErrors.reduce((a, b) => a + b * b, 0) / localErrors.length);
    segments.push({
      segmentKey,
      sampleCount: list.length,
      maePercent: localMae,
      rmsePercent: localRmse,
      confidencePercent: clamp(100 - localMae * 8, 10, 99),
      dataCoverageScore: clamp(list.length * 15, 0, 100),
    });
  }

  return {
    global: { maePercent: mae, rmsePercent: rmse },
    dataCoverageScore: coverage,
    confidence: { confidencePercent: confidence },
    segments,
  };
}

// Static hosting for the production/mobile build.
app.use("/uploads", express.static(PUBLIC_UPLOADS_DIR));
app.use("/assets", express.static(DIST_ASSETS_DIR));
app.use("/assets", express.static(PUBLIC_ASSETS_DIR));
app.use(express.static(DIST_DIR));
app.use("/src", express.static(path.join(WORKSPACE_ROOT, "src")));

// Health + GraphHopper bridge
app.get("/api/info", async (_req, res) => {
  try {
    const ghResp = await fetch(`${GH_BASE}/info`);
    const data = await ghResp.json().catch(() => ({}));
    res.status(ghResp.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "GraphHopper unreachable", detail: String(e) });
  }
});

app.get("/api/graphhopper/status", async (_req, res) => {
  try {
    const [healthResp, infoResp] = await Promise.all([
      fetch(`${GH_BASE}/health`),
      fetch(`${GH_BASE}/info`),
    ]);
    const info = await infoResp.json().catch(() => ({}));
    res.json({
      status: healthResp.ok ? "connected" : "degraded",
      connected: healthResp.ok,
      graphhopper: {
        version: info?.version || null,
        profiles: Array.isArray(info?.profiles) ? info.profiles.map((p) => p.name) : [],
      },
      checkedAt: nowIso(),
    });
  } catch (e) {
    res.status(502).json({ status: "offline", connected: false, error: "GraphHopper unreachable", detail: String(e) });
  }
});

// Fastest route (GraphHopper passthrough with normalized payload).
app.post("/api/route", async (req, res) => {
  try {
    const payload = buildRoutePayload(req.body || {});
    const data = await graphhopperRoute(payload);
    res.json(data);
  } catch (e) {
    res.status(Number(e.status) || 502).json({ error: String(e.message || "Routing failed") });
  }
});

// Accessibility profiles + route
app.get("/api/accessibility/profiles", (_req, res) => {
  res.json({ profiles: PROFILE_OPTIONS });
});

app.post("/api/accessibility/route", async (req, res) => {
  try {
    const body = req.body || {};
    const payload = buildRoutePayload({
      startLat: body.startLat,
      startLon: body.startLon,
      endLat: body.endLat,
      endLon: body.endLon,
      profile: "foot",
      alternatives: 1,
      instructions: true,
      elevation: true,
      details: ["average_slope", "max_slope"],
    });
    const gh = await graphhopperRoute(payload);
    const route = Array.isArray(gh?.paths) && gh.paths.length ? gh.paths[0] : null;
    if (!route) {
      return res.status(404).json({ status: "error", error: "No accessible route found" });
    }
    const scoring = scoreAccessibleRoute(route, state.barriers);
    const output = {
      geometry: route.points || { type: "LineString", coordinates: [] },
      total_length_m: Number(route.distance || 0),
      estimated_time_ms: Number(route.time || 0),
      total_ascent_m: Number(route.ascend || 0),
      max_slope_pct: Number(scoring.maxSlope || 0),
      confidence_score: Number(scoring.confidence || 0.5),
      explanation: {
        top_reasons: scoring.reasons,
      },
    };
    return res.json({ status: "ok", route: output });
  } catch (e) {
    return res.status(Number(e.status) || 502).json({ status: "error", error: String(e.message || "Accessibility routing failed") });
  }
});

// Barrier APIs
app.get("/api/barriers", (_req, res) => {
  res.json(state.barriers);
});

app.post("/api/barriers", maybeUpload, (req, res) => {
  const lat = toNumber(req.body?.lat);
  const lng = toNumber(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat/lng are required" });
  }
  const severity = normalizeSeverity(req.body?.severity);
  const barrier = {
    id: nextId("barrier"),
    barrier_type: String(req.body?.type || "Barrier").trim() || "Barrier",
    severity,
    description: String(req.body?.description || "").trim(),
    impacts: String(req.body?.impacts || "").trim(),
    is_temporary: String(req.body?.isTemporary || "").toLowerCase() === "true",
    temporary_hours: Number.isFinite(toNumber(req.body?.temporaryHours)) ? Math.max(0, Math.round(toNumber(req.body?.temporaryHours))) : 0,
    image_path: req.file ? `/uploads/${req.file.filename}` : null,
    lat,
    lng,
    status: "pending",
    confidence_score: confidenceFromSeverity(severity),
    created_at: nowIso(),
  };
  state.barriers.unshift(barrier);
  saveState();
  publishAdminEvent("barrier_created", { id: barrier.id });
  return res.status(201).json({ id: barrier.id, status: barrier.status });
});

app.post("/api/barriers/quick", (req, res) => {
  const lat = toNumber(req.body?.lat);
  const lng = toNumber(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat/lng are required" });
  }
  const severity = normalizeSeverity(req.body?.severity);
  const barrier = {
    id: nextId("barrier"),
    barrier_type: String(req.body?.type || "General Accessibility Issue").trim() || "General Accessibility Issue",
    severity,
    description: String(req.body?.description || "").trim(),
    impacts: String(req.body?.impacts || "").trim(),
    is_temporary: !!req.body?.isTemporary,
    temporary_hours: Number.isFinite(toNumber(req.body?.temporaryHours)) ? Math.max(0, Math.round(toNumber(req.body?.temporaryHours))) : 0,
    image_path: null,
    lat,
    lng,
    status: "pending",
    confidence_score: confidenceFromSeverity(severity),
    created_at: nowIso(),
  };
  state.barriers.unshift(barrier);
  saveState();
  publishAdminEvent("barrier_created", { id: barrier.id, quick: true });
  return res.status(201).json({ id: barrier.id, status: barrier.status });
});

app.put("/api/barriers/:id/status", (req, res) => {
  const id = Math.round(toNumber(req.params.id, NaN));
  const status = String(req.body?.status || "").trim().toLowerCase();
  const allowed = new Set(["pending", "in_review", "resolved"]);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid barrier id" });
  if (!allowed.has(status)) return res.status(400).json({ error: "Invalid status value" });
  const barrier = state.barriers.find((b) => Number(b.id) === id);
  if (!barrier) return res.status(404).json({ error: "Barrier not found" });
  barrier.status = status;
  barrier.updated_at = nowIso();
  saveState();
  publishAdminEvent("barrier_status_updated", { id, status });
  return res.json({ status: "ok", barrier });
});

// Gradient APIs
app.get("/api/gradient/source", (_req, res) => {
  res.json({ mode: "graphhopper-elevation", provider: "graphhopper", updatedAt: nowIso() });
});

app.post("/api/gradient/analyze", (req, res) => {
  const coords = Array.isArray(req.body?.coordinates) ? req.body.coordinates : [];
  const sampleMeters = Math.max(1, Math.round(toNumber(req.body?.sampleMeters, 5)));
  const criticalSampleMeters = Math.max(1, Math.round(toNumber(req.body?.criticalSampleMeters, Math.max(1, sampleMeters - 2))));
  const thresholdPercent = Math.max(1, toNumber(req.body?.thresholdPercent, 8));
  const minSustainedMeters = Math.max(1, toNumber(req.body?.minSustainedMeters, 15));

  if (coords.length < 2) {
    return res.status(400).json({ error: "At least two coordinates are required" });
  }

  const segmentsBundle = buildSegmentsFromCoordinates(coords, thresholdPercent, Math.max(thresholdPercent + 2, 10));
  const sustainedSections = segmentsBundle.sustainedSections.filter((s) => toNumber(s.lengthMeters, 0) >= minSustainedMeters);
  const dataCoverageScore = segmentsBundle.hasElevation ? 100 : 25;
  const confidencePercent = segmentsBundle.hasElevation ? 92 : 45;

  return res.json({
    sampleMeters,
    criticalSampleMeters,
    thresholdPercent,
    minSustainedMeters,
    source: segmentsBundle.hasElevation ? "graphhopper_elevation" : "geometry_fallback",
    provider: "graphhopper",
    routeSignature: String(req.body?.routeSignature || ""),
    hasElevation: segmentsBundle.hasElevation,
    maxSlopePercent: segmentsBundle.maxSlopePercent,
    averageSlopePercent: segmentsBundle.averageSlopePercent,
    steepDistanceMeters: segmentsBundle.steepDistanceMeters,
    calibrationBiasPercent: 0,
    maePercent: segmentsBundle.hasElevation ? 1.8 : null,
    rmsePercent: segmentsBundle.hasElevation ? 2.4 : null,
    dataCoverageScore,
    confidencePercent,
    confidenceLabel: confidencePercent >= 85 ? "strong" : confidencePercent >= 70 ? "stable" : "emerging",
    highConfidenceBlocked: false,
    criticalEdgeCount: segmentsBundle.criticalEdgeCount,
    sustainedSections,
    segments: segmentsBundle.segments,
    pointCount: segmentsBundle.pointCount,
  });
});

app.post("/api/gradient/profiles", (req, res) => {
  const gp = req.body?.gradientProfile || {};
  const profile = {
    id: nextId("gradientProfile"),
    profile_type: String(req.body?.profileType || "default-walking").trim().toLowerCase() || "default-walking",
    route_distance: Number(toNumber(req.body?.routeDistance, 0)),
    start_lat: Number(toNumber(req.body?.startLat, NaN)),
    start_lng: Number(toNumber(req.body?.startLng, NaN)),
    end_lat: Number(toNumber(req.body?.endLat, NaN)),
    end_lng: Number(toNumber(req.body?.endLng, NaN)),
    max_slope_percent: Number(toNumber(gp?.maxSlopePercent, 0)),
    average_slope_percent: Number(toNumber(gp?.averageSlopePercent, 0)),
    steep_distance_meters: Number(toNumber(gp?.steepDistanceMeters, 0)),
    sample_meters: Number(toNumber(gp?.sampleMeters, 5)),
    created_at: nowIso(),
  };
  state.gradientProfiles.unshift(profile);
  saveState();
  publishAdminEvent("gradient_profile_created", { id: profile.id });
  res.status(201).json({ status: "ok", id: profile.id });
});

app.post("/api/gradient/spot-checks", (req, res) => {
  const lat = toNumber(req.body?.lat);
  const lng = toNumber(req.body?.lng);
  const measured = toNumber(req.body?.measuredSlopePercent);
  if (![lat, lng, measured].every(Number.isFinite)) {
    return res.status(400).json({ error: "lat, lng and measuredSlopePercent are required" });
  }
  const spot = {
    id: nextId("spotCheck"),
    lat,
    lng,
    measured_slope_percent: measured,
    estimated_max_slope_percent: toNumber(req.body?.estimatedMaxSlopePercent, null),
    estimated_avg_slope_percent: toNumber(req.body?.estimatedAvgSlopePercent, null),
    estimated_segment_slope_percent: toNumber(req.body?.estimatedSegmentSlopePercent, null),
    segment_key: String(req.body?.segmentKey || "").trim() || null,
    segment_start_meters: toNumber(req.body?.segmentStartMeters, null),
    segment_end_meters: toNumber(req.body?.segmentEndMeters, null),
    sample_meters: toNumber(req.body?.sampleMeters, null),
    profile_type: String(req.body?.profileType || "").trim().toLowerCase() || "default-walking",
    route_signature: String(req.body?.routeSignature || "").trim() || null,
    route_distance: toNumber(req.body?.routeDistance, null),
    notes: String(req.body?.notes || "").trim(),
    created_at: nowIso(),
  };
  state.spotChecks.unshift(spot);
  saveState();
  publishAdminEvent("gradient_spot_check_created", { id: spot.id });
  res.status(201).json({ status: "ok", id: spot.id });
});

// Search + reverse geocode
app.get("/api/location-search", (req, res) => {
  const q = String(req.query?.q || "").trim().toLowerCase();
  const limit = clamp(Math.round(toNumber(req.query?.limit, 7)), 1, 20);
  if (!q) return res.json({ results: [] });

  const coord = parseCoordinatesInput(q);
  const results = [];
  if (coord) {
    results.push({
      label: `Coordinates ${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`,
      lat: coord.lat,
      lng: coord.lng,
      source: "coordinates",
    });
  }

  for (const poi of searchablePoints) {
    const label = String(poi.label || "").toLowerCase();
    if (!label.includes(q)) continue;
    results.push({
      label: poi.label,
      lat: poi.lat,
      lng: poi.lng,
      source: poi.source || "search",
    });
    if (results.length >= limit) break;
  }
  return res.json({ results: results.slice(0, limit) });
});

app.get("/api/reverse-geocode", (req, res) => {
  const lat = toNumber(req.query?.lat);
  const lng = toNumber(req.query?.lng);
  if (![lat, lng].every(Number.isFinite)) return res.status(400).json({ error: "lat/lng query params are required" });

  let nearest = null;
  for (const poi of searchablePoints) {
    const d = haversineMeters(lat, lng, toNumber(poi.lat), toNumber(poi.lng));
    if (!nearest || d < nearest.distance) nearest = { distance: d, poi };
  }
  if (nearest && nearest.distance <= 300) {
    return res.json({ label: nearest.poi.label, source: nearest.poi.source || "campus" });
  }
  const onCampus = haversineMeters(lat, lng, CAMPUS_CENTER.lat, CAMPUS_CENTER.lng) < 900;
  return res.json({ label: onCampus ? "Location on UCC Campus" : "Location near selected map area", source: "fallback" });
});

// Voice enhancement
app.post("/api/voice/enhance", (req, res) => {
  const transcript = String(req.body?.transcript || "").trim();
  if (!transcript) return res.status(400).json({ error: "transcript is required" });
  const cleaned = transcript
    .replace(/\s+/g, " ")
    .replace(/(?:\buh\b|\bum\b|\berm\b)\s*/gi, "")
    .trim();
  const normalized = cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : transcript;
  const punctuated = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  res.json({
    enhanced: punctuated,
    changed: punctuated !== transcript,
    source: "heuristic",
  });
});

// Route feedback + predictive feedback
app.post("/api/route-feedback", (req, res) => {
  const payload = req.body || {};
  const profileType = String(payload.profileType || "default-walking").trim().toLowerCase();
  const userGroup = String(payload.userGroup || "").trim().toLowerCase();
  const wasUseful = String(payload.wasUseful || "").trim().toLowerCase();
  const issueResolved = String(payload.issueResolved || "").trim().toLowerCase();
  if (!userGroup || !wasUseful || !issueResolved) {
    return res.status(400).json({ error: "userGroup, wasUseful and issueResolved are required" });
  }
  const row = {
    id: nextId("routeFeedback"),
    profile_type: profileType,
    user_group: userGroup,
    was_useful: wasUseful,
    issue_resolved: issueResolved,
    comments: String(payload.comments || "").trim(),
    route_distance: toNumber(payload.routeDistance, null),
    route_time: toNumber(payload.routeTime, null),
    created_at: nowIso(),
  };
  state.routeFeedback.unshift(row);
  saveState();
  publishAdminEvent("route_feedback_created", { id: row.id });
  res.status(201).json({ status: "ok", id: row.id });
});

app.get("/api/route-feedback/summary", (req, res) => {
  const profileType = String(req.query?.profileType || "").trim().toLowerCase();
  const userGroup = String(req.query?.userGroup || "").trim().toLowerCase();
  let rows = state.routeFeedback;
  if (profileType) rows = rows.filter((r) => String(r.profile_type || "").toLowerCase() === profileType);
  if (userGroup) rows = rows.filter((r) => String(r.user_group || "").toLowerCase() === userGroup);

  const total = rows.length;
  const usefulCount = rows.filter((r) => String(r.was_useful).startsWith("y")).length;
  const resolvedCount = rows.filter((r) => String(r.issue_resolved).startsWith("y")).length;
  const usefulRate = total ? (usefulCount / total) * 100 : 0;
  const resolvedRate = total ? (resolvedCount / total) * 100 : 0;
  const evidenceFactor = clamp(total / 20, 0, 1);
  const communityConfidence = clamp(Math.round(40 + usefulRate * 0.35 + resolvedRate * 0.2 + evidenceFactor * 20), 0, 100);

  res.json({
    totalReports: total,
    usefulRate: Number(usefulRate.toFixed(1)),
    resolvedRate: Number(resolvedRate.toFixed(1)),
    communityConfidence,
    evidenceFactor: Number(evidenceFactor.toFixed(3)),
  });
});

app.post("/api/predictive-feedback", (req, res) => {
  const payload = req.body || {};
  const row = {
    id: nextId("predictiveFeedback"),
    profile_type: String(payload.profileType || "default-walking").trim().toLowerCase(),
    actual_barrier: !!payload.actualBarrier,
    predicted_risk: toNumber(payload.predictedRisk, null),
    confidence: toNumber(payload.confidence, null),
    segment_key: String(payload.segmentKey || "").trim() || null,
    factors: payload.factors && typeof payload.factors === "object" ? payload.factors : {},
    created_at: nowIso(),
  };
  state.predictiveFeedback.unshift(row);
  saveState();
  publishAdminEvent("predictive_feedback_created", { id: row.id });
  res.status(201).json({ status: "ok", id: row.id });
});

// Admin + SSE
app.get("/api/admin/data", (_req, res) => {
  res.json({
    barriers: state.barriers,
    feedback: state.feedback,
    routeFeedback: state.routeFeedback,
    spotChecks: state.spotChecks,
    gradientProfiles: state.gradientProfiles,
    predictiveFeedback: state.predictiveFeedback,
    gradientAccuracy: computeGradientAccuracy(),
  });
});

app.get("/api/admin/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", at: nowIso() })}\n\n`);
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // connection is gone
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Optional general feedback endpoint (kept for compatibility with older UI).
app.post("/api/feedback", (req, res) => {
  const row = {
    id: nextId("feedback"),
    user_name: String(req.body?.name || "").trim() || null,
    rating: toNumber(req.body?.rating, null),
    comments: String(req.body?.comment || "").trim(),
    submitted_at: nowIso(),
  };
  state.feedback.unshift(row);
  saveState();
  publishAdminEvent("feedback_created", { id: row.id });
  res.status(201).json({ message: "Feedback received." });
});

// Keep legacy `/api/info` compatibility from prior server.
app.get("/api/legacy/info", (_req, res) => {
  res.json({ ok: true, at: nowIso() });
});

// SPA fallback for non-API routes.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexPath = path.join(DIST_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send("Frontend build missing (public/dist/index.html).");
});

const PORT = 5173;
app.listen(PORT, "localhost", () => {
  console.log(`App: http://localhost:${PORT}`);
});
