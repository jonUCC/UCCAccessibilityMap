'use strict'

/*
  UCC Accessibility Map (Leaflet)
  - Start/End point selection by clicking map
  - Route via GraphHopper (foot profile)
  - Accessibility scoring layer (post-processes route against known hazards)
  - Report Barrier mode: click button, then click map to drop barrier marker
  - Optional buildings.geojson overlay from /assets/buildings.geojson
*/

document.addEventListener('DOMContentLoaded', () => {
  // Guard: map container must exist
  const mapEl = document.getElementById('map')
  if (!mapEl) {
    console.error('Map container not found: expected <div id="map"></div> in HTML')
    return
  }

  const GH_API_KEY = '8703b873-e008-40e2-91b6-16231da438f2'

  // Init map
  const UCC_CENTER = [51.893, -8.492]
  const map = L.map('map', { zoomControl: false }).setView(UCC_CENTER, 17)
  L.control.zoom({ position: 'topright' }).addTo(map)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map)

  // State: routing 
  let startPoint = null
  let endPoint = null
  let startMarker = null
  let endMarker = null
  let routeLayer = null
  let hazardMarkersLayer = L.layerGroup().addTo(map)

  // State: barrier reporting 
  let reportingMode = false
  const barriers = []
  const barrierLayer = L.layerGroup().addTo(map)

  // State: active profile 
  let activeProfile = 'step-free'

  // UI elements
  const startCoordsEl = document.getElementById('startCoords')
  const endCoordsEl = document.getElementById('endCoords')
  const startPointEl = document.getElementById('startPoint')
  const endPointEl = document.getElementById('endPoint')

  const reportBtn = document.getElementById('reportBtn')
  const routeBtn = document.getElementById('routeBtn')
  const clearBtn = document.getElementById('clearBtn')
  const profileSelect = document.getElementById('profileSelect')

  const statusEl = document.getElementById('statusMessage')
  const routeInfoEl = document.getElementById('routeInfo')
  const routeDistanceEl = document.getElementById('routeDistance')
  const routeTimeEl = document.getElementById('routeTime')
  const routeAccessibilityEl = document.getElementById('routeAccessibility')
  const routeWarningsEl = document.getElementById('routeWarnings')

  // Icons 
  const startIcon = L.divIcon({
    className: 'start-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })

  const endIcon = L.divIcon({
    className: 'end-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })

  // Helpers
  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`
    return `${(meters / 1000).toFixed(2)} km`
  }

  function formatDuration(seconds) {
    const mins = Math.round(seconds / 60)
    if (mins < 60) return `${mins} min`
    const hours = Math.floor(mins / 60)
    const remaining = mins % 60
    return `${hours}h ${remaining}m`
  }

  function showStatus(message, type = 'loading') {
    if (!statusEl) return
    statusEl.textContent = message
    statusEl.className = `status-message ${type}`
  }

  function clearStatus() {
    if (!statusEl) return
    statusEl.textContent = ''
    statusEl.className = 'status-message'
  }

  function showRouteInfo(distance, duration, scoring) {
    if (!routeInfoEl) return
    if (routeDistanceEl) routeDistanceEl.textContent = formatDistance(distance)
    if (routeTimeEl) routeTimeEl.textContent = formatDuration(duration)

    // Accessibility score display
    if (routeAccessibilityEl && scoring) {
      const levelLabels = { high: 'High ✓', medium: 'Medium ⚠', low: 'Low ✗' }
      routeAccessibilityEl.textContent = `${levelLabels[scoring.level] || 'Unknown'} (${scoring.score}/100)`
      routeAccessibilityEl.style.color = scoring.color
    }

    // Warnings list
    if (routeWarningsEl && scoring && scoring.warnings.length > 0) {
      const warningItems = scoring.warnings.map(w => {
        const icon = w.severity === 'high' ? '🔴' : w.severity === 'medium' ? '🟠' : '🟡'
        return `<div class="warning-item">
          <span class="warning-icon">${icon}</span>
          <div>
            <strong>${w.text}</strong>
            ${w.note ? `<br/><small>${w.note}</small>` : ''}
          </div>
        </div>`
      }).join('')

      routeWarningsEl.innerHTML = warningItems
      routeWarningsEl.style.display = 'block'
    } else if (routeWarningsEl) {
      routeWarningsEl.innerHTML = '<div class="warning-item" style="color:#4caf50">No accessibility issues detected on this route ✓</div>'
      routeWarningsEl.style.display = 'block'
    }

    routeInfoEl.classList.add('visible')
  }

  function hideRouteInfo() {
    if (!routeInfoEl) return
    routeInfoEl.classList.remove('visible')
    if (routeWarningsEl) {
      routeWarningsEl.innerHTML = ''
      routeWarningsEl.style.display = 'none'
    }
  }

  function updateUI() {
    if (startCoordsEl) {
      startCoordsEl.textContent = startPoint
        ? `${startPoint.lat.toFixed(5)}, ${startPoint.lng.toFixed(5)}`
        : 'Click map to set'
    }

    if (endCoordsEl) {
      endCoordsEl.textContent = endPoint
        ? `${endPoint.lat.toFixed(5)}, ${endPoint.lng.toFixed(5)}`
        : 'Click map to set'
    }

    if (startPointEl && endPointEl) {
      if (!startPoint) {
        startPointEl.classList.add('active')
        endPointEl.classList.remove('active')
      } else if (!endPoint) {
        startPointEl.classList.remove('active')
        endPointEl.classList.add('active')
      } else {
        startPointEl.classList.remove('active')
        endPointEl.classList.remove('active')
      }
    }

    if (routeBtn) routeBtn.disabled = !(startPoint && endPoint)
  }

  // Show known hazards on map
  function displayHazardsOnMap() {
    hazardMarkersLayer.clearLayers()

    if (!window.ACCESSIBILITY_HAZARDS) return

    const hazardIcons = {
      steps:   '🚧',
      steep:   '⛰️',
      surface: '⚠️',
      narrow:  '↔️',
      kerb:    '🚧'
    }

    const hazardColors = {
      high:   '#f44336',
      medium: '#ff9800',
      low:    '#ffc107'
    }

    for (const h of window.ACCESSIBILITY_HAZARDS) {
      // Circle showing hazard zone
      L.circle([h.lat, h.lng], {
        radius: h.radius,
        color: hazardColors[h.severity] || '#ff9800',
        fillOpacity: 0.15,
        weight: 1
      }).addTo(hazardMarkersLayer)

      // Small marker with popup
      const icon = L.divIcon({
        className: 'hazard-marker',
        html: `<span style="font-size:16px">${hazardIcons[h.type] || '⚠️'}</span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })

      L.marker([h.lat, h.lng], { icon })
        .addTo(hazardMarkersLayer)
        .bindPopup(`
          <strong>${h.label}</strong><br/>
          Type: ${h.type} | Severity: ${h.severity}<br/>
          <small>${h.note}</small>
        `)
    }
  }

  displayHazardsOnMap()

  // Optional: load buildings overlay
  async function loadBuildings() {
    try {
      const res = await fetch('/assets/buildings.geojson')
      if (!res.ok) return
      const geojson = await res.json()

      L.geoJSON(geojson, {
        style: {
          color: '#0057b8',
          weight: 2,
          fillOpacity: 0.4
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {}

          const floorsHtml = (p.floors || [])
            .map(
              (img, i) =>
                `<div>
                  <strong>Floor ${i + 1}</strong><br/>
                  <img src="${img}" style="width:200px; margin-top:4px;" />
                </div>`
            )
            .join('<hr/>')

          const popupHtml = `
            <h3>${p.name || 'Building'}</h3>
            ${p.opening_hours ? `<p><strong>Opening hours:</strong><br/>${p.opening_hours}</p>` : ''}
            ${floorsHtml}
          `

          layer.bindPopup(popupHtml)
        }
      }).addTo(map)
    } catch (e) {
      // ignore if missing or invalid
    }
  }

  loadBuildings()

  // Profile selector
  if (profileSelect) {
    profileSelect.addEventListener('change', () => {
      activeProfile = profileSelect.value
    })
  }

  // Barrier button
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      reportingMode = true
      showStatus('Click the map to place a barrier', 'loading')
      setTimeout(() => map.invalidateSize(), 100)
    })
  } else {
    console.warn('reportBtn not found in HTML')
  }

  // Map click behaviour 
  map.on('click', (e) => {
    // Barrier mode takes priority
    if (reportingMode) {
      const marker = L.marker(e.latlng).addTo(barrierLayer)
      marker.bindPopup('Barrier reported').openPopup()

      barriers.push({
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        time: Date.now(),
        description: ''
      })

      reportingMode = false
      clearStatus()
      console.log('Barriers:', barriers)
      return
    }

    // Normal routing points selection
    const latlng = e.latlng

    if (!startPoint) {
      startPoint = latlng
      if (startMarker) map.removeLayer(startMarker)
      startMarker = L.marker(latlng, { icon: startIcon }).addTo(map).bindPopup('Start point')
    } else if (!endPoint) {
      endPoint = latlng
      if (endMarker) map.removeLayer(endMarker)
      endMarker = L.marker(latlng, { icon: endIcon }).addTo(map).bindPopup('End point')
    } else {
      // both set, restart
      startPoint = latlng
      endPoint = null

      if (startMarker) map.removeLayer(startMarker)
      if (endMarker) map.removeLayer(endMarker)
      if (routeLayer) map.removeLayer(routeLayer)

      startMarker = L.marker(latlng, { icon: startIcon }).addTo(map).bindPopup('Start point')
      endMarker = null
      routeLayer = null

      hideRouteInfo()
    }

    updateUI()
    clearStatus()
  })

  // Routing (GraphHopper foot)
  async function getRoute(start, end) {
    const url = `https://graphhopper.com/api/1/route`
      + `?point=${start.lat},${start.lng}`
      + `&point=${end.lat},${end.lng}`
      + `&profile=foot`
      + `&points_encoded=false`
      + `&locale=en`
      + `&key=${GH_API_KEY}`

    const response = await fetch(url)

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.message || `Routing failed: ${response.status}`)
    }

    const data = await response.json()

    if (!data.paths || data.paths.length === 0) {
      throw new Error('No route found')
    }

    const path = data.paths[0]

    return {
      geometry: {
        type: 'LineString',
        coordinates: path.points.coordinates
      },
      distance: path.distance,
      duration: path.time / 1000  // GH returns ms → seconds
    }
  }

  async function calculateAndDisplayRoute() {
    if (!startPoint || !endPoint) return

    showStatus('Calculating route...', 'loading')

    try {
      const route = await getRoute(startPoint, endPoint)

      if (routeLayer) map.removeLayer(routeLayer)

      // Score the route
      let scoring = null
      if (window.AccessibilityScorer && window.ACCESSIBILITY_HAZARDS && window.ACCESSIBILITY_PROFILES) {
        scoring = window.AccessibilityScorer.scoreRoute(
          route.geometry.coordinates,
          activeProfile,
          window.ACCESSIBILITY_HAZARDS,
          barriers,
          window.ACCESSIBILITY_PROFILES
        )
      }

      // Color the route based on score
      const routeColor = scoring ? scoring.color : '#2196F3'

      routeLayer = L.geoJSON(route.geometry, {
        style: {
          color: routeColor,
          weight: 6,
          opacity: 0.85
        }
      }).addTo(map)

      map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] })

      showRouteInfo(route.distance, route.duration, scoring)
      clearStatus()
    } catch (error) {
      console.error('Routing error:', error)
      showStatus(`Error: ${error.message}`, 'error')
    }
  }

  if (routeBtn) {
    routeBtn.addEventListener('click', calculateAndDisplayRoute)
  } else {
    console.warn('routeBtn not found in HTML')
  }

  // Clear
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      startPoint = null
      endPoint = null

      if (startMarker) map.removeLayer(startMarker)
      if (endMarker) map.removeLayer(endMarker)
      if (routeLayer) map.removeLayer(routeLayer)

      startMarker = null
      endMarker = null
      routeLayer = null

      // Clear barriers too
      barrierLayer.clearLayers()
      barriers.length = 0

      reportingMode = false
      hideRouteInfo()
      clearStatus()
      updateUI()

      map.setView(UCC_CENTER, 17)
    })
  } else {
    console.warn('clearBtn not found in HTML')
  }

  // Initialise UI
  updateUI()
})
