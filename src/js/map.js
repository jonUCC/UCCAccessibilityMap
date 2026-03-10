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

  //const GH_API_KEY = '8703b873-e008-40e2-91b6-16231da438f2'

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
  let pendingBarrierLatLng = null
  let barriers = []
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
  const routeDirectionsEl = document.getElementById('routeDirections')
  const directionsListEl = document.getElementById('directionsList')

  const statusEl = document.getElementById('statusMessage')
  const routeInfoEl = document.getElementById('routeInfo')
  const routeDistanceEl = document.getElementById('routeDistance')
  const routeTimeEl = document.getElementById('routeTime')
  const routeAccessibilityEl = document.getElementById('routeAccessibility')
  const routeWarningsEl = document.getElementById('routeWarnings')
  const feedbackPanel = document.getElementById('feedbackPanel')

  // Barrier modal elements
  const barrierModal = document.getElementById('barrierModal')
  const closeBarrierModalBtn = document.getElementById('closeBarrierModal')
  const barrierForm = document.getElementById('barrierForm')
  const reportCoordinateDisplay = document.getElementById('reportCoordinateDisplay')
  const barrierTypeSelect = document.getElementById('barrierTypeSelect')
  const severitySelect = document.getElementById('severitySelect')
  const barrierPhotoInput = document.getElementById('barrierPhoto')
  const barrierDescriptionInput = document.getElementById('barrierDescription')

  // Feedback form elements
  const feedbackForm = document.getElementById('feedbackForm')
  const feedbackNameInput = document.getElementById('feedbackName')
  const feedbackRatingInput = document.getElementById('feedbackRating')
  const feedbackCommentInput = document.getElementById('feedbackComment')

  // Routing mode state
  let routeMode = 'map' // 'map' | 'building'

  // Building index: code -> { code, name, latlng, layer }
  const buildingsByCode = new Map()

  // Building mode UI
  const buildingModeControls = document.getElementById('buildingModeControls')
  const startBuildingSelect = document.getElementById('startBuilding')
  const endBuildingSelect = document.getElementById('endBuilding')
  const swapBuildingsBtn = document.getElementById('swapBuildings')

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

  function showDirections(instructions) {
    if (!routeDirectionsEl || !directionsListEl) return

    if (!Array.isArray(instructions) || instructions.length === 0) {
      directionsListEl.innerHTML = '<p>No directions available.</p>'
      routeDirectionsEl.style.display = 'block'
      return
    }

    const html = instructions.map((step, index) => {
      const text = step.text || 'Continue'
      const distance = typeof step.distance === 'number'
        ? formatDistance(step.distance)
        : ''
      const time = typeof step.time === 'number'
        ? formatDuration(step.time / 1000)
        : ''

      return `
        <div class="direction-step" style="margin-bottom:10px;">
          <strong>${index + 1}. ${text}</strong><br/>
          <small>${distance}${distance && time ? ' • ' : ''}${time}</small>
        </div>
      `
    }).join('')

    directionsListEl.innerHTML = html
    routeDirectionsEl.style.display = 'block'
  }

  function clearStatus() {
    if (!statusEl) return
    statusEl.textContent = ''
    statusEl.className = 'status-message'
  }

  function openBarrierModal(latlng) {
    pendingBarrierLatLng = latlng

    if (reportCoordinateDisplay) {
      reportCoordinateDisplay.textContent =
        `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`
    }

    if (barrierForm) barrierForm.reset()
    if (barrierModal) barrierModal.style.display = 'block'
  }

  function closeBarrierModal() {
    pendingBarrierLatLng = null
    if (barrierModal) barrierModal.style.display = 'none'
  }

  async function loadReportedBarriers() {
    try {
      const res = await fetch('/api/barriers')
      if (!res.ok) throw new Error('Failed to load barriers')

      const rows = await res.json()

      barriers = rows.filter((b) => String(b.status || '').toLowerCase() !== 'resolved')

      barrierLayer.clearLayers()

      barriers.forEach((b) => {
        const popupHtml = `
          <div class="barrier-popup" data-barrier-id="${b.id}">
            <strong>${b.barrier_type}</strong><br/>
            Severity: ${b.severity}<br/>
            ${b.description ? `<div style="margin-top:6px;">${b.description}</div>` : ''}
            ${b.image_path ? `<div style="margin-top:8px;"><img src="${b.image_path}" alt="Barrier photo" style="max-width:220px; width:100%; border-radius:8px;" /></div>` : ''}
            <div style="margin-top:6px;"><small>Status: ${b.status || 'pending'}</small></div>
            <div style="margin-top:10px;">
              <button
                type="button"
                class="mark-fixed-btn btn-secondary"
                data-barrier-id="${b.id}"
              >
                Mark Fixed
              </button>
            </div>
          </div>
        `

        const marker = L.marker([Number(b.lat), Number(b.lng)])
          .addTo(barrierLayer)
          .bindPopup(popupHtml)

        marker.on('popupopen', (e) => {
          const popupEl = e.popup.getElement()
          if (!popupEl) return

          const btn = popupEl.querySelector('.mark-fixed-btn')
          if (!btn) return

          btn.addEventListener('click', async () => {
            const barrierId = btn.getAttribute('data-barrier-id')
            if (!barrierId) return

            const confirmed = window.confirm('Mark this barrier as fixed?')
            if (!confirmed) return

            try {
              await markBarrierResolved(barrierId)
              map.closePopup()
              await loadReportedBarriers()
              showStatus('Barrier marked as fixed.', 'success')
            } catch (err) {
              console.error(err)
              showStatus(err.message || 'Failed to update barrier.', 'error')
            }
          }, { once: true })
        })
      })
    } catch (err) {
      console.error('Could not load reported barriers:', err)
    }
  }

  async function submitBarrierReport() {
    if (!pendingBarrierLatLng) {
      throw new Error('No barrier coordinates selected')
    }

    const formData = new FormData()
    formData.append('lat', String(pendingBarrierLatLng.lat))
    formData.append('lng', String(pendingBarrierLatLng.lng))
    formData.append('type', barrierTypeSelect.value)
    formData.append('severity', severitySelect.value)
    formData.append('description', barrierDescriptionInput.value.trim())

    if (barrierPhotoInput && barrierPhotoInput.files && barrierPhotoInput.files[0]) {
      formData.append('photo', barrierPhotoInput.files[0])
    }

    const res = await fetch('/api/barriers', {
      method: 'POST',
      body: formData
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to submit barrier')
    }

    return res.json()
  }

    async function markBarrierResolved(barrierId) {
      const res = await fetch(`/api/barriers/${barrierId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update barrier status')
      }

      return res.json()
    }

  async function submitRouteFeedback(payload) {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to submit feedback')
    }

    return res.json()
  }

  function haversineMeters(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180
    const R = 6371000
    const lat1 = toRad(a[1]), lat2 = toRad(b[1])
    const dLat = toRad(b[1] - a[1])
    const dLng = toRad(b[0] - a[0])
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
  }

  function estimateTotalUphill(routeCoords, maxSlopeDetails) {
    if (!Array.isArray(maxSlopeDetails)) return 0

    let totalClimb = 0

    for (const [from, to, slope] of maxSlopeDetails) {
      if (slope <= 0) continue // ignore downhill

      let meters = 0
      for (let i = from; i < to && i + 1 < routeCoords.length; i++) {
        meters += haversineMeters(routeCoords[i], routeCoords[i + 1])
      }

      if (meters < 1) continue

      const climb = (slope / 100) * meters
      totalClimb += climb
    }

    return totalClimb
  }

  function worstSlopeSegment(routeCoords, maxSlopeDetails) {
    if (!Array.isArray(maxSlopeDetails)) return null

    const MIN_SEGMENT_METERS = 1
    const MAX_REASONABLE_SLOPE = 40

    let worst = null
    let worstScore = -Infinity

    for (const [from, to, slope] of maxSlopeDetails) {
      let meters = 0

      for (let i = from; i < to && i + 1 < routeCoords.length; i++) {
        meters += haversineMeters(routeCoords[i], routeCoords[i + 1])
      }

      const absSlope = Math.abs(Number(slope))

      if (!Number.isFinite(absSlope)) continue
      if (meters < MIN_SEGMENT_METERS) continue
      if (absSlope > MAX_REASONABLE_SLOPE) continue

      // Weight longer steep segments more than tiny spikes
      const score = absSlope * Math.min(meters, 10)

      if (score > worstScore) {
        worstScore = score
        worst = { slope: absSlope, meters }
      }
    }

    return worst
  }

  function applyLevelAndColor(scoring) {
    if (!scoring) return scoring
    if (scoring.score >= 80) {
      scoring.level = 'high'
      scoring.color = '#4caf50'
    } else if (scoring.score >= 50) {
      scoring.level = 'medium'
      scoring.color = '#ff9800'
    } else {
      scoring.level = 'low'
      scoring.color = '#f44336'
    }
    return scoring
  }

  function showRouteInfo(distance, duration, scoring) {
    if (!routeInfoEl) return
    if (routeDistanceEl) routeDistanceEl.textContent = formatDistance(distance)
    if (routeTimeEl) routeTimeEl.textContent = formatDuration(duration)
    if (feedbackPanel) feedbackPanel.style.display = 'block'
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
    if (feedbackPanel) {
      feedbackPanel.style.display = 'none'
    }
    if (routeDirectionsEl) {
      routeDirectionsEl.style.display = 'none'
    }
    if (directionsListEl) {
      directionsListEl.innerHTML = ''
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

  function populateBuildingSelects() {
        if (!startBuildingSelect || !endBuildingSelect) return

        const items = Array.from(buildingsByCode.values())
          .filter(b => b.code)
          .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code))

        const optionsHtml = ['<option value="">Select…</option>']
          .concat(items.map(b => `<option value="${String(b.code)}">${b.code} – ${b.name || 'Building'}</option>`))
          .join('')

        startBuildingSelect.innerHTML = optionsHtml
        endBuildingSelect.innerHTML = optionsHtml
      }

      function setPointFromBuilding(which, code) {
        const b = buildingsByCode.get(code)
        if (!b) return

        if (which === 'start') {
          startPoint = b.latlng
          if (startMarker) map.removeLayer(startMarker)
          startMarker = L.marker(b.latlng, { icon: startIcon }).addTo(map).bindPopup(`Start: ${b.code}`)
        } else {
          endPoint = b.latlng
          if (endMarker) map.removeLayer(endMarker)
          endMarker = L.marker(b.latlng, { icon: endIcon }).addTo(map).bindPopup(`End: ${b.code}`)
        }
      }

      function updateBuildingModeFromUI() {
        if (!startBuildingSelect || !endBuildingSelect) return

        const startCode = startBuildingSelect.value
        const endCode = endBuildingSelect.value

        // Clear route when changing endpoints
        if (routeLayer) map.removeLayer(routeLayer)
        routeLayer = null
        hideRouteInfo()

        // Reset points
        startPoint = null
        endPoint = null
        if (startMarker) map.removeLayer(startMarker)
        if (endMarker) map.removeLayer(endMarker)
        startMarker = null
        endMarker = null

        if (startCode) setPointFromBuilding('start', startCode)
        if (endCode) setPointFromBuilding('end', endCode)

        // If both selected, zoom to them
        if (startPoint && endPoint) {
          const bounds = L.latLngBounds([startPoint, endPoint])
          map.fitBounds(bounds, { padding: [50, 50] })
        }

        updateUI()
        clearStatus()
      }

      function setRoutingMode(nextMode) {
        routeMode = nextMode
        reportingMode = false

        if (buildingModeControls) {
          buildingModeControls.style.display = routeMode === 'building' ? 'block' : 'none'
        }

        // Clear existing route when switching modes (prevents confusion)
        if (routeLayer) map.removeLayer(routeLayer)
        routeLayer = null
        hideRouteInfo()

        // Clear markers/points so the new mode is “fresh”
        startPoint = null
        endPoint = null
        if (startMarker) map.removeLayer(startMarker)
        if (endMarker) map.removeLayer(endMarker)
        startMarker = null
        endMarker = null

        updateUI()
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

  loadReportedBarriers()

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
          // Index buildings for "Buildings" routing mode
          const code = p.building_code || p.name
          if (code) {
            const center = layer.getBounds().getCenter() // simple + effective
            buildingsByCode.set(String(code), {
              code: String(code),
              name: p.name || p['name:en'] || p.alt_name || String(code),
              latlng: center,
              layer
            })
          }

          const floors = Array.isArray(p.floors) ? p.floors : []
          const hasFloors = floors.length > 0

          // Create a token so the new tab can read floor data from localStorage
          const token = `${(p.id || p.name || 'building').toString().replace(/\s+/g, '-')}-${Date.now()}`

          // Save data for the new tab
          if (hasFloors) {
            localStorage.setItem(
              `ucc_floorplans_${token}`,
              JSON.stringify({
                name: p.name || 'Building',
                floors
              })
            )
          }

          const floorsHtml = hasFloors
            ? `<button class="btn-secondary" type="button"
                  onclick="window.open('/floorplans.html?token=${encodeURIComponent(token)}','_blank','noopener')">
                  Open floor plan in new tab
               </button>`
            : ''

          const popupHtml = `
            <h3>${p.name || 'Building'}</h3>

            ${p.opening_hours
              ? `<p><strong>Opening hours:</strong><br/>${p.opening_hours}</p>`
              : ''}

            ${p.wheelchair
              ? `<p><strong>Wheelchair Accessibility:</strong><br/>${p.wheelchair}</p>`
              : ''}

            ${floorsHtml}
          `

          layer.bindPopup(popupHtml)
        }
      }).addTo(map)
      // ✅ now that buildingsByCode is filled, update dropdowns
            populateBuildingSelects()
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

  // Routing mode toggle
  document.querySelectorAll('input[name="routeMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      setRoutingMode(e.target.value)
      if (routeMode === 'building') {
        showStatus('Select start/end buildings from the dropdowns', 'loading')
      } else {
        clearStatus()
      }
    })
  })

  // Building dropdown change handlers
  if (startBuildingSelect) startBuildingSelect.addEventListener('change', updateBuildingModeFromUI)
  if (endBuildingSelect) endBuildingSelect.addEventListener('change', updateBuildingModeFromUI)

  if (swapBuildingsBtn) {
    swapBuildingsBtn.addEventListener('click', () => {
      if (!startBuildingSelect || !endBuildingSelect) return
      const a = startBuildingSelect.value
      startBuildingSelect.value = endBuildingSelect.value
      endBuildingSelect.value = a
      updateBuildingModeFromUI()
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

  if (closeBarrierModalBtn) {
    closeBarrierModalBtn.addEventListener('click', closeBarrierModal)
  }

  if (barrierModal) {
    barrierModal.addEventListener('click', (e) => {
      if (e.target === barrierModal) closeBarrierModal()
    })
  }

  if (barrierForm) {
    barrierForm.addEventListener('submit', async (e) => {
      e.preventDefault()

      try {
        showStatus('Submitting barrier report...', 'loading')
        await submitBarrierReport()
        closeBarrierModal()
        await loadReportedBarriers()
        showStatus('Barrier report submitted successfully.', 'success')
      } catch (err) {
        console.error(err)
        showStatus(err.message || 'Failed to submit barrier report.', 'error')
      }
    })
  }

    if (feedbackForm) {
      feedbackForm.addEventListener('submit', async (e) => {
        e.preventDefault()

        try {
          await submitRouteFeedback({
            name: feedbackNameInput ? feedbackNameInput.value.trim() : '',
            rating: feedbackRatingInput ? Number(feedbackRatingInput.value) : null,
            comment: feedbackCommentInput ? feedbackCommentInput.value.trim() : ''
          })

          feedbackForm.reset()
          if (feedbackPanel) {
            showStatus('Feedback submitted. Thank you!', 'success')
            setTimeout(() => {
              if (feedbackPanel) feedbackPanel.style.display = 'none'
            }, 1500)
          }
        } catch (err) {
          console.error(err)
          showStatus(err.message || 'Failed to submit feedback.', 'error')
        }
      })
    }

  // Map click behaviour 
  map.on('click', (e) => {
    // Barrier mode takes priority
    if (reportingMode) {
      reportingMode = false
      clearStatus()
      openBarrierModal(e.latlng)
      return
    }

     // If in building mode, don't set points by clicking
      if (routeMode === 'building') {
        showStatus('Building mode: choose start/end from the dropdowns', 'loading')
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

  // Routing (LOCAL GraphHopper via Node proxy)
  const CUSTOM_MODELS = {
    'step-free': {
      distance_influence: 80,
      priority: [
        { if: 'road_class == STEPS', multiply_by: '0.05' },
        { if: 'max_slope > 6', multiply_by: '0.5' },
        { if: 'max_slope > 10', multiply_by: '0.2' }
      ]
    },
    'gentle-gradient': {
      distance_influence: 40,
      priority: [
        { if: 'road_class == STEPS', multiply_by: '0' },
        { if: 'max_slope > 8', multiply_by: '0.5' },
        { if: 'max_slope > 12', multiply_by: '0.2' }
      ]
    },
    'low-energy': {
      distance_influence: 10,
      priority: [
        { if: 'road_class == STEPS', multiply_by: '0' },
        { if: 'max_slope > 10', multiply_by: '0.4' }
      ]
    }
  }

  async function getRoute(start, end) {
    const body = {
      profile: 'foot',
      // GraphHopper expects [lon, lat]
      points: [
        [start.lng, start.lat],
        [end.lng, end.lat]
      ],
      points_encoded: false,
      locale: 'en',
      instructions: true,

      // This is how we "get slope back" in the response
      details: ['max_slope', 'average_slope'],

      // Use the active profile’s routing preferences
      custom_model: CUSTOM_MODELS[activeProfile] || CUSTOM_MODELS['step-free']
    }

    const response = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(errText || `Routing failed: ${response.status}`)
    }

    const data = await response.json()

    if (!data.paths || data.paths.length === 0) {
      throw new Error('No route found')
    }

    const path = data.paths[0]

    return {
      geometry: {
        type: 'LineString',
        coordinates: path.points.coordinates // stays [lng,lat] which matches your scorer
      },
      distance: path.distance,
      duration: path.time / 1000, // ms -> seconds
      details: path.details || {}, // slope details live here
      ascend: path.ascend,
      descend: path.descend,
      instructions: path.instructions || []
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

      // Add slope-based warning if available
      if (scoring && route.details && route.details.max_slope) {
        const worst = worstSlopeSegment(route.geometry.coordinates, route.details.max_slope)
        if (worst) {
          const roundedMeters = Math.round(worst.meters)

          const limits = activeProfile === 'step-free'
            ? { warn: 5, bad: 8 }
            : activeProfile === 'gentle-gradient'
              ? { warn: 7, bad: 11 }
              : { warn: 8, bad: 12 }

          if (roundedMeters >= 3 && worst.slope >= limits.bad) {
            let penalty = 10

            if (roundedMeters >= 5) penalty = 12
            if (roundedMeters >= 10) penalty = 14
            if (roundedMeters >= 20) penalty = 16

            if (activeProfile === 'step-free') {
              penalty += 2
            }

            scoring.score = Math.max(0, scoring.score - penalty)
            scoring.warnings.unshift({
              id: 'slope-bad',
              text: `Very steep section (~${Math.round(worst.slope)}% for ${roundedMeters}m)`,
              note: 'Route contains a steep gradient that may be difficult or unsafe for some mobility needs.',
              type: 'slope',
              severity: 'high'
            })
          } else if (roundedMeters >= 3 && worst.slope >= limits.warn) {
            let penalty = 4

            if (roundedMeters >= 5) penalty = 5
            if (roundedMeters >= 10) penalty = 6
            if (roundedMeters >= 20) penalty = 8

            scoring.score = Math.max(0, scoring.score - penalty)
            scoring.warnings.unshift({
              id: 'slope-warn',
              text: `Steep section (~${Math.round(worst.slope)}% for ${roundedMeters}m)`,
              note: 'Consider an alternative route if you need gentler slopes.',
              type: 'slope',
              severity: 'medium'
            })
          }
        }
      }

      // Add uphill climb penalty
      if (scoring && route.details && route.details.max_slope) {
        const climb = estimateTotalUphill(route.geometry.coordinates, route.details.max_slope)

        const roundedClimb = Math.round(climb)

        if (roundedClimb >= 5) {
          let penalty = 0

          if (roundedClimb >= 20) penalty = 12
          else if (roundedClimb >= 15) penalty = 10
          else if (roundedClimb >= 10) penalty = 8
          else if (roundedClimb >= 5) penalty = 4

          if (activeProfile === 'step-free') penalty = Math.round(penalty * 1.5)

          scoring.score = Math.max(0, scoring.score - penalty)

          scoring.warnings.unshift({
            id: 'uphill-total',
            text: `Significant uphill climb (~${roundedClimb}m total ascent)`,
            note: 'Route contains sustained uphill sections that may require additional effort.',
            type: 'slope',
            severity: roundedClimb >= 15 ? 'high' : 'medium'
          })
        }
      }

      scoring = applyLevelAndColor(scoring)

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
      showDirections(route.instructions)
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


      reportingMode = false
      hideRouteInfo()
      clearStatus()
      updateUI()
      // Keep persisted barriers; just clear route selection state
      loadReportedBarriers()

      map.setView(UCC_CENTER, 17)
    })
  } else {
    console.warn('clearBtn not found in HTML')
  }

  // Initialise UI
  updateUI()
})
