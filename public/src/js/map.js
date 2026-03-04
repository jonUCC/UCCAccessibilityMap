'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialise Core Rendering Matrix
  const map = L.map('map').setView([51.893, -8.492], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  let startPoint = null;
  let endPoint = null;
  let startMarker = null;
  let endMarker = null;
  let routeLayer = null;
  
  let reportingMode = false;
  let cachedReportCoordinate = null;
  let activeBlueprintLayer = null;
  let floorControlPanel = null;
  let geolocationWatcher = null;
  
  const barrierLayer = L.layerGroup().addTo(map);
  const startIcon = L.divIcon({ className: 'start-marker', iconSize: [16, 16] });
  const endIcon = L.divIcon({ className: 'end-marker', iconSize: [16, 16] });

  // 2. The Haptic Proximity Engine (Neuro-Inclusive Hardware Integration)
  function initiateHapticMatrix(activeBarriers) {
      if (!('vibrate' in navigator) || !('geolocation' in navigator)) return;
      
      if (geolocationWatcher) navigator.geolocation.clearWatch(geolocationWatcher);
      
      geolocationWatcher = navigator.geolocation.watchPosition((position) => {
          if (typeof turf === 'undefined') return;
          
          const userVector = turf.point([position.coords.longitude, position.coords.latitude]);
          
          activeBarriers.forEach(obstacle => {
              const hazardVector = turf.point([obstacle.lng, obstacle.lat]);
              const proximityMetres = turf.distance(userVector, hazardVector, {units: 'meters'}) * 1000;
              
              if (proximityMetres <= 2) {
                  window.navigator.vibrate([500, 200, 500]); // Sustained critical warning
              } else if (proximityMetres <= 5) {
                  window.navigator.vibrate([100, 100, 100, 100]); // Rapid proximity alert
              } else if (proximityMetres <= 15) {
                  window.navigator.vibrate([200]); // Singular soft pulse
              }
          });
      }, (error) => {
          console.warn("Hardware telemetry offline. Haptics disabled.");
      }, { enableHighAccuracy: true, maximumAge: 10000 });
  }

  // 3. Backend State Synchronisation (Port 3000)
  async function loadDatabaseBarriers() {
    barrierLayer.clearLayers();
    try {
      const response = await fetch('http://localhost:3000/api/barriers');
      if (!response.ok) return;
      
      const barriers = await response.json();
      barriers.forEach(record => {
        let popupHtml = `<b>${record.barrier_type}</b><br>Severity: ${record.severity}<br>Status: ${record.status}`;
        if (record.image_path) {
            popupHtml += `<br><img src="http://localhost:3000${record.image_path}" style="width: 150px; margin-top: 10px; border-radius: 4px;">`;
        }
        L.marker([record.lat, record.lng]).bindPopup(popupHtml).addTo(barrierLayer);
      });

      initiateHapticMatrix(barriers);

    } catch (error) {
      console.warn("Persistent state machine offline. Verify Node server on port 3000.");
    }
  }

  loadDatabaseBarriers();

  // 4. Architectural Stratification Logic (Indoor Mapping)
  async function ingestArchitecturalGeometry() {
      try {
          const rawResponse = await fetch('/assets/buildings.geojson');
          if (!rawResponse.ok) return;
          const spatialData = await rawResponse.json();

          L.geoJSON(spatialData, {
              style: {
                  color: '#263238',
                  weight: 3,
                  fillColor: '#2196f3',
                  fillOpacity: 0.15,
                  dashArray: '5'
              },
              onEachFeature: (feature, layer) => {
                  layer.bindTooltip(`<b>${feature.properties.name}</b><br>Click to access internal schematics.`, {
                      sticky: true,
                      className: 'architectural-tooltip'
                  });
                  
                  layer.on('click', () => triggerStratificationProtocol(feature, layer));
              }
          }).addTo(map);
      } catch (exception) {
          console.warn("Architectural geometry skipped. Proceeding with exterior routes.");
      }
  }

  function triggerStratificationProtocol(feature, layer) {
      if (activeBlueprintLayer) map.removeLayer(activeBlueprintLayer);
      if (floorControlPanel) {
          floorControlPanel.remove();
          floorControlPanel = null;
      }

      const coordinateBounds = layer.getBounds();
      const floorAssets = feature.properties.floors;
      
      if (!floorAssets || floorAssets.length === 0) return;

      activeBlueprintLayer = L.imageOverlay(floorAssets[0], coordinateBounds, { 
          opacity: 0.95, 
          zIndex: 400 
      }).addTo(map);
      
      map.flyToBounds(coordinateBounds, { padding: [20, 20], duration: 1.5 });

      constructFloorMatrix(floorAssets, coordinateBounds, feature.properties.name);
  }

  function constructFloorMatrix(floors, bounds, buildingName) {
      floorControlPanel = L.control({ position: 'topright' });

      floorControlPanel.onAdd = function () {
          const controlContainer = L.DomUtil.create('div', 'floor-matrix-panel');
          controlContainer.style.backgroundColor = 'white';
          controlContainer.style.padding = '15px';
          controlContainer.style.borderRadius = '8px';
          controlContainer.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
          controlContainer.style.borderLeft = '4px solid #263238';

          let header = document.createElement('h4');
          header.textContent = buildingName;
          header.style.margin = '0 0 10px 0';
          header.style.color = '#111';
          controlContainer.appendChild(header);

          floors.forEach((blueprintPath, index) => {
              let levelButton = document.createElement('button');
              let floorLabel = "Ground Floor";
              if (index === 1) floorLabel = "First Floor";
              if (index === 2) floorLabel = "Second Floor";
              if (index === 3) floorLabel = "Third Floor";
              if (index === 4) floorLabel = "Fourth Floor";

              levelButton.textContent = floorLabel;
              levelButton.style.display = 'block';
              levelButton.style.width = '100%';
              levelButton.style.padding = '8px';
              levelButton.style.marginBottom = '5px';
              levelButton.style.border = '1px solid #ccc';
              levelButton.style.background = index === 0 ? '#e3f2fd' : '#f8f9fa';
              levelButton.style.cursor = 'pointer';
              levelButton.style.borderRadius = '4px';

              levelButton.onclick = (event) => {
                  L.DomEvent.stopPropagation(event);
                  if (activeBlueprintLayer) map.removeLayer(activeBlueprintLayer);
                  
                  Array.from(controlContainer.getElementsByTagName('button')).forEach(btn => {
                      btn.style.background = '#f8f9fa';
                  });
                  levelButton.style.background = '#e3f2fd';

                  activeBlueprintLayer = L.imageOverlay(blueprintPath, bounds, { 
                      opacity: 0.95, 
                      zIndex: 400 
                  }).addTo(map);
              };
              
              L.DomEvent.disableClickPropagation(levelButton);
              controlContainer.appendChild(levelButton);
          });

          let exitButton = document.createElement('button');
          exitButton.textContent = 'Exit Building';
          exitButton.style.display = 'block';
          exitButton.style.width = '100%';
          exitButton.style.padding = '8px';
          exitButton.style.marginTop = '10px';
          exitButton.style.background = '#ffebee';
          exitButton.style.color = '#c62828';
          exitButton.style.border = '1px solid #ef9a9a';
          exitButton.style.cursor = 'pointer';
          exitButton.style.borderRadius = '4px';
          exitButton.style.fontWeight = 'bold';

          exitButton.onclick = (event) => {
              L.DomEvent.stopPropagation(event);
              if (activeBlueprintLayer) map.removeLayer(activeBlueprintLayer);
              floorControlPanel.remove();
              floorControlPanel = null;
              map.setZoom(16);
          };

          L.DomEvent.disableClickPropagation(exitButton);
          controlContainer.appendChild(exitButton);

          return controlContainer;
      };

      floorControlPanel.addTo(map);
  }

  ingestArchitecturalGeometry();

  // 5. User Interface Dynamics
  function updateUI() {
    const startText = document.getElementById('startCoords');
    const endText = document.getElementById('endCoords');
    const startDiv = document.getElementById('startPoint');
    const endDiv = document.getElementById('endPoint');
    const routeBtn = document.getElementById('routeBtn');

    if (startText) startText.textContent = startPoint ? `${startPoint.lat.toFixed(5)}, ${startPoint.lng.toFixed(5)}` : 'Click map to set';
    if (endText) endText.textContent = endPoint ? `${endPoint.lat.toFixed(5)}, ${endPoint.lng.toFixed(5)}` : 'Click map to set';
    if (startDiv) startDiv.classList.toggle('active', !startPoint);
    if (endDiv) endDiv.classList.toggle('active', !!startPoint && !endPoint);
    if (routeBtn) routeBtn.disabled = !(startPoint && endPoint);
  }

  function showStatus(message, type = 'loading') {
    const statusBox = document.getElementById('statusMessage');
    if (!statusBox) return;
    statusBox.textContent = message;
    statusBox.className = `status-message ${type}`;
    statusBox.style.display = 'block';
  }

  function clearStatus() {
    const statusBox = document.getElementById('statusMessage');
    if (statusBox) statusBox.style.display = 'none';
  }

  // 6. Interactive Event Listeners
  const reportButton = document.getElementById('reportBtn');
  if (reportButton) {
      reportButton.addEventListener('click', () => {
        reportingMode = true;
        showStatus('Target location. Click map to initiate report.', 'loading');
        map.getContainer().style.cursor = 'crosshair';
      });
  }

  map.on('click', async (event) => {
    const latlng = event.latlng;

    if (reportingMode) {
      reportingMode = false;
      map.getContainer().style.cursor = '';
      clearStatus();
      
      cachedReportCoordinate = latlng;
      
      const modal = document.getElementById('comprehensiveReportModal');
      const coordDisplay = document.getElementById('reportCoordinateDisplay');
      
      if (!modal) {
          alert("Diagnostic Alert: Reporting modal absent from DOM. Verify HTML injection.");
          return;
      }

      if (coordDisplay) coordDisplay.textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
      modal.style.display = "block";
      return;
    }

    if (!startPoint) {
      startPoint = latlng;
      if (startMarker) map.removeLayer(startMarker);
      startMarker = L.marker(latlng, { icon: startIcon }).addTo(map);
    } else if (!endPoint) {
      endPoint = latlng;
      if (endMarker) map.removeLayer(endMarker);
      endMarker = L.marker(latlng, { icon: endIcon }).addTo(map);
    } else {
      startPoint = latlng;
      endPoint = null;
      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);
      if (routeLayer) map.removeLayer(routeLayer);
      startMarker = L.marker(latlng, { icon: startIcon }).addTo(map);
    }
    updateUI();
  });

  const submissionForm = document.getElementById('evidenceForm');
  if (submissionForm) {
      submissionForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          
          const submitBtn = document.getElementById('submitEvidenceBtn');
          if (submitBtn) {
              submitBtn.textContent = "Transmitting Data...";
              submitBtn.disabled = true;
          }

          const formData = new FormData();
          formData.append('lat', cachedReportCoordinate.lat);
          formData.append('lng', cachedReportCoordinate.lng);
          formData.append('type', document.getElementById('barrierTypeSelect')?.value || 'Unknown');
          formData.append('severity', document.getElementById('severitySelect')?.value || 'Medium');
          formData.append('description', document.getElementById('barrierDescription')?.value || '');
          
          const photoInput = document.getElementById('barrierPhoto');
          if (photoInput && photoInput.files[0]) {
              formData.append('photo', photoInput.files[0]);
          }

          try {
              const response = await fetch('http://localhost:3000/api/barriers', { method: 'POST', body: formData });
              if (!response.ok) throw new Error('Database rejection');
              
              document.getElementById('comprehensiveReportModal').style.display = "none";
              submissionForm.reset();
              loadDatabaseBarriers(); 
              alert("Evidence successfully committed to the database.");
          } catch (error) {
              alert("Transmission failed. Verify server connection.");
          } finally {
              if (submitBtn) {
                  submitBtn.textContent = "Upload Record";
                  submitBtn.disabled = false;
              }
          }
      });
  }

  const closeEvidenceBtn = document.getElementById('closeReportModal');
  if (closeEvidenceBtn) {
      closeEvidenceBtn.addEventListener('click', () => {
          const modal = document.getElementById('comprehensiveReportModal');
          if (modal) modal.style.display = "none";
          if (submissionForm) submissionForm.reset();
      });
  }

  // 7. Sovereign Navigational Matrix (GraphHopper Port 8989)
  const routeButton = document.getElementById('routeBtn');
  if (routeButton) {
      routeButton.addEventListener('click', async () => {
        if (!startPoint || !endPoint) return;
        showStatus('Interrogating local GraphHopper matrix...', 'loading');
        
        try {
          let activeBarriers = [];
          try {
              const barrierResponse = await fetch('http://localhost:3000/api/barriers');
              if (barrierResponse.ok) activeBarriers = await barrierResponse.json();
          } catch (e) {
              console.warn("Barrier telemetry offline. Proceeding with raw terrain graph.");
          }

          // GraphHopper specific geometry extraction
          const routingUrl = `http://localhost:8989/route?point=${startPoint.lat},${startPoint.lng}&point=${endPoint.lat},${endPoint.lng}&profile=foot&points_encoded=false&elevation=true`;
          
          const response = await fetch(routingUrl);
          if (!response.ok) throw new Error("Local routing engine rejected the coordinate query");
          const data = await response.json();
          
          if (!data.paths || data.paths.length === 0) throw new Error("GraphHopper failed to identify a traversable path");

          const primaryPath = data.paths[0];
          let finalConfidenceScore = 100;

          // Delegate to teammate's scoring engine if available, otherwise utilise local heuristics
          if (typeof AccessibilityScorer !== 'undefined' && AccessibilityScorer.evaluatePath) {
              finalConfidenceScore = AccessibilityScorer.evaluatePath(primaryPath, activeBarriers);
          } else if (typeof turf !== 'undefined') {
              const routeLine = turf.lineString(primaryPath.points.coordinates);
              let hazardPenalty = 0;

              activeBarriers.forEach(obstacle => {
                  const obstaclePoint = turf.point([obstacle.lng, obstacle.lat]);
                  const proximity = turf.pointToLineDistance(obstaclePoint, routeLine, {units: 'kilometers'});
                  
                  if (proximity < 0.025) {
                      hazardPenalty += (obstacle.severity === 'High') ? 35 : (obstacle.severity === 'Low') ? 5 : 15;
                  }
              });
              finalConfidenceScore = 98 - hazardPenalty;
              if (finalConfidenceScore < 15) finalConfidenceScore = 15;
          }
          
          if (routeLayer) map.removeLayer(routeLayer);
          
          routeLayer = L.geoJSON(primaryPath.points, { 
              style: { color: finalConfidenceScore > 60 ? '#2196F3' : '#e65100', weight: 6, opacity: 0.8 } 
          }).addTo(map);
          
          map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
          
          const distEl = document.getElementById('routeDistance');
          const timeEl = document.getElementById('routeTime');
          const confEl = document.getElementById('routeConfidence');
          const infoEl = document.getElementById('routeInfo');
          
          if (distEl) distEl.textContent = (primaryPath.distance / 1000).toFixed(2) + ' km';
          if (timeEl) timeEl.textContent = Math.round(primaryPath.time / 60000) + ' min';
          
          if (confEl) {
              confEl.textContent = finalConfidenceScore + '% Verified Accessible';
              confEl.style.color = finalConfidenceScore > 60 ? '#2e7d32' : '#c62828';
          }
          
          if (infoEl) infoEl.classList.add('visible');
          
          clearStatus();
        } catch (error) {
          showStatus('GraphHopper synchronization failure.', 'error');
        }
      });
  }

  const clearButton = document.getElementById('clearBtn');
  if (clearButton) {
      clearButton.addEventListener('click', () => {
        startPoint = null; endPoint = null;
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        if (routeLayer) map.removeLayer(routeLayer);
        const infoEl = document.getElementById('routeInfo');
        if (infoEl) infoEl.classList.remove('visible');
        if (activeBlueprintLayer) map.removeLayer(activeBlueprintLayer);
        if (floorControlPanel) { floorControlPanel.remove(); floorControlPanel = null; }
        updateUI();
      });
  }

  const adminToggle = document.getElementById('adminToggleBtn');
  if (adminToggle) {
      adminToggle.addEventListener('click', async () => {
          const sidebar = document.getElementById('adminSidebar');
          const dataContainer = document.getElementById('adminDataContainer');
          
          if (!sidebar || !dataContainer) return;

          sidebar.classList.add('open');
          dataContainer.innerHTML = '<p>Establishing secure connection to database...</p>';

          try {
              const response = await fetch('http://localhost:3000/api/admin/data');
              if (!response.ok) throw new Error("Query rejected");
              const systemData = await response.json();
              
              let htmlRender = `<h3 style="color:#222; border-bottom: 2px solid #ccc; padding-bottom:5px;">Barrier Records (${systemData.barriers.length})</h3>`;
              
              if (systemData.barriers.length === 0) {
                  htmlRender += `<p>No structural issues reported.</p>`;
              } else {
                  systemData.barriers.forEach(record => {
                      htmlRender += `
                      <div class="data-card">
                          <h4>${record.barrier_type}</h4>
                          <p><strong>Severity:</strong> ${record.severity}</p>
                          <p><strong>Coordinates:</strong> ${record.lat.toFixed(4)}, ${record.lng.toFixed(4)}</p>
                          <p><strong>Details:</strong> ${record.description}</p>
                          <p><strong>Status:</strong> <span style="color:#e65100">${record.status}</span></p>
                          ${record.image_path ? `<img src="http://localhost:3000${record.image_path}" alt="Evidence" style="width:100%; border-radius:4px; margin-top:10px;">` : ''}
                      </div>`;
                  });
              }
              dataContainer.innerHTML = htmlRender;

          } catch (error) {
              dataContainer.innerHTML = `<p style="color:red;">Database access denied. Verify server process.</p>`;
          }
      });
  }

  const closeSidebarBtn = document.getElementById('closeSidebar');
  if (closeSidebarBtn) {
      closeSidebarBtn.addEventListener('click', () => {
          const sidebar = document.getElementById('adminSidebar');
          if (sidebar) sidebar.classList.remove('open');
      });
  }

  updateUI();
});