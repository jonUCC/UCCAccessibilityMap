'use strict'

/*
  Accessibility Scoring Engine
  ----------------------------
  Takes a GeoJSON route (LineString) and checks it against known hazards.
  Returns a score (0-100), a confidence level, and a list of warnings.
*/

const AccessibilityScorer = (() => {

  // Haversine distance in meters between two [lng, lat] points
  function haversine(coord1, coord2) {
    const toRad = (deg) => (deg * Math.PI) / 180
    const R = 6371000 // Earth radius in meters

    const lat1 = toRad(coord1[1])
    const lat2 = toRad(coord2[1])
    const dLat = toRad(coord2[1] - coord1[1])
    const dLng = toRad(coord2[0] - coord1[0])

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2)

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  // Check if any point on the route passes within `radius` meters of a hazard
  function routePassesNear(routeCoords, hazard) {
    const hazardCoord = [hazard.lng, hazard.lat] // [lng, lat] to match GeoJSON
    let minDist = Infinity

    for (const coord of routeCoords) {
      const dist = haversine(coord, hazardCoord)
      if (dist < minDist) minDist = dist
      if (dist <= hazard.radius) {
        return { hit: true, distance: dist }
      }
    }

    return { hit: false, distance: minDist }
  }

  /**
   * Score a route for a given accessibility profile.
   *
   * @param {Array} routeCoords  - GeoJSON coordinates array [[lng,lat], ...]
   * @param {string} profileId   - Key from ACCESSIBILITY_PROFILES
   * @param {Array} hazards      - ACCESSIBILITY_HAZARDS array
   * @param {Array} barriers     - User-reported barriers [{lat, lng, time}, ...]
   * @param {Object} profiles    - ACCESSIBILITY_PROFILES object
   *
   * @returns {Object} { score, level, warnings, hazardsHit }
   */
  function scoreRoute(routeCoords, profileId, hazards, barriers, profiles) {
    const profile = profiles[profileId]
    if (!profile) {
      return {
        score: -1,
        level: 'unknown',
        color: '#9e9e9e',
        warnings: [{ text: `Unknown profile: ${profileId}`, severity: 'low' }],
        hazardsHit: []
      }
    }

    let score = 100
    const warnings = []
    const hazardsHit = []

    // --- Check known hazards ---
    for (const hazard of hazards) {
      const result = routePassesNear(routeCoords, hazard)

      if (result.hit) {
        const penalty = profile.penalties[hazard.type]?.[hazard.severity] || 0

        if (penalty > 0) {
          score -= penalty
          hazardsHit.push(hazard)

          warnings.push({
            id: hazard.id,
            text: hazard.label,
            note: hazard.note,
            type: hazard.type,
            severity: hazard.severity,
            distance: Math.round(result.distance)
          })
        }
      }
    }

    // --- Check user-reported barriers ---
    // Barriers within 20m of route get a flat penalty
    const BARRIER_RADIUS = 20
    const BARRIER_PENALTY = 15

    for (const barrier of barriers) {
      const barrierAsHazard = { lat: barrier.lat, lng: barrier.lng, radius: BARRIER_RADIUS }
      const result = routePassesNear(routeCoords, barrierAsHazard)

      if (result.hit) {
        score -= BARRIER_PENALTY
        warnings.push({
          id: `barrier-${barrier.time}`,
          text: 'User-reported barrier nearby',
          note: barrier.description || 'No details provided',
          type: 'barrier',
          severity: 'medium',
          distance: Math.round(result.distance)
        })
      }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score))

    // Determine level and color
    let level, color
    if (score >= 80) {
      level = 'high'
      color = '#4caf50' // green
    } else if (score >= 50) {
      level = 'medium'
      color = '#ff9800' // orange
    } else {
      level = 'low'
      color = '#f44336' // red
    }

    // Sort warnings by severity (high first)
    const severityOrder = { high: 0, medium: 1, low: 2 }
    warnings.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2))

    return { score, level, color, warnings, hazardsHit }
  }

  // Public API
  return { scoreRoute, routePassesNear, haversine }
})()

if (typeof window !== 'undefined') {
  window.AccessibilityScorer = AccessibilityScorer
}
