/* Generated from interactive_itinerary_map.js for the Angular editor route. */
(function () {
  window.initInteractiveItineraryEditor = function initInteractiveItineraryEditor(options = {}) {
    if (!window.L) {
      throw new Error('Leaflet did not load.');
    }
        const editorRoot = options.root || document;
        const editorApi = options.api || {};
        const createPoiAt = typeof options.createPoiAt === "function" ? options.createPoiAt : null;
        const editPoi = typeof options.editPoi === "function" ? options.editPoi : null;
        const dirtyStateChanged = typeof options.dirtyStateChanged === "function" ? options.dirtyStateChanged : null;
        const saveStatusChanged = typeof options.saveStatusChanged === "function" ? options.saveStatusChanged : null;
        const editorSessionToken = options.editorSessionToken || `editor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const poiSaveChannelName = "smartways-poi-editor-saved";
        const poiSaveChannel = "BroadcastChannel" in window ? new BroadcastChannel(poiSaveChannelName) : null;
        const initialSegmentIndex = Number.isInteger(options.initialSegmentIndex) && options.initialSegmentIndex >= 0
          ? options.initialSegmentIndex
          : null;
        const initialDraftState = options.initialDraftState || null;
        const getElementById = id => editorRoot.querySelector('#' + id) || document.getElementById(id);
        const mapElement = getElementById("mapCanvas");
        const map = L.map(mapElement, {
          zoomControl: true
        }).setView([40.4168, -3.7038], 6);
    
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
    
        let points = [];
        let markers = [];
        let segmentBufferLayer = null;
        let segmentBufferHandleLayer = null;
        let segmentBufferHandles = [];
        let segmentBufferDistances = [];
        let segmentWalkingRouteLayer = null;
        let segmentWalkingRoutes = [];
        let activeSegmentIndex = null;
        let poiLookupRequestId = 0;
        let poiLookupSegmentIndex = null;
        let poiLookupTimer = null;
        let poiCache = [];
        let displayedPois = [];
        let displayedPoiSegmentIndex = null;
        let displayedPoiMarkers = new Map();
        let poiBrowserCollapsed = true;
        let selectedPoiCategory = "";
        let pendingBufferWaypoint = null;
        let pendingBufferWaypointPopup = null;
        let suppressMapClickUntil = 0;
        let lastPoiSearchBbox = null;
        let nextMockPoiId = 1;
        const temporaryPoiLayer = window.L.markerClusterGroup
          ? L.markerClusterGroup({
            chunkedLoading: true,
            showCoverageOnHover: false,
            maxClusterRadius: 46,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 17
          }).addTo(map)
          : L.layerGroup().addTo(map);
        const temporaryPoiFootprintLayer = L.layerGroup().addTo(map);
        const DEFAULT_SEGMENT_BUFFER_METERS = 2000;
        const WALKING_SPEED_METERS_PER_SECOND = 1.333;
        const MAX_POI_CACHE_SIZE = 100;
        const routeLine = L.polyline([], {
          color: "#1f6feb",
          weight: 4,
          opacity: 0.35,
          dashArray: "6 8"
        }).addTo(map);
    
        const pointList = getElementById("pointList");
        const tabButtons = Array.from(editorRoot.querySelectorAll("[data-tab]"));
        const tabPanels = Array.from(editorRoot.querySelectorAll("[data-tab-panel]"));
        const waypointSearchInput = getElementById("waypointSearch");
        const waypointSearchResults = getElementById("waypointSearchResults");
        const poiSearchInput = getElementById("poiSearch");
        const poiSearchVisibleMapOnly = getElementById("poiSearchVisibleMapOnly");
        const refreshPoiSearch = getElementById("refreshPoiSearch");
        const poiSearchResults = getElementById("poiSearchResults");
        const poiBrowser = getElementById("poiBrowser");
        const poiBrowserTitle = getElementById("poiBrowserTitle");
        const poiBrowserFilters = getElementById("poiBrowserFilters");
        const poiBrowserList = getElementById("poiBrowserList");
        const togglePoiBrowser = getElementById("togglePoiBrowser");
        const routeDialog = getElementById("routeDialog");
        const routeDialogBody = getElementById("routeDialogBody");
        const poiDetailDialog = getElementById("poiDetailDialog");
        const poiDetailTitle = getElementById("poiDetailTitle");
        const poiDetailBody = getElementById("poiDetailBody");
        const addPoiFromDetail = getElementById("addPoiFromDetail");
        let detailedPoi = null;
        let detailedPoiSegmentIndex = null;
        let draggedPointIndex = null;
        let armedDragIndex = null;
        let searchTimer = null;
        let searchRequestId = 0;
        let savedItineraryState = null;
        let savedItineraryExport = null;
        let editingItineraryId = null;
        let itineraryMetadata = { enabled: false, language: "en", title: "", description: "" };
        let nextPoiId = 1;
        let nextPointId = 1;
        let undoStack = [];
        let redoStack = [];
        let editingLabelIndex = null;
        let lastDirtyState = null;
        const MAX_HISTORY_STATES = 100;
        function labelForIndex(index) {
          return String(index + 1);
        }
    
        function pointType(point) {
          return point && point.type === "poi" ? "poi" : "waypoint";
        }
    
        function pointIconClass(point) {
          return `${pointType(point)}-icon`;
        }
    
        function clonePlain(value) {
          return JSON.parse(JSON.stringify(value));
        }
    
        function createPoiId() {
          const id = `poi-${nextPoiId}`;
          nextPoiId += 1;
          return id;
        }
    
        function createPointId() {
          const id = `point-${nextPointId}`;
          nextPointId += 1;
          return id;
        }
    
        function normalizePoint(point) {
          if (!point.id) {
            point.id = createPointId();
          }
    
          if (pointType(point) !== "poi" || point.poiId) {
            return point;
          }
    
          point.poiId = createPoiId();
          return point;
        }
    
        function normalizePoints() {
          points.forEach(normalizePoint);
        }
    
        function makePoint(lat, lng, label = "", labelSource = label ? "manual" : "default", type = "waypoint", poiId = null, poiEnabled = null) {
          const point = { id: createPointId(), lat, lng, label, labelSource, movedSinceLabel: false, type };
    
          if (type === "poi") {
            point.poiId = poiId || createPoiId();
            if (poiEnabled !== null) {
              point.poiEnabled = Boolean(poiEnabled);
            }
          }
    
          return point;
        }
    
        function distanceBetweenPoints(first, second) {
          return map.distance([first.lat, first.lng], [second.lat, second.lng]);
        }
    
        function polylineLength(candidatePoints) {
          let length = 0;
    
          for (let index = 0; index < candidatePoints.length - 1; index += 1) {
            length += distanceBetweenPoints(candidatePoints[index], candidatePoints[index + 1]);
          }
    
          return length;
        }
    
        function bestInsertionIndexForPoint(point) {
          if (points.length < 2) {
            return points.length;
          }
    
          let bestIndex = points.length;
          let bestLength = Infinity;
    
          for (let index = 0; index <= points.length; index += 1) {
            const candidatePoints = [
              ...points.slice(0, index),
              point,
              ...points.slice(index)
            ];
            const length = polylineLength(candidatePoints);
    
            if (length < bestLength) {
              bestLength = length;
              bestIndex = index;
            }
          }
    
          return bestIndex;
        }
    
        function isValidLatLng(lat, lng) {
          return (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180
          );
        }
    
        function escapeHtml(value) {
          return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
        }
    
        function pointTitle(point, index) {
          const customLabel = point.label.trim();
          return customLabel || `Point ${labelForIndex(index)}`;
        }
    
        function placeTitle(properties) {
          return properties.name || properties.street || properties.city || properties.country || "Unnamed place";
        }
    
        function placeDetail(properties) {
          return [
            properties.street,
            properties.city || properties.county,
            properties.state,
            properties.country
          ].filter(Boolean).join(", ");
        }
    
        function formatDistance(meters) {
          if (meters < 1000) return `${Math.round(meters)} m`;
          return `${(meters / 1000).toFixed(2)} km`;
        }
    
        function formatDuration(seconds) {
          const minutes = Math.round(seconds / 60);
          if (minutes < 60) return `${minutes} min`;
    
          const hours = Math.floor(minutes / 60);
          const remainingMinutes = minutes % 60;
          return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
        }
    
        function walkingDurationSeconds(route) {
          return route.distance / WALKING_SPEED_METERS_PER_SECOND;
        }
    
        function walkingDurationForDistance(distanceMeters) {
          return distanceMeters / WALKING_SPEED_METERS_PER_SECOND;
        }
    
        function straightLineSegmentDistance(segmentIndex) {
          const start = points[segmentIndex];
          const end = points[segmentIndex + 1];
          if (!start || !end) return 0;
    
          return L.latLng(start.lat, start.lng).distanceTo([end.lat, end.lng]);
        }
    
        function setRouteStatus(message, type = "info") {
          if (type === "error") {
            console.warn(message);
          }
        }
    
        function clearSegmentBuffer() {
          if (segmentBufferLayer) {
            segmentBufferLayer.remove();
            segmentBufferLayer = null;
          }
    
          if (segmentBufferHandleLayer) {
            segmentBufferHandleLayer.remove();
            segmentBufferHandleLayer = null;
          }
          segmentBufferHandles = [];
        }
    
        function clearSegmentWalkingRouteLayer() {
          if (segmentWalkingRouteLayer) {
            segmentWalkingRouteLayer.remove();
            segmentWalkingRouteLayer = null;
          }
        }
    
        function clearTemporaryPois() {
          poiLookupRequestId += 1;
          poiLookupSegmentIndex = null;
          window.clearTimeout(poiLookupTimer);
          temporaryPoiLayer.clearLayers();
          temporaryPoiFootprintLayer.clearLayers();
          displayedPois = [];
          displayedPoiSegmentIndex = null;
          displayedPoiMarkers = new Map();
          selectedPoiCategory = "";
          renderPoiBrowser();
        }
    
        function fitSegmentView(segmentIndex) {
          const start = points[segmentIndex];
          const end = points[segmentIndex + 1];
          if (!start || !end) return;
    
          const bounds = L.latLngBounds([
            [start.lat, start.lng],
            [end.lat, end.lng]
          ]);
    
          if (activeSegmentIndex === segmentIndex && segmentBufferLayer) {
            bounds.extend(segmentBufferLayer.getBounds());
          }
    
          if (activeSegmentIndex === segmentIndex && segmentWalkingRouteLayer) {
            bounds.extend(segmentWalkingRouteLayer.getBounds());
          }
    
          map.fitBounds(bounds, { padding: [40, 40] });
        }
    
        function clearSearchResults(resultsElement = null) {
          const resultLists = resultsElement
            ? [resultsElement]
            : [waypointSearchResults, poiSearchResults];
    
          resultLists.forEach(element => {
            element.innerHTML = "";
          });
    
          if (!resultsElement || resultsElement === poiSearchResults) {
            lastPoiSearchBbox = null;
            updatePoiSearchRefreshButton();
          }
        }
    
        function renderPlaceSearchResults(features, resultsElement) {
          resultsElement.innerHTML = "";
    
          features.forEach((feature, index) => {
            const [lng, lat] = feature.geometry.coordinates;
            const title = placeTitle(feature.properties);
            const detail = placeDetail(feature.properties);
            const item = document.createElement("li");
    
            item.innerHTML = `
              <button type="button" data-action="select-search-result" data-index="${index}" data-label="${escapeHtml(title)}" data-lat="${lat}" data-lng="${lng}">
                <span class="search-result-name">${escapeHtml(title)}</span>
                ${detail ? `<span class="search-result-detail">${escapeHtml(detail)}</span>` : ""}
              </button>
            `;
            resultsElement.appendChild(item);
          });
    
          if (features.length === 0) {
            const item = document.createElement("li");
            item.innerHTML = `
              <button type="button" disabled>
                <span class="search-result-name">No results</span>
              </button>
            `;
            resultsElement.appendChild(item);
          }
        }
    
        function poiSearchDetail(poi) {
          const categories = Array.isArray(poi.categories) ? poi.categories : [];
          const categoryNames = categories
            .map(category => category.name || category.slug)
            .filter(Boolean);
          if (categoryNames.length > 0) return categoryNames.join(", ");
          return poi.description || "";
        }
    
        function renderPoiSearchResults(pois, resultsElement) {
          resultsElement.innerHTML = "";
    
          pois.forEach(poi => {
            const title = poi.title || `POI ${poi.id}`;
            const detail = poiSearchDetail(poi);
            const draftClass = poi.enabled === false ? " draft-poi" : "";
            const item = document.createElement("li");
    
            item.innerHTML = `
              <button type="button" class="${draftClass}" data-action="select-poi-search-result" data-poi-id="${escapeHtml(String(poi.id))}" data-poi-enabled="${poi.enabled === false ? "false" : "true"}" data-label="${escapeHtml(title)}" data-lat="${poi.gps_latitude}" data-lng="${poi.gps_longitude}">
                <span class="search-result-name">${escapeHtml(title)}</span>
                ${detail ? `<span class="search-result-detail">${escapeHtml(detail)}</span>` : ""}
              </button>
            `;
            resultsElement.appendChild(item);
          });
    
          if (pois.length === 0) {
            const item = document.createElement("li");
            item.innerHTML = `
              <button type="button" disabled>
                <span class="search-result-name">No POIs found</span>
              </button>
            `;
            resultsElement.appendChild(item);
          }
        }
    
        function currentMapBboxParam() {
          const bounds = map.getBounds();
          return [
            bounds.getWest().toFixed(6),
            bounds.getSouth().toFixed(6),
            bounds.getEast().toFixed(6),
            bounds.getNorth().toFixed(6)
          ].join(",");
        }
    
        function updatePoiSearchRefreshButton() {
          const query = poiSearchInput.value.trim();
          refreshPoiSearch.disabled = !poiSearchVisibleMapOnly.checked ||
            query.length < 3 ||
            !lastPoiSearchBbox ||
            currentMapBboxParam() === lastPoiSearchBbox;
        }
    
        async function searchPlaces(query, resultsElement) {
          const requestId = searchRequestId + 1;
          searchRequestId = requestId;
          const center = map.getCenter();
          try {
            const data = await editorApi.searchPlaces(query, center.lat, center.lng);
            if (requestId !== searchRequestId) return;
            renderPlaceSearchResults(Array.isArray(data.features) ? data.features : [], resultsElement);
          } catch (error) {
            if (requestId !== searchRequestId) return;
            resultsElement.innerHTML = `
              <li>
                <button type="button" disabled>
                  <span class="search-result-name">Search unavailable</span>
                  <span class="search-result-detail">${escapeHtml(error.message)}</span>
                </button>
              </li>
            `;
          }
        }
    
        async function searchPois(query, resultsElement) {
          const requestId = searchRequestId + 1;
          searchRequestId = requestId;
          let searchBbox = null;
          if (poiSearchVisibleMapOnly.checked) {
            searchBbox = currentMapBboxParam();
          }
    
          try {
            const data = await editorApi.searchPois({
              query,
              bbox: searchBbox
            });
            if (requestId !== searchRequestId) return;
            const pois = Array.isArray(data.results) ? data.results : [];
            renderPoiSearchResults(pois, resultsElement);
            lastPoiSearchBbox = searchBbox;
            updatePoiSearchRefreshButton();
          } catch (error) {
            if (requestId !== searchRequestId) return;
            resultsElement.innerHTML = `
              <li>
                <button type="button" disabled>
                  <span class="search-result-name">POI search unavailable</span>
                  <span class="search-result-detail">${escapeHtml(error.message)}</span>
                </button>
              </li>
            `;
            updatePoiSearchRefreshButton();
          }
        }
    
        function normalizeSegmentBufferDistances() {
          const segmentCount = Math.max(0, points.length - 1);
          segmentBufferDistances = segmentBufferDistances.slice(0, segmentCount);
    
          while (segmentBufferDistances.length < segmentCount) {
            segmentBufferDistances.push(DEFAULT_SEGMENT_BUFFER_METERS);
          }
        }
    
        function normalizeSegmentWalkingRoutes() {
          const segmentCount = Math.max(0, points.length - 1);
          segmentWalkingRoutes = segmentWalkingRoutes.slice(0, segmentCount);
    
          while (segmentWalkingRoutes.length < segmentCount) {
            segmentWalkingRoutes.push({ routes: [], selectedIndex: 0 });
          }
        }
    
        function clearSegmentWalkingRoutes() {
          segmentWalkingRoutes = [];
          clearSegmentWalkingRouteLayer();
        }
    
        function segmentStateKey(startPoint, endPoint) {
          return `${startPoint.id}->${endPoint.id}`;
        }
    
        function captureSegmentState() {
          normalizePoints();
          normalizeSegmentBufferDistances();
          normalizeSegmentWalkingRoutes();
    
          const stateBySegmentKey = new Map();
    
          for (let index = 0; index < points.length - 1; index += 1) {
            const key = segmentStateKey(points[index], points[index + 1]);
            stateBySegmentKey.set(key, {
              bufferDistance: segmentBufferDistances[index],
              walkingRoutes: clonePlain(segmentWalkingRoutes[index] || { routes: [], selectedIndex: 0 })
            });
          }
    
          if (activeSegmentIndex !== null && points[activeSegmentIndex] && points[activeSegmentIndex + 1]) {
            stateBySegmentKey.activeSegmentKey = segmentStateKey(points[activeSegmentIndex], points[activeSegmentIndex + 1]);
          }
    
          return stateBySegmentKey;
        }
    
        function restoreSegmentState(previousStateBySegmentKey) {
          normalizePoints();
          const segmentCount = Math.max(0, points.length - 1);
          const nextBufferDistances = [];
          const nextWalkingRoutes = [];
    
          for (let index = 0; index < segmentCount; index += 1) {
            const key = segmentStateKey(points[index], points[index + 1]);
            const previousState = previousStateBySegmentKey.get(key);
    
            nextBufferDistances[index] = previousState
              ? previousState.bufferDistance
              : DEFAULT_SEGMENT_BUFFER_METERS;
            nextWalkingRoutes[index] = previousState
              ? previousState.walkingRoutes
              : { routes: [], selectedIndex: 0 };
          }
    
          segmentBufferDistances = nextBufferDistances;
          segmentWalkingRoutes = nextWalkingRoutes;
    
          if (previousStateBySegmentKey.activeSegmentKey) {
            activeSegmentIndex = null;
    
            for (let index = 0; index < points.length - 1; index += 1) {
              if (segmentStateKey(points[index], points[index + 1]) === previousStateBySegmentKey.activeSegmentKey) {
                activeSegmentIndex = index;
                break;
              }
            }
          }
        }
    
        function segmentBufferDistance(segmentIndex) {
          normalizeSegmentBufferDistances();
          return segmentBufferDistances[segmentIndex] || DEFAULT_SEGMENT_BUFFER_METERS;
        }
    
        function setSegmentBufferDistance(segmentIndex, value) {
          const distanceMeters = Number.parseFloat(value);
          if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
            setRouteStatus("Enter a path buffer width greater than 0 meters.", "error");
            return false;
          }
    
          normalizeSegmentBufferDistances();
          if (segmentBufferDistances[segmentIndex] !== distanceMeters) {
            rememberItineraryState();
          }
          segmentBufferDistances[segmentIndex] = distanceMeters;
          notifyDirtyState();
          return true;
        }
    
        function segmentBufferGeometry(segmentIndex) {
          const start = points[segmentIndex];
          const end = points[segmentIndex + 1];
          if (!start || !end) return null;
    
          const segmentLine = turf.lineString([
            [start.lng, start.lat],
            [end.lng, end.lat]
          ]);
    
          return turf.buffer(segmentLine, segmentBufferDistance(segmentIndex), {
            units: "meters",
            steps: 64
          });
        }
    
        function segmentLineGeometry(segmentIndex) {
          const start = points[segmentIndex];
          const end = points[segmentIndex + 1];
          if (!start || !end) return null;
    
          return turf.lineString([
            [start.lng, start.lat],
            [end.lng, end.lat]
          ]);
        }
    
        function bufferResizeHandlePoints(segmentIndex) {
          const line = segmentLineGeometry(segmentIndex);
          if (!line) return [];
    
          const distanceMeters = segmentBufferDistance(segmentIndex);
          const length = turf.length(line, { units: "meters" });
          const midpoint = turf.along(line, length / 2, { units: "meters" });
          const bearing = turf.bearing(
            turf.point(line.geometry.coordinates[0]),
            turf.point(line.geometry.coordinates[1])
          );
    
          return [bearing + 90, bearing - 90].map(handleBearing => {
            const handlePoint = turf.destination(midpoint, distanceMeters, handleBearing, { units: "meters" });
            const [lng, lat] = handlePoint.geometry.coordinates;
            return [lat, lng];
          });
        }
    
        function updateSegmentBufferDistanceFromHandle(segmentIndex, latLng) {
          const line = segmentLineGeometry(segmentIndex);
          if (!line) return null;
    
          const handlePoint = turf.point([latLng.lng, latLng.lat]);
          const distanceMeters = Math.max(
            100,
            Math.round(turf.pointToLineDistance(handlePoint, line, { units: "meters" }) / 100) * 100
          );
    
          segmentBufferDistances[segmentIndex] = distanceMeters;
          return distanceMeters;
        }
    
        function redrawSegmentBufferPolygon(segmentIndex) {
          if (!segmentBufferLayer) return;
    
          const buffer = segmentBufferGeometry(segmentIndex);
          if (!buffer) return;
    
          segmentBufferLayer.clearLayers();
          segmentBufferLayer.addData(buffer);
        }
    
        function updateSegmentBufferHandlePositions(segmentIndex) {
          if (segmentBufferHandles.length === 0) return;
    
          const handlePoints = bufferResizeHandlePoints(segmentIndex);
          segmentBufferHandles.forEach((handle, index) => {
            const latLng = handlePoints[index];
            if (latLng) {
              handle.setLatLng(latLng);
            }
          });
        }
    
        function drawSegmentBufferHandles(segmentIndex) {
          const handlePoints = bufferResizeHandlePoints(segmentIndex);
          if (handlePoints.length === 0) return;
    
          segmentBufferHandleLayer = L.layerGroup().addTo(map);
    
          handlePoints.forEach(latLng => {
            const handle = L.marker(latLng, {
              draggable: true,
              icon: L.divIcon({
                className: "",
                html: `<div class="buffer-resize-handle" title="Drag to resize buffer"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
              })
            }).addTo(segmentBufferHandleLayer);
    
            handle.on("dragstart", () => {
              rememberItineraryState();
            });
    
            handle.on("drag", event => {
              const distanceMeters = updateSegmentBufferDistanceFromHandle(segmentIndex, event.target.getLatLng());
              if (distanceMeters === null) return;
              redrawSegmentBufferPolygon(segmentIndex);
              updateSegmentBufferHandlePositions(segmentIndex);
            });
    
            handle.on("dragend", () => {
              activeSegmentIndex = segmentIndex;
              drawSegmentBuffer(segmentIndex);
              renderList();
              showSegmentPois(segmentIndex);
            });
    
            segmentBufferHandles.push(handle);
          });
        }
    
        function drawSegmentBuffer(segmentIndex, fitAfterDraw = false) {
          clearSegmentBuffer();
    
          if (!window.turf) {
            setRouteStatus("Buffer calculation is unavailable because Turf.js did not load.", "error");
            return;
          }
    
          const buffer = segmentBufferGeometry(segmentIndex);
          if (!buffer) return;
    
          segmentBufferLayer = L.geoJSON(buffer, {
            style: {
              color: "#7c3aed",
              fillColor: "#a78bfa",
              fillOpacity: 0.22,
              opacity: 0.9,
              weight: 2,
              dashArray: poiLookupSegmentIndex === segmentIndex ? "10 8" : null,
              className: poiLookupSegmentIndex === segmentIndex ? "buffer-pulse" : ""
            }
          }).addTo(map);
    
          const distance = segmentBufferDistance(segmentIndex);
          segmentBufferLayer.bindPopup(
            `<strong>Path buffer</strong><br>` +
            `${formatDistance(distance)} around path ${segmentIndex + 1} → ${segmentIndex + 2}`
          );
          setRouteStatus(
            `<strong>Path buffer</strong>${formatDistance(distance)} around path ${segmentIndex + 1} → ${segmentIndex + 2}.`
          );
    
          if (activeSegmentIndex === segmentIndex) {
            drawSegmentBufferHandles(segmentIndex);
          }
    
          if (fitAfterDraw) {
            fitSegmentView(segmentIndex);
          }
        }
    
        function selectedWalkingRoute(segmentIndex) {
          normalizeSegmentWalkingRoutes();
          const segmentRoutes = segmentWalkingRoutes[segmentIndex];
          if (!segmentRoutes || segmentRoutes.routes.length === 0) return null;
    
          return segmentRoutes.routes[segmentRoutes.selectedIndex] || null;
        }
    
        function drawSegmentWalkingRoute(segmentIndex, fitAfterDraw = false) {
          clearSegmentWalkingRouteLayer();
    
          const route = selectedWalkingRoute(segmentIndex);
          if (!route) return;
    
          const latLngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          segmentWalkingRouteLayer = L.polyline(latLngs, {
            color: "#d97706",
            weight: 6,
            opacity: 0.9
          }).addTo(map);
    
          segmentWalkingRouteLayer.bindPopup(
            `<strong>Walking path ${segmentIndex + 1} → ${segmentIndex + 2}</strong><br>` +
            `${formatDistance(route.distance)} · ${formatDuration(walkingDurationSeconds(route))} estimated`
          );
    
          if (fitAfterDraw) {
            fitSegmentView(segmentIndex);
          }
        }
    
        async function fetchSegmentWalkingRoutes(segmentIndex) {
          const start = points[segmentIndex];
          const end = points[segmentIndex + 1];
          if (!start || !end) return;
    
          normalizeSegmentWalkingRoutes();
          setRouteStatus(`Calculating walking paths for path ${segmentIndex + 1} → ${segmentIndex + 2}...`);
    
          const coordinates = [
            `${start.lng.toFixed(6)},${start.lat.toFixed(6)}`,
            `${end.lng.toFixed(6)},${end.lat.toFixed(6)}`
          ].join(";");
          const params = new URLSearchParams({
            overview: "full",
            geometries: "geojson",
            steps: "true",
            alternatives: "3"
          });
    
          try {
            const data = await editorApi.getWalkingRoutes(coordinates, params.toString());
            if (data.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
              throw new Error(data.message || "No walking path found for this path.");
            }
    
            rememberItineraryState();
            segmentWalkingRoutes[segmentIndex] = {
              routes: data.routes,
              selectedIndex: 0
            };
            activeSegmentIndex = segmentIndex;
            drawSegmentWalkingRoute(segmentIndex, true);
            renderList();
    
            const route = data.routes[0];
            setRouteStatus(
              `<strong>Walking path</strong>` +
              `Path ${segmentIndex + 1} → ${segmentIndex + 2}: ${formatDistance(route.distance)} · ${formatDuration(walkingDurationSeconds(route))} estimated.`
            );
          } catch (error) {
            setRouteStatus(`Could not calculate walking paths. ${escapeHtml(error.message)}`, "error");
          }
        }
    
        function browseSegmentWalkingRoute(segmentIndex, direction) {
          normalizeSegmentWalkingRoutes();
          const segmentRoutes = segmentWalkingRoutes[segmentIndex];
          if (!segmentRoutes || segmentRoutes.routes.length < 2) return;
    
          rememberItineraryState();
          segmentRoutes.selectedIndex = (segmentRoutes.selectedIndex + direction + segmentRoutes.routes.length) % segmentRoutes.routes.length;
          activeSegmentIndex = segmentIndex;
          drawSegmentWalkingRoute(segmentIndex, true);
          renderList();
        }
    
        function selectedSegmentRouteState(segmentIndex) {
          normalizeSegmentWalkingRoutes();
          const state = segmentWalkingRoutes[segmentIndex];
          if (!state || state.routes.length === 0) return null;
    
          return {
            route: state.routes[state.selectedIndex],
            selectedIndex: state.selectedIndex,
            count: state.routes.length
          };
        }
    
        function currentItineraryState() {
          normalizePoints();
          normalizeSegmentBufferDistances();
          normalizeSegmentWalkingRoutes();
    
          return {
            points: clonePlain(points),
            segmentBufferDistances: clonePlain(segmentBufferDistances),
            segmentWalkingRoutes: clonePlain(segmentWalkingRoutes),
            activeSegmentIndex,
            nextPoiId,
            nextPointId
          };
        }

        function draftSnapshot() {
          return currentItineraryState();
        }
    
        function selectedRouteFromState(state, segmentIndex) {
          const segmentRoutes = state.segmentWalkingRoutes[segmentIndex];
          if (!segmentRoutes || !Array.isArray(segmentRoutes.routes) || segmentRoutes.routes.length === 0) {
            return null;
          }
    
          const selectedIndex = Math.max(0, Math.min(segmentRoutes.selectedIndex || 0, segmentRoutes.routes.length - 1));
          const route = segmentRoutes.routes[selectedIndex];
          if (!route) return null;
    
          return {
            selectedIndex,
            distanceMeters: route.distance,
            durationSecondsEstimated: walkingDurationSeconds(route),
            geometry: route.geometry || null
          };
        }
    
        function itineraryExportFromState(state) {
          const segmentCount = Math.max(0, state.points.length - 1);
    
          return {
            savedAt: new Date().toISOString(),
            points: state.points.map(point => {
              if (pointType(point) === "poi") {
                return {
                  type: "poi",
                  id: point.poiId,
                  label: point.label || "",
                  coordinates: {
                    lat: point.lat,
                    lng: point.lng
                  },
                  enabled: point.poiEnabled
                };
              }
    
              return {
                type: "waypoint",
                label: point.label || "",
                coordinates: {
                  lat: point.lat,
                  lng: point.lng
                }
              };
            }),
            segments: Array.from({ length: segmentCount }, (_, index) => ({
              fromPoint: index + 1,
              toPoint: index + 2,
              bufferMeters: state.segmentBufferDistances[index] || DEFAULT_SEGMENT_BUFFER_METERS,
              selectedWalkingRoute: selectedRouteFromState(state, index)
            }))
          };
        }

        function itineraryDirtySnapshot() {
          const exportData = itineraryExportFromState(currentItineraryState());
          return JSON.stringify({
            points: exportData.points,
            segments: exportData.segments
          });
        }

        function isItineraryDirty() {
          return savedItineraryState ? itineraryDirtySnapshot() !== JSON.stringify({
            points: savedItineraryExport?.points || [],
            segments: savedItineraryExport?.segments || []
          }) : points.length > 0;
        }

        function updateSaveRevertButtons(isDirty = isItineraryDirty()) {
          getElementById("saveItinerary").disabled = !isDirty;
          getElementById("revertItinerary").disabled = !savedItineraryState || !isDirty;
        }

        function notifyDirtyState(force = false) {
          const isDirty = isItineraryDirty();
          updateSaveRevertButtons(isDirty);
          if (force || isDirty !== lastDirtyState) {
            lastDirtyState = isDirty;
            dirtyStateChanged?.(isDirty);
          }
        }

        function setSaveStatus(message, type = "info") {
          saveStatusChanged?.({ message, type });
        }
    
        async function saveItinerary() {
          if (!isItineraryDirty()) return;

          const stateToSave = currentItineraryState();
          const exportToSave = itineraryExportFromState(stateToSave);

          if (!editingItineraryId) {
            setSaveStatus("Create the itinerary first.", "error");
            setRouteStatus("Create the itinerary before saving its path.", "error");
            return;
          }

          if (!itineraryMetadata.title) {
            setSaveStatus("Add metadata before saving.", "error");
            setRouteStatus("Add itinerary metadata before saving its path.", "error");
            return;
          }

          setSaveStatus("Saving...", "info");
          setRouteStatus("Saving itinerary...");

          try {
            const data = await editorApi.saveItinerary(editingItineraryId, {
              enabled: itineraryMetadata.enabled,
              itinerary_json: exportToSave,
              translations: [
                {
                  language_code: itineraryMetadata.language || "en",
                  title: itineraryMetadata.title,
                  description: itineraryMetadata.description || ""
                }
              ]
            });

            editingItineraryId = String(data.id);
            itineraryMetadata = {
              enabled: Boolean(data.enabled),
              language: itineraryMetadata.language || "en",
              title: data.title || itineraryMetadata.title,
              description: data.description || itineraryMetadata.description || ""
            };
            savedItineraryState = stateToSave;
            savedItineraryExport = exportToSave;
            notifyDirtyState(true);
            setSaveStatus("Saved.", "success");
            setRouteStatus(`Saved itinerary #${data.id}.`);
          } catch (error) {
            setSaveStatus(`Save failed: ${error.message || "Request failed."}`, "error");
            setRouteStatus(`Could not save itinerary. ${escapeHtml(error.message || "Request failed.")}`, "error");
          }
        }

        function updateHistoryButtons() {
          getElementById("undoItinerary").disabled = undoStack.length === 0;
          getElementById("redoItinerary").disabled = redoStack.length === 0;
          notifyDirtyState();
        }
    
        function rememberItineraryState() {
          undoStack.push(currentItineraryState());
          if (undoStack.length > MAX_HISTORY_STATES) {
            undoStack.shift();
          }
          redoStack = [];
          updateHistoryButtons();
        }
    
        function restoreItineraryState(state) {
          points = clonePlain(state.points);
          segmentBufferDistances = clonePlain(state.segmentBufferDistances);
          segmentWalkingRoutes = clonePlain(state.segmentWalkingRoutes);
          activeSegmentIndex = state.activeSegmentIndex;
          nextPoiId = state.nextPoiId || 1;
          nextPointId = state.nextPointId || 1;
    
          clearTemporaryPois();
          clearSegmentBuffer();
          clearSegmentWalkingRouteLayer();
    
          if (activeSegmentIndex !== null && activeSegmentIndex >= points.length - 1) {
            activeSegmentIndex = null;
          }
    
          render();
    
          if (activeSegmentIndex !== null) {
            drawSegmentBuffer(activeSegmentIndex);
            drawSegmentWalkingRoute(activeSegmentIndex);
          }
    
          if (points.length > 0) {
            fitRoute();
          }
        }
    
        async function poiPointFromId(poiId) {
          const poi = await editorApi.getPoi(String(poiId), "en");
          return makePoint(
            poi.gps_latitude,
            poi.gps_longitude,
            poi.title || `POI ${poi.id}`,
            "manual",
            "poi",
            String(poi.id),
            poi.enabled
          );
        }
    
        async function pointFromItineraryExport(point) {
          if (point?.type === "poi") {
            const coordinates = point?.coordinates || {};
            if (isValidLatLng(coordinates.lat, coordinates.lng)) {
              return makePoint(
                coordinates.lat,
                coordinates.lng,
                point.label || `POI ${point.id}`,
                point.label ? "manual" : "default",
                "poi",
                point.id || null,
                typeof point.enabled === "boolean" ? point.enabled : null
              );
            }
            return poiPointFromId(point.id);
          }
    
          const coordinates = point?.coordinates || {};
          if (!isValidLatLng(coordinates.lat, coordinates.lng)) {
            throw new Error("Saved itinerary contains a waypoint without valid coordinates.");
          }
    
          return makePoint(
            coordinates.lat,
            coordinates.lng,
            point.label || "",
            point.label ? "manual" : "default",
            "waypoint"
          );
        }
    
        async function loadItineraryForEditing(itineraryId, segmentToActivate = null) {
          try {
            editingItineraryId = String(itineraryId);
            const itinerary = await editorApi.getItinerary(String(itineraryId), "en");
            const itineraryJson = itinerary.itinerary_json || {};
            const exportedPoints = Array.isArray(itineraryJson.points) ? itineraryJson.points : [];
            const exportedSegments = Array.isArray(itineraryJson.segments) ? itineraryJson.segments : [];
    
            points = await Promise.all(exportedPoints.map(pointFromItineraryExport));
            segmentBufferDistances = exportedSegments.map(segment => segment.bufferMeters || DEFAULT_SEGMENT_BUFFER_METERS);
            segmentWalkingRoutes = exportedSegments.map(segment => {
              const selectedWalkingRoute = segment.selectedWalkingRoute;
              if (!selectedWalkingRoute?.geometry) {
                return { routes: [], selectedIndex: 0 };
              }
              return {
                routes: [
                  {
                    distance: selectedWalkingRoute.distanceMeters,
                    duration: selectedWalkingRoute.durationSecondsEstimated,
                    geometry: selectedWalkingRoute.geometry
                  }
                ],
                selectedIndex: 0
              };
            });
            activeSegmentIndex = null;
            undoStack = [];
            redoStack = [];
            savedItineraryState = currentItineraryState();
            savedItineraryExport = itineraryExportFromState(savedItineraryState);
            itineraryMetadata = {
              enabled: Boolean(itinerary.enabled),
              language: "en",
              title: itinerary.title || "",
              description: itinerary.description || ""
            };
            clearTemporaryPois();
            clearSegmentBuffer();
            clearSegmentWalkingRouteLayer();
            render();
            updateHistoryButtons();
            notifyDirtyState(true);
            if (initialDraftState?.points) {
              restoreItineraryState(initialDraftState);
              undoStack = [];
              redoStack = [];
              updateHistoryButtons();
              notifyDirtyState(true);
            }
            if (segmentToActivate !== null && segmentToActivate >= 0 && segmentToActivate < points.length - 1) {
              activateSegment(segmentToActivate, true, true);
            } else if (activeSegmentIndex !== null && activeSegmentIndex >= 0 && activeSegmentIndex < points.length - 1) {
              activateSegment(activeSegmentIndex, true, true);
            } else if (points.length > 0) {
              fitRoute();
            }
          } catch (error) {
            alert(`Could not load itinerary #${itineraryId}. ${error.message}`);
          }
        }
    
        function undoItinerary() {
          if (undoStack.length === 0) return;
    
          redoStack.push(currentItineraryState());
          restoreItineraryState(undoStack.pop());
          updateHistoryButtons();
        }
    
        function redoItinerary() {
          if (redoStack.length === 0) return;
    
          undoStack.push(currentItineraryState());
          restoreItineraryState(redoStack.pop());
          updateHistoryButtons();
        }
    
        function isEditableShortcutTarget(target) {
          if (!(target instanceof Element)) return false;
          return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
        }
    
        function handleHistoryShortcut(event) {
          if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditableShortcutTarget(event.target)) {
            return false;
          }
    
          const key = event.key.toLowerCase();
          const isUndo = key === "z" && !event.shiftKey;
          const isRedo = (key === "z" && event.shiftKey) || key === "y";
    
          if (!isUndo && !isRedo) {
            return false;
          }
    
          event.preventDefault();
          event.stopPropagation();
    
          if (isUndo) {
            undoItinerary();
          } else {
            redoItinerary();
          }
    
          return true;
        }
    
        function revertItinerary() {
          if (!isItineraryDirty()) return;

          if (!savedItineraryState) {
            alert("There is no saved itinerary to revert to yet.");
            return;
          }
    
          rememberItineraryState();
          restoreItineraryState(savedItineraryState);
          updateHistoryButtons();
        }
    
        function renderRouteSummaryMap() {
          const mapElement = getElementById("routeSummaryMap");
          if (!mapElement) return;
    
          if (mapElement._leaflet_id) {
            mapElement._leaflet_id = null;
            mapElement.innerHTML = "";
          }
    
          const summaryMap = L.map(mapElement, {
            attributionControl: false,
            zoomControl: true
          });
    
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
          }).addTo(summaryMap);
    
          const bounds = L.latLngBounds(points.map(point => [point.lat, point.lng]));
    
          points.forEach((point, index) => {
            L.marker([point.lat, point.lng], {
              icon: L.divIcon({
                className: "",
                html: `<div class="map-marker ${pointIconClass(point)}">${labelForIndex(index)}</div>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17]
              })
            }).addTo(summaryMap);
          });
    
          for (let index = 0; index < points.length - 1; index += 1) {
            const state = selectedSegmentRouteState(index);
            if (!state || !state.route || !state.route.geometry) continue;
    
            const latLngs = state.route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            const line = L.polyline(latLngs, {
              color: "#d97706",
              weight: 5,
              opacity: 0.9
            }).addTo(summaryMap);
            bounds.extend(line.getBounds());
          }
    
          requestAnimationFrame(() => {
            summaryMap.invalidateSize();
            summaryMap.fitBounds(bounds, { padding: [24, 24] });
          });
        }
    
        function showRouteSummary() {
          const segmentCount = Math.max(0, points.length - 1);
          normalizeSegmentBufferDistances();
          normalizeSegmentWalkingRoutes();
    
          if (segmentCount === 0) {
            routeDialogBody.innerHTML = "<p>Add at least two points to show an itinerary summary.</p>";
            routeDialog.showModal();
            return;
          }
    
          let totalDistance = 0;
          let totalDuration = 0;
          let loadedRouteCount = 0;
    
          const segmentRows = Array.from({ length: segmentCount }, (_, index) => {
            const state = selectedSegmentRouteState(index);
            const route = state ? state.route : null;
            let segmentText = "";
    
            if (route) {
              totalDistance += route.distance;
              totalDuration += walkingDurationSeconds(route);
              loadedRouteCount += 1;
              segmentText = `Path ${state.selectedIndex + 1} of ${state.count}: ${formatDistance(route.distance)} · ${formatDuration(walkingDurationSeconds(route))} estimated`;
            } else {
              const straightLineDistance = straightLineSegmentDistance(index);
              const straightLineDuration = walkingDurationForDistance(straightLineDistance);
              totalDistance += straightLineDistance;
              totalDuration += straightLineDuration;
              segmentText = `<span class="route-summary-straight-estimate">⚠ Walking path not loaded. Straight-line estimate: ${formatDistance(straightLineDistance)} · ${formatDuration(straightLineDuration)}</span>`;
            }
    
            return `
              <div class="route-summary-segment">
                <strong>Path ${index + 1} → ${index + 2}</strong>
                ${segmentText}
              </div>
            `;
          }).join("");
    
          routeDialogBody.innerHTML = `
            <div class="route-summary-grid">
              <div class="route-summary-stat">
                <strong>Points</strong>
                ${points.length}
              </div>
              <div class="route-summary-stat">
                <strong>Loaded Paths</strong>
                ${loadedRouteCount} of ${segmentCount}
              </div>
              <div class="route-summary-stat">
                <strong>Total Walking</strong>
                ${formatDistance(totalDistance)} · ${formatDuration(totalDuration)}
              </div>
            </div>
            <div class="route-summary-map" id="routeSummaryMap" aria-label="Map of selected walking paths"></div>
            ${segmentRows}
          `;
          routeDialog.showModal();
          renderRouteSummaryMap();
        }
    
        function openSegmentForPoint(pointIndex, fitAfterDraw = false) {
          if (points.length < 2) return;
    
          const segmentIndex = pointIndex === 0 ? 0 : pointIndex - 1;
          activeSegmentIndex = Math.max(0, Math.min(segmentIndex, points.length - 2));
          clearTemporaryPois();
          drawSegmentBuffer(activeSegmentIndex, fitAfterDraw);
          drawSegmentWalkingRoute(activeSegmentIndex, false);
          renderList();
          showSegmentPois(activeSegmentIndex);
        }
    
        function scrollSegmentPanelIntoView(segmentIndex) {
          requestAnimationFrame(() => {
            const segmentPanel = pointList.querySelector(`[data-segment-panel="${segmentIndex}"]`);
            if (segmentPanel) {
              segmentPanel.scrollIntoView({
                behavior: "smooth",
                block: "center"
              });
            }
          });
        }
    
        function focusSegmentPanel(segmentIndex) {
          requestAnimationFrame(() => {
            const segmentPanel = pointList.querySelector(`[data-segment-panel="${segmentIndex}"]`);
            if (segmentPanel) {
              segmentPanel.focus({ preventScroll: true });
            }
          });
        }
    
        function activateSegment(segmentIndex, fitAfterDraw = false, focusAfterRender = false) {
          if (segmentIndex < 0 || segmentIndex >= points.length - 1) return;
    
          activeSegmentIndex = segmentIndex;
          clearTemporaryPois();
          drawSegmentBuffer(segmentIndex, fitAfterDraw);
          drawSegmentWalkingRoute(segmentIndex);
          renderList();
          showSegmentPois(segmentIndex);
          scrollSegmentPanelIntoView(segmentIndex);
    
          if (focusAfterRender) {
            focusSegmentPanel(segmentIndex);
          }
        }
    
        function deactivateSegment() {
          activeSegmentIndex = null;
          clearSegmentBuffer();
          clearSegmentWalkingRouteLayer();
          clearTemporaryPois();
          renderList();
          setRouteStatus("Expand a path panel to work with its buffer zone.");
        }
    
        function moveActiveSegment(direction) {
          if (activeSegmentIndex === null) return;
    
          const nextSegmentIndex = Math.max(
            0,
            Math.min(activeSegmentIndex + direction, points.length - 2)
          );
    
          if (nextSegmentIndex === activeSegmentIndex) return;
          activateSegment(nextSegmentIndex, false, true);
        }
    
        function selectPointSegment(pointIndex) {
          openSegmentForPoint(pointIndex);
          if (activeSegmentIndex !== null) {
            scrollSegmentPanelIntoView(activeSegmentIndex);
          }
        }
    
        function activatePointFromMapOrCard(pointIndex) {
          if (!points[pointIndex]) return;
    
          openSegmentForPoint(pointIndex);
          if (activeSegmentIndex !== null) {
            scrollSegmentPanelIntoView(activeSegmentIndex);
          }
    
          requestAnimationFrame(() => {
            if (markers[pointIndex]) {
              markers[pointIndex].openPopup();
            }
          });
        }
    
        function addPoiToItinerary(poi, segmentIndex) {
          if (poiAlreadyInItinerary(poi.id)) {
            setRouteStatus("This POI is already included in the itinerary.");
            map.closePopup();
            return;
          }

          let insertedIndex = -1;
          if (Number.isInteger(segmentIndex)) {
            insertedIndex = insertPoint(
              segmentIndex + 1,
              poi.lat,
              poi.lng,
              poi.label || "",
              poi.label ? "manual" : "default",
              "poi",
              poi.id || null,
              poi.enabled
            );
          } else {
            insertedIndex = addPoint(
              poi.lat,
              poi.lng,
              poi.label || "",
              poi.label ? "manual" : "default",
              "poi",
              poi.id || null,
              poi.enabled
            );
          }
    
          clearTemporaryPois();
          map.closePopup();
          if (insertedIndex >= 0) {
            activateTab("poi");
            selectPointSegment(insertedIndex);
          }
        }

        function poiAlreadyInItinerary(poiId) {
          if (!poiId) return false;
          const normalizedPoiId = String(poiId);
          return points.some(point => pointType(point) === "poi" && String(point.poiId || "") === normalizedPoiId);
        }

        function segmentIndexForPointIndex(pointIndex) {
          if (points.length < 2) return null;
          return Math.max(0, Math.min(pointIndex, points.length - 2));
        }

        function editPoiFromPointIndex(pointIndex) {
          const point = points[pointIndex];
          if (!point || pointType(point) !== "poi" || !point.poiId || !editPoi) return;
          editPoi(String(point.poiId), segmentIndexForPointIndex(pointIndex));
        }

        function replaceWaypointWithPoi(pointId, poi) {
          if (!pointId || !poi?.id) return;
          const pointIndex = points.findIndex(point => point.id === pointId);
          if (pointIndex < 0 || pointType(points[pointIndex]) !== "waypoint") return;
          if (poiAlreadyInItinerary(poi.id)) {
            setRouteStatus("This POI is already included in the itinerary.");
            return;
          }

          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          const previousPoint = points[pointIndex];
          const replacementPoint = makePoint(
            Number.isFinite(poi.lat) ? poi.lat : previousPoint.lat,
            Number.isFinite(poi.lng) ? poi.lng : previousPoint.lng,
            poi.label || previousPoint.label || "",
            poi.label ? "manual" : previousPoint.labelSource || "default",
            "poi",
            String(poi.id),
            poi.enabled
          );
          replacementPoint.id = previousPoint.id;
          points[pointIndex] = replacementPoint;
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
          activateTab("poi");
          selectPointSegment(pointIndex);
          setRouteStatus(`Waypoint replaced with POI "${escapeHtml(poi.label || poi.id)}".`);
        }
    
        function setHighlightedPoi(poiId) {
          displayedPoiMarkers.forEach(marker => {
            const element = marker.getElement();
            if (element) {
              element.querySelector(".poi-marker")?.classList.remove("highlighted");
            }
          });
    
          if (!poiId) return;
    
          const marker = displayedPoiMarkers.get(poiId);
          const element = marker?.getElement();
          if (element) {
            element.querySelector(".poi-marker")?.classList.add("highlighted");
          }
        }
    
        function markerPopupContent(point, index) {
          const title = pointTitle(point, index);
          const relabelDisabled = point.labelSource === "geocoder" && !point.movedSinceLabel;
          const isWaypoint = pointType(point) === "waypoint";
          return `
            <article class="point-popup-card">
              <div class="point-popup-body">
                <div class="point-popup-text">
                  <strong class="poi-browser-title">${escapeHtml(title)}</strong>
                  <p class="poi-browser-snippet">${escapeHtml(pointType(point) === "poi" ? "Point of interest" : "Waypoint")}</p>
                </div>
                <div class="point-popup-actions">
                  ${isWaypoint ? `<button class="point-popup-action" data-action="relabel-map-point" data-index="${index}" title="Use place name from geocoder" ${relabelDisabled ? "disabled" : ""}>Relabel</button>` : ""}
                  ${isWaypoint ? `<button class="point-popup-action" data-action="convert-map-waypoint-poi" data-index="${index}" title="Turn waypoint into POI">Turn to POI</button>` : ""}
                  ${!isWaypoint && point.poiEnabled === false ? `<button class="point-popup-action" data-action="edit-map-poi" data-index="${index}" title="Edit draft POI">Edit</button>` : ""}
                  <button class="point-popup-action danger-action" data-action="delete-map-point" data-index="${index}" aria-label="Remove from itinerary" title="Remove from itinerary">Remove from itinerary</button>
                </div>
              </div>
            </article>
          `;
        }

        function pointRemovalConfirmContent(index) {
          const point = points[index];
          const title = point ? pointTitle(point, index) : `Point ${labelForIndex(index)}`;
          return `
            <article class="waypoint-confirm-card">
              <strong>Remove from itinerary?</strong>
              <p>${escapeHtml(title)} will be removed from this itinerary.</p>
              <div>
                <button type="button" class="danger-action" data-action="confirm-remove-point" data-index="${index}" data-choice="remove">Remove</button>
                <button type="button" data-action="confirm-remove-point" data-index="${index}" data-choice="cancel">Cancel</button>
              </div>
            </article>
          `;
        }
    
        async function relabelPointFromGeocoder(index, recordHistory = true) {
          const point = points[index];
          if (!point) return;
          const pointId = point.id;
    
          try {
            const data = await editorApi.reverseGeocode(point.lat, point.lng);
            const feature = Array.isArray(data.features) ? data.features[0] : null;
            if (!feature) {
              throw new Error("No place name found for this point.");
            }
    
            const currentIndex = points.findIndex(candidate => candidate.id === pointId);
            if (currentIndex < 0) return;
    
            if (recordHistory) {
              rememberItineraryState();
            }
            points[currentIndex].label = placeTitle(feature.properties);
            points[currentIndex].labelSource = "geocoder";
            points[currentIndex].movedSinceLabel = false;
            render();
            if (markers[currentIndex]) {
              markers[currentIndex].openPopup();
            }
          } catch (error) {
            alert(`Could not relabel point: ${error.message}`);
          }
        }
    
        function randomPointsInPolygon(polygon, count) {
          const bbox = turf.bbox(polygon);
          const selected = [];
          let attempts = 0;
    
          while (selected.length < count && attempts < 300) {
            const candidate = turf.randomPoint(1, { bbox }).features[0];
            if (turf.booleanPointInPolygon(candidate, polygon)) {
              selected.push(candidate);
            }
            attempts += 1;
          }
    
          return selected;
        }
    
        function createMockPoi(feature) {
          const [lng, lat] = feature.geometry.coordinates;
          const id = `mock-poi-${nextMockPoiId}`;
          nextMockPoiId += 1;
          const label = `Temporary POI ${id.replace("mock-poi-", "")}`;
          const imageSvg = encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="108"><rect width="144" height="108" fill="#dcfce7"/><circle cx="72" cy="44" r="22" fill="#16a34a"/><text x="72" y="86" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#166534">POI</text></svg>`
          );
    
          return {
            id,
            enabled: true,
            label,
            snippet: `Mock point of interest returned for the current buffer region near path ${activeSegmentIndex !== null ? activeSegmentIndex + 1 : ""}.`,
            imageUrl: `data:image/svg+xml,${imageSvg}`,
            lat,
            lng,
            categories: [{ slug: "mock", name: "Mock POIs" }]
          };
        }

        function isFootprintGeometry(value) {
          return Boolean(
            value &&
            (value.type === "Polygon" || value.type === "MultiPolygon") &&
            Array.isArray(value.coordinates)
          );
        }

        function poiIntersectsBuffer(poi, segmentBuffer) {
          const pointMatches = turf.booleanPointInPolygon(turf.point([poi.lng, poi.lat]), segmentBuffer);
          if (pointMatches || !isFootprintGeometry(poi.footprint) || typeof turf.booleanIntersects !== "function") {
            return pointMatches;
          }
          try {
            return turf.booleanIntersects({ type: "Feature", properties: {}, geometry: poi.footprint }, segmentBuffer);
          } catch {
            return pointMatches;
          }
        }
    
        function reconcilePoiCache(segmentBuffer, receivedPois) {
          const receivedIds = new Set(receivedPois.map(poi => poi.id));
    
          poiCache = poiCache.filter(poi => (
            !poiIntersectsBuffer(poi, segmentBuffer) ||
            receivedIds.has(poi.id)
          ));
    
          receivedPois.forEach(receivedPoi => {
            poiCache = poiCache.filter(poi => poi.id !== receivedPoi.id);
            poiCache.push(receivedPoi);
          });
    
          if (poiCache.length > MAX_POI_CACHE_SIZE) {
            poiCache = poiCache.slice(poiCache.length - MAX_POI_CACHE_SIZE);
          }
        }
    
        function cachedPoisInBuffer(segmentBuffer) {
          return poiCache.filter(poi => (
            poiIntersectsBuffer(poi, segmentBuffer)
          ));
        }
    
        function poiCategories(poi) {
          return Array.isArray(poi.categories) ? poi.categories.filter(category => category && category.slug) : [];
        }
    
        function poiCategoryOptions() {
          const categories = new Map();
          displayedPois.forEach(poi => {
            poiCategories(poi).forEach(category => {
              if (!categories.has(category.slug)) {
                categories.set(category.slug, category.name || category.slug);
              }
            });
          });
          return Array.from(categories, ([slug, name]) => ({ slug, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        }
    
        function filteredDisplayedPois() {
          if (!selectedPoiCategory) return displayedPois;
          return displayedPois.filter(poi => (
            poiCategories(poi).some(category => category.slug === selectedPoiCategory)
          ));
        }
    
        function renderPoiBrowser() {
          if (displayedPois.length === 0 || displayedPoiSegmentIndex === null) {
            poiBrowser.hidden = true;
            poiBrowserFilters.innerHTML = "";
            poiBrowserList.innerHTML = "";
            return;
          }
    
          poiBrowser.hidden = false;
          poiBrowser.classList.toggle("collapsed", poiBrowserCollapsed);
          togglePoiBrowser.classList.toggle("expanded", !poiBrowserCollapsed);
          togglePoiBrowser.setAttribute("aria-expanded", String(!poiBrowserCollapsed));
          togglePoiBrowser.title = poiBrowserCollapsed ? "Show POI list" : "Hide POI list";
          const categoryOptions = poiCategoryOptions();
          const filteredPois = filteredDisplayedPois();
          poiBrowserTitle.textContent = `POIs for path ${displayedPoiSegmentIndex + 1} → ${displayedPoiSegmentIndex + 2}`;
          poiBrowserFilters.innerHTML = `
            <label>
              <span>Category</span>
              <select id="poiCategoryFilter" ${categoryOptions.length === 0 ? "disabled" : ""}>
                <option value="">All categories</option>
                ${categoryOptions.map(category => `
                  <option value="${escapeHtml(category.slug)}" ${category.slug === selectedPoiCategory ? "selected" : ""}>${escapeHtml(category.name)}</option>
                `).join("")}
              </select>
            </label>
          `;
    
          if (filteredPois.length === 0) {
            poiBrowserList.innerHTML = `
              <p class="poi-browser-empty">No POIs match this category.</p>
            `;
            return;
          }
    
          poiBrowserList.innerHTML = filteredPois.map(poi => {
            const alreadyAdded = poiAlreadyInItinerary(poi.id);
            const draftClass = poi.enabled === false ? " draft-poi" : "";
            const imageMarkup = poi.imageUrl
              ? `<img src="${escapeHtml(poi.imageUrl)}" alt="" />`
              : "";
            return `
              <article class="poi-browser-item${draftClass}" data-poi-key="${escapeHtml(poi.id)}" tabindex="0">
                ${imageMarkup}
                <div>
                  <strong class="poi-browser-title">${escapeHtml(poi.label)}</strong>
                  <p class="poi-browser-type">${poi.enabled === false ? "Draft POI" : "POI"}</p>
                  <p class="poi-browser-snippet">${escapeHtml(poi.snippet || "")}</p>
                </div>
                <div class="poi-browser-actions">
                  <button class="poi-browser-action" data-action="open-displayed-poi" data-poi-key="${escapeHtml(poi.id)}" aria-label="${poi.enabled === false ? "View/edit info and media" : "View info and media"} for ${escapeHtml(poi.label)}" title="${poi.enabled === false ? "View/edit info and media" : "View info and media"}">${poi.enabled === false ? "View/edit info and media" : "View info and media"}</button>
                  ${alreadyAdded ? "" : `<button class="poi-browser-action" data-action="add-displayed-poi" data-poi-key="${escapeHtml(poi.id)}" aria-label="Add ${escapeHtml(poi.label)} to itinerary" title="Add to itinerary">Add to itinerary</button>`}
                </div>
              </article>
            `;
          }).join("");
        }
    
        function poiImageUrls(poi) {
          const images = Array.isArray(poi.imageUrls) ? poi.imageUrls.filter(Boolean) : [];
          if (images.length > 0) return images;
          return poi.imageUrl ? [poi.imageUrl] : [];
        }
    
        function poiPopupContent(poi, segmentIndex) {
          const images = poiImageUrls(poi);
          const primaryImage = images[0] || "";
          const alreadyAdded = poiAlreadyInItinerary(poi.id);
          return `
            <article class="poi-popup-card ${primaryImage ? "" : "without-media"}">
              ${primaryImage ? `
                <div class="poi-popup-media">
                  <img src="${escapeHtml(primaryImage)}" alt="" />
                </div>
              ` : ""}
              <div class="poi-popup-body">
                <div class="poi-popup-text">
                  <strong class="poi-browser-title">${escapeHtml(poi.label)}</strong>
                  <p class="poi-browser-snippet">${poi.enabled === false ? "Draft POI" : "POI"}</p>
                  ${poi.snippet ? `<p class="poi-browser-snippet poi-popup-description">${escapeHtml(poi.snippet)}</p>` : ""}
                </div>
                <div class="poi-popup-actions">
                  <button class="poi-popup-add-button" data-action="edit-poi" data-segment="${segmentIndex}" data-poi-key="${escapeHtml(poi.id)}" title="${poi.enabled === false ? "View/edit info and media" : "View info and media"}">${poi.enabled === false ? "View/edit info and media" : "View info and media"}</button>
                  ${alreadyAdded ? "" : `<button class="poi-popup-add-button" data-action="add-poi" data-segment="${segmentIndex}" data-lat="${poi.lat}" data-lng="${poi.lng}" data-label="${escapeHtml(poi.label)}" data-poi-enabled="${poi.enabled === false ? "false" : "true"}" data-poi-key="${escapeHtml(poi.id)}" aria-label="Add ${escapeHtml(poi.label)} to itinerary" title="Add to itinerary">Add to itinerary</button>`}
                </div>
              </div>
            </article>
          `;
        }
    
        function openPoiDetailDialog(poi, segmentIndex) {
          const images = poiImageUrls(poi);
          detailedPoi = poi;
          detailedPoiSegmentIndex = segmentIndex;
          poiDetailTitle.textContent = poi.label || "POI";
          addPoiFromDetail.disabled = !Number.isInteger(segmentIndex);
    
          poiDetailBody.innerHTML = `
            <section class="poi-detail-carousel" aria-label="POI images">
              <div class="poi-detail-track" data-poi-detail-track>
                ${images.length > 0 ? images.map(imageUrl => `
                  <figure class="poi-detail-slide">
                    <img src="${escapeHtml(imageUrl)}" alt="" />
                  </figure>
                `).join("") : `
                  <figure class="poi-detail-slide">
                    <div class="empty-state">No images available.</div>
                  </figure>
                `}
              </div>
              <div class="poi-detail-carousel-controls">
                <button type="button" data-action="poi-detail-prev" ${images.length < 2 ? "disabled" : ""}>Previous</button>
                <span class="muted">${images.length} image${images.length === 1 ? "" : "s"}</span>
                <button type="button" data-action="poi-detail-next" ${images.length < 2 ? "disabled" : ""}>Next</button>
              </div>
            </section>
            <section class="poi-detail-text">
              <h3>${escapeHtml(poi.label || "POI")}</h3>
              <p>${escapeHtml(poi.snippet || "No description available.")}</p>
              ${poi.website ? `<p><a href="${escapeHtml(poi.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(poi.website)}</a></p>` : ""}
              ${poi.phone ? `<p>${escapeHtml(poi.phone)}</p>` : ""}
              ${poi.email ? `<p><a href="mailto:${escapeHtml(poi.email)}">${escapeHtml(poi.email)}</a></p>` : ""}
            </section>
          `;
    
          poiDetailDialog.showModal();
        }
    
        function bindMarkerHoverPopup(marker) {
          let closeTimer = null;

          const cancelClose = () => {
            window.clearTimeout(closeTimer);
            closeTimer = null;
          };

          const scheduleClose = () => {
            cancelClose();
            closeTimer = window.setTimeout(() => marker.closePopup(), 180);
          };

          marker.on("mouseover", () => {
            cancelClose();
            marker.openPopup();
          });
          marker.on("mouseout", scheduleClose);
          marker.on("popupopen", event => {
            const popupElement = event.popup.getElement();
            if (!popupElement) return;

            L.DomEvent.disableClickPropagation(popupElement);
            L.DomEvent.disableScrollPropagation(popupElement);
            popupElement.addEventListener("mouseover", cancelClose);
            popupElement.addEventListener("mouseout", scheduleClose);
          });
        }
    
        function renderTemporaryPois(segmentIndex, pois) {
          temporaryPoiLayer.clearLayers();
          temporaryPoiFootprintLayer.clearLayers();
          displayedPoiMarkers = new Map();
          displayedPois = pois.filter(poi => !poiAlreadyInItinerary(poi.id));
          displayedPoiSegmentIndex = segmentIndex;
          if (selectedPoiCategory && !poiCategoryOptions().some(category => category.slug === selectedPoiCategory)) {
            selectedPoiCategory = "";
          }
          renderPoiBrowser();
    
          displayedPois.forEach(poi => {
            if (isFootprintGeometry(poi.footprint)) {
              L.geoJSON(poi.footprint, {
                style: {
                  color: poi.enabled === false ? "#b45309" : "#0f766e",
                  fillColor: poi.enabled === false ? "#f59e0b" : "#14b8a6",
                  fillOpacity: 0.18,
                  opacity: 0.85,
                  weight: 2
                },
                interactive: false
              }).addTo(temporaryPoiFootprintLayer);
            }
            const marker = L.marker([poi.lat, poi.lng], {
              icon: L.divIcon({
                className: "",
                html: `<div class="poi-marker ${poi.enabled === false ? "draft-poi" : ""}">POI</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14]
              })
            })
              .addTo(temporaryPoiLayer)
              .bindPopup(poiPopupContent(poi, segmentIndex), {
                className: "poi-popup",
                closeButton: false,
                autoClose: false,
                closeOnClick: false,
                minWidth: 320,
                maxWidth: 360
              });
            bindMarkerHoverPopup(marker);
            displayedPoiMarkers.set(poi.id, marker);
          });
        }
    
        async function fetchSegmentPois(segmentBuffer, segmentIndex, limit) {
          const data = await editorApi.findBufferPois(segmentBuffer, segmentIndex, limit);
          return Array.isArray(data.results) ? data.results : [];
        }
    
        async function showSegmentPois(segmentIndex) {
          clearTemporaryPois();
          const requestId = poiLookupRequestId + 1;
          poiLookupRequestId = requestId;
          poiLookupSegmentIndex = segmentIndex;
    
          if (!window.turf) {
            poiLookupSegmentIndex = null;
            renderList();
            drawSegmentBuffer(segmentIndex);
            setRouteStatus("POI lookup is unavailable because Turf.js did not load.", "error");
            return;
          }
    
          const segmentBuffer = segmentBufferGeometry(segmentIndex);
          if (!segmentBuffer) {
            poiLookupSegmentIndex = null;
            renderList();
            drawSegmentBuffer(segmentIndex);
            return;
          }
    
          try {
            const distanceMeters = segmentBufferDistance(segmentIndex);
            renderList();
            drawSegmentBuffer(segmentIndex);
            const cachedPois = cachedPoisInBuffer(segmentBuffer);
            if (cachedPois.length > 0) {
              renderTemporaryPois(segmentIndex, cachedPois);
            }
            setRouteStatus(`Looking for POIs inside the ${formatDistance(distanceMeters)} buffer for path ${segmentIndex + 1} → ${segmentIndex + 2}...`);
    
            const pois = await fetchSegmentPois(segmentBuffer, segmentIndex, 100);
            if (requestId !== poiLookupRequestId || activeSegmentIndex !== segmentIndex) {
              return;
            }
    
            if (pois.length === 0) {
              reconcilePoiCache(segmentBuffer, pois);
              renderTemporaryPois(segmentIndex, pois);
              setRouteStatus(`No POIs found inside the ${formatDistance(distanceMeters)} buffer for path ${segmentIndex + 1} → ${segmentIndex + 2}.`);
              return;
            }
    
            reconcilePoiCache(segmentBuffer, pois);
            renderTemporaryPois(segmentIndex, pois);
    
            setRouteStatus(
              `<strong>POIs</strong>` +
              `Showing ${pois.length} POIs inside the ${formatDistance(distanceMeters)} buffer for path ${segmentIndex + 1} → ${segmentIndex + 2}.`
            );
          } catch (error) {
            if (requestId === poiLookupRequestId) {
              setRouteStatus(escapeHtml(error.message), "error");
            }
          } finally {
            if (requestId === poiLookupRequestId) {
              poiLookupSegmentIndex = null;
              renderList();
              drawSegmentBuffer(segmentIndex);
            }
          }
        }
    
        function scheduleSegmentPoiLookup(segmentIndex, delay = 350) {
          window.clearTimeout(poiLookupTimer);
          poiLookupTimer = window.setTimeout(() => {
            if (activeSegmentIndex === segmentIndex) {
              showSegmentPois(segmentIndex);
            }
          }, delay);
        }
    
        function pointsDidChange() {
          clearTemporaryPois();
          normalizeSegmentBufferDistances();
          normalizeSegmentWalkingRoutes();
    
          if (activeSegmentIndex !== null && activeSegmentIndex >= points.length - 1) {
            activeSegmentIndex = null;
          }
    
          if (activeSegmentIndex === null) {
            clearSegmentBuffer();
            clearSegmentWalkingRouteLayer();
            setRouteStatus(
              points.length < 2
                ? "Add at least two points, then expand a path panel to work with its buffer zone."
                : "Expand a path panel to work with its buffer zone."
            );
          } else {
            drawSegmentBuffer(activeSegmentIndex);
            drawSegmentWalkingRoute(activeSegmentIndex);
            renderList();
          }
          notifyDirtyState();
        }
    
        function addPoint(lat, lng, label = "", labelSource = label ? "manual" : "default", type = "waypoint", poiId = null, poiEnabled = null) {
          if (!isValidLatLng(lat, lng)) {
            alert("Please enter valid coordinates: latitude -90 to 90, longitude -180 to 180.");
            return -1;
          }
    
          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          const point = makePoint(lat, lng, label, labelSource, type, poiId, poiEnabled);
          const insertionIndex = bestInsertionIndexForPoint(point);
          points.splice(insertionIndex, 0, point);
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
          if (points.length === 1) {
            map.setView([lat, lng], Math.max(map.getZoom(), 12));
          }
    
          return insertionIndex;
        }
    
        function insertPoint(index, lat, lng, label = "", labelSource = label ? "manual" : "default", type = "poi", poiId = null, poiEnabled = null) {
          if (!isValidLatLng(lat, lng)) {
            alert("Please enter valid coordinates: latitude -90 to 90, longitude -180 to 180.");
            return;
          }
    
          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          const insertionIndex = Math.max(0, Math.min(index, points.length));
          const point = makePoint(lat, lng, label, labelSource, type, poiId, poiEnabled);
          points.splice(insertionIndex, 0, point);
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
          return insertionIndex;
        }
    
        function removePoint(index) {
          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          points.splice(index, 1);
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
        }
    
        function movePoint(index, direction) {
          const targetIndex = index + direction;
          if (targetIndex < 0 || targetIndex >= points.length) return;
    
          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          const [point] = points.splice(index, 1);
          points.splice(targetIndex, 0, point);
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
        }
    
        function reorderPoint(fromIndex, insertionIndex) {
          if (
            fromIndex < 0 ||
            insertionIndex < 0 ||
            fromIndex >= points.length ||
            insertionIndex > points.length
          ) {
            return;
          }
    
          if (insertionIndex === fromIndex || insertionIndex === fromIndex + 1) {
            return;
          }
    
          rememberItineraryState();
          const previousSegmentState = captureSegmentState();
          const [point] = points.splice(fromIndex, 1);
          const adjustedIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
    
          points.splice(adjustedIndex, 0, point);
          restoreSegmentState(previousSegmentState);
          render();
          pointsDidChange();
        }
    
        function clearAll() {
          rememberItineraryState();
          points = [];
          activeSegmentIndex = null;
          render();
          clearSegmentBuffer();
          clearSegmentWalkingRoutes();
          clearTemporaryPois();
          setRouteStatus("Add at least two points, then expand a path panel to work with its buffer zone.");
        }
    
        function fitRoute() {
          if (points.length === 0) return;
    
          const latLngs = points.map(point => [point.lat, point.lng]);
          const bounds = L.latLngBounds(latLngs);
    
          if (segmentBufferLayer) {
            bounds.extend(segmentBufferLayer.getBounds());
          }
    
          if (segmentWalkingRouteLayer) {
            bounds.extend(segmentWalkingRouteLayer.getBounds());
          }
    
          map.fitBounds(bounds, { padding: [40, 40] });
        }
    
        function renderMarkers() {
          markers.forEach(marker => marker.remove());
          markers = [];
    
          points.forEach((point, index) => {
            const label = labelForIndex(index);
            const icon = L.divIcon({
              className: "",
              html: `<div class="map-marker ${pointIconClass(point)}">${label}</div>`,
              iconSize: [34, 34],
              iconAnchor: [17, 17],
              popupAnchor: [0, -18]
            });
    
            const marker = L.marker([point.lat, point.lng], {
              draggable: pointType(point) !== "poi",
              icon
            })
              .addTo(map)
              .bindPopup(markerPopupContent(point, index), {
                className: "point-popup",
                closeButton: false,
                autoClose: false,
                closeOnClick: false,
                minWidth: 220,
                maxWidth: 340
              });
            bindMarkerHoverPopup(marker);
    
            if (pointType(point) !== "poi") {
              marker.on("dragend", event => {
                const position = event.target.getLatLng();
                rememberItineraryState();
                const previousSegmentState = captureSegmentState();
                const movedPointId = points[index].id;
                const segmentToRefresh = activeSegmentIndex;
    
                points[index] = {
                  ...points[index],
                  lat: position.lat,
                  lng: position.lng,
                  movedSinceLabel: true
                };
                restoreSegmentState(previousSegmentState);
    
                for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
                  if (points[segmentIndex].id === movedPointId || points[segmentIndex + 1].id === movedPointId) {
                    segmentWalkingRoutes[segmentIndex] = { routes: [], selectedIndex: 0 };
                  }
                }
    
                render();
                pointsDidChange();
                if (
                  segmentToRefresh !== null &&
                  activeSegmentIndex === segmentToRefresh &&
                  points[segmentToRefresh] &&
                  points[segmentToRefresh + 1]
                ) {
                  showSegmentPois(segmentToRefresh);
                }
              });
            }
    
            marker.on("click", () => {
              activatePointFromMapOrCard(index);
            });
    
            markers.push(marker);
          });
        }
    
        function renderRoute() {
          const latLngs = points.map(point => [point.lat, point.lng]);
          routeLine.setLatLngs(latLngs);
        }
    
        function updateSegmentBufferFromInput(input, lookupPois = false) {
          const segmentIndex = Number.parseInt(input.dataset.segment, 10);
          if (!setSegmentBufferDistance(segmentIndex, input.value)) return;
    
          activeSegmentIndex = segmentIndex;
          clearTemporaryPois();
          drawSegmentBuffer(segmentIndex);
          drawSegmentWalkingRoute(segmentIndex);
          if (lookupPois) {
            showSegmentPois(segmentIndex);
          } else {
            scheduleSegmentPoiLookup(segmentIndex);
          }
        }
    
        function renderList() {
          pointList.innerHTML = "";
          normalizeSegmentWalkingRoutes();
    
          points.forEach((point, index) => {
            const label = labelForIndex(index);
            const title = pointTitle(point, index);
    
            const item = document.createElement("li");
            item.className = "point";
            item.draggable = true;
            item.dataset.index = index;
    
            item.innerHTML = `
              <button class="drag-handle" type="button" data-action="drag" data-index="${index}" aria-label="Drag point ${label}" title="Drag to reorder">☰</button>
              <div class="letter ${pointIconClass(point)}">${label}</div>
              <div>
                <label class="point-label">
                  <span class="point-label-row">
                    <span class="label-input-wrap">
                      <input class="${point.movedSinceLabel ? "stale-label" : ""}" data-action="label" data-index="${index}" type="text" value="${escapeHtml(point.label)}" placeholder="${escapeHtml(title)}" />
                      ${point.movedSinceLabel ? `<span class="stale-label-help" title="The point has been moved. Is the label still valid?">?</span>` : ""}
                    </span>
                    <button class="icon-button" type="button" data-action="relabel-card-point" data-index="${index}" aria-label="Relabel point" title="Relabel from geocoder" ${point.labelSource === "geocoder" && !point.movedSinceLabel ? "disabled" : ""}>↻</button>
                  </span>
                </label>
                <div class="coords">
                  ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
                <div class="point-actions">
                  <button class="icon-button" data-action="up" data-index="${index}" aria-label="Move point up" title="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
                  <button class="icon-button" data-action="down" data-index="${index}" aria-label="Move point down" title="Move down" ${index === points.length - 1 ? "disabled" : ""}>↓</button>
                  <button class="icon-button" data-action="zoom" data-index="${index}" aria-label="Zoom to point" title="Zoom to point">🎯</button>
                  ${pointType(point) === "waypoint" ? `<button class="icon-button" data-action="convert-waypoint-poi" data-index="${index}" aria-label="Turn waypoint into POI" title="Turn waypoint into POI">POI</button>` : ""}
                  ${pointType(point) === "poi" && point.poiEnabled === false ? `<button class="icon-button" data-action="edit-card-poi" data-index="${index}" aria-label="Edit draft POI" title="Edit draft POI">Edit</button>` : ""}
                  <button class="icon-button" data-action="delete" data-index="${index}" aria-label="Delete point" title="Delete point">🗑</button>
                </div>
              </div>
            `;
    
            pointList.appendChild(item);
    
            if (index < points.length - 1) {
              const isActive = activeSegmentIndex === index;
              const distance = segmentBufferDistance(index);
              const walkingRouteState = segmentWalkingRoutes[index] || { routes: [], selectedIndex: 0 };
              const walkingRoute = walkingRouteState.routes[walkingRouteState.selectedIndex];
              const poiLookupPending = poiLookupSegmentIndex === index;
              const segmentItem = document.createElement("li");
              segmentItem.className = `segment-control${isActive ? " active" : " collapsed"}`;
              segmentItem.dataset.segmentPanel = index;
              segmentItem.tabIndex = isActive ? 0 : -1;
              segmentItem.innerHTML = isActive ? `
                <div class="segment-header">
                  <strong>Path ${labelForIndex(index)} → ${labelForIndex(index + 1)}</strong>
                  <span class="segment-header-actions">
                    <button data-action="fit-segment" data-segment="${index}" aria-label="Fit map to path" title="Fit map to path">🔎</button>
                    <button class="plain-close" data-action="toggle-segment" data-segment="${index}" aria-expanded="true" aria-label="Hide path panel" title="Hide path panel"><span class="segment-toggle-triangle" aria-hidden="true">▴</span></button>
                  </span>
                </div>
                  <div class="segment-buffer-edit">
                    <label>
                      Range for nearby POIs (m)
                      <span class="segment-buffer-row">
                        <input data-action="segment-buffer-distance" data-segment="${index}" type="number" min="0" step="100" value="${distance}" />
                        <button class="${poiLookupPending ? "loading" : ""}" data-action="segment-pois" data-segment="${index}" aria-label="${poiLookupPending ? "Finding POIs" : "Refresh POIs"}" title="${poiLookupPending ? "Finding POIs" : "Refresh POIs"}" ${poiLookupPending ? "disabled" : ""}>${poiLookupPending ? `<span class="spinner" aria-hidden="true"></span>` : "↻"}</button>
                      </span>
                    </label>
                  </div>
                  <div class="segment-route-info">
                    ${walkingRoute ? `Walking path ${walkingRouteState.selectedIndex + 1} of ${walkingRouteState.routes.length} · ${formatDistance(walkingRoute.distance)} · ${formatDuration(walkingDurationSeconds(walkingRoute))} estimated` : "No walking path loaded."}
                  </div>
                  <div class="segment-actions">
                    <button data-action="segment-route-fetch" data-segment="${index}">${walkingRoute ? "Refresh walking paths" : "Get walking paths"}</button>
                    <button data-action="segment-route-prev" data-segment="${index}" ${walkingRouteState.routes.length < 2 ? "disabled" : ""}>Previous path</button>
                    <button data-action="segment-route-next" data-segment="${index}" ${walkingRouteState.routes.length < 2 ? "disabled" : ""}>Next path</button>
                  </div>
              ` : `
                <div class="segment-actions">
                  <button class="${walkingRoute ? "route-defined" : "no-route"}" data-action="toggle-segment" data-segment="${index}" aria-expanded="false" aria-label="Expand path ${labelForIndex(index)} to ${labelForIndex(index + 1)}" title="${walkingRoute ? "Expand path with walking path" : "Expand path without walking path"}">
                    <span>${walkingRoute ? "✓" : "?"}</span>
                    <span class="segment-toggle-triangle" aria-hidden="true">▾</span>
                  </button>
                </div>
              `;
              pointList.appendChild(segmentItem);
            }
          });
        }
    
        function render() {
          renderMarkers();
          renderRoute();
          renderList();
        }
    
        function addWaypointFromMapClick(latlng) {
          const index = addPoint(latlng.lat, latlng.lng);
          if (index >= 0) {
            activateTab("waypoint");
            selectPointSegment(index);
            relabelPointFromGeocoder(index, false);
          }
        }
    
        function confirmPendingBufferWaypoint(choice) {
          const waypoint = pendingBufferWaypoint;
          const popup = pendingBufferWaypointPopup;
          pendingBufferWaypoint = null;
          pendingBufferWaypointPopup = null;
    
          if (popup) {
            map.closePopup(popup);
          }
    
          if ((choice === true || choice === "waypoint") && waypoint) {
            addWaypointFromMapClick(waypoint);
            return;
          }

          if (choice === "poi" && waypoint) {
            if (createPoiAt) {
              createPoiAt(waypoint.lat, waypoint.lng, activeSegmentIndex);
            } else {
              const params = new URLSearchParams({
                latitude: String(waypoint.lat),
                longitude: String(waypoint.lng)
              });
              window.location.assign(`/pois/new?${params.toString()}`);
            }
          }
        }

        function suppressNextMapClick(durationMs = 700) {
          suppressMapClickUntil = Math.max(suppressMapClickUntil, Date.now() + durationMs);
        }

        function shouldIgnoreMapClick(event) {
          if (Date.now() < suppressMapClickUntil) return true;
          const originalTarget = event.originalEvent?.target;
          return Boolean(originalTarget?.closest?.(".leaflet-popup, .leaflet-control"));
        }

        function suppressPopupActionMapClick(event) {
          if (!event.target?.closest?.(".leaflet-popup button, .leaflet-popup a")) return;
          suppressNextMapClick();
        }
    
        function openBufferWaypointPrompt(latlng) {
          const popup = L.popup({
            className: "waypoint-confirm-popup",
            closeButton: false,
            closeOnClick: false,
            autoClose: true,
            minWidth: 300
          });
    
          pendingBufferWaypoint = latlng;
          pendingBufferWaypointPopup = popup;
          popup
            .on("remove", () => {
              if (pendingBufferWaypointPopup === popup) {
                pendingBufferWaypoint = null;
                pendingBufferWaypointPopup = null;
              }
            })
            .setLatLng(latlng)
            .setContent(`
              <article class="point-popup-card buffer-location-card">
                <div class="point-popup-body">
                  <div class="point-popup-text">
                    <strong class="poi-browser-title">Use this location?</strong>
                    <p class="poi-browser-snippet">Create waypoint splits the current path immediately. Create POI opens a draft point of interest here, which can be added as a waypoint later.</p>
                  </div>
                  <div class="point-popup-actions">
                    <button type="button" class="point-popup-action primary" data-action="confirm-buffer-waypoint" data-choice="poi">Create POI</button>
                    <button type="button" class="point-popup-action" data-action="confirm-buffer-waypoint" data-choice="waypoint">Create waypoint</button>
                    <button type="button" class="point-popup-action" data-action="confirm-buffer-waypoint" data-choice="cancel">Cancel</button>
                  </div>
                </div>
              </article>
            `)
            .openOn(map);
        }
    
        map.on("click", event => {
          if (shouldIgnoreMapClick(event)) {
            return;
          }

          if (activeSegmentIndex !== null && segmentBufferLayer) {
            const activeBuffer = segmentBufferGeometry(activeSegmentIndex);
            const clickedPoint = turf.point([event.latlng.lng, event.latlng.lat]);
            if (!activeBuffer || !turf.booleanPointInPolygon(clickedPoint, activeBuffer)) {
              confirmPendingBufferWaypoint(false);
              deactivateSegment();
            } else {
              openBufferWaypointPrompt(event.latlng);
            }
            return;
          }
    
          addWaypointFromMapClick(event.latlng);
        });
        map.on("moveend", updatePoiSearchRefreshButton);
        map.on("zoomend", updatePoiSearchRefreshButton);
        mapElement.addEventListener("pointerdown", suppressPopupActionMapClick, true);
        mapElement.addEventListener("click", suppressPopupActionMapClick, true);
    
        const documentKeydownHandler = event => {
          if (event.key === "Escape" && routeDialog.open) {
            event.preventDefault();
            event.stopPropagation();
            routeDialog.close();
            return;
          }

          if (handleHistoryShortcut(event)) return;
    
          if (event.target.closest("input, textarea, select")) return;
    
          if (pendingBufferWaypoint && event.key === "Enter") {
            event.preventDefault();
            confirmPendingBufferWaypoint(true);
            return;
          }
    
          if (event.key === "Escape") {
            event.preventDefault();
            if (pendingBufferWaypoint) {
              confirmPendingBufferWaypoint(false);
              return;
            }
            if (activeSegmentIndex !== null && segmentBufferLayer) {
              deactivateSegment();
            }
          }
        };
        document.addEventListener("keydown", documentKeydownHandler);

        routeDialog.addEventListener("cancel", event => {
          event.preventDefault();
          event.stopPropagation();
          routeDialog.close();
        });
    
        function addDetailedPoiToItinerary() {
          if (!detailedPoi) return;
          addPoiToItinerary(detailedPoi, detailedPoiSegmentIndex);
          poiDetailDialog.close();
        }
    
        function handlePoiDetailBodyClick(event) {
          const button = event.target.closest("button[data-action]");
          if (!button) return;
    
          const track = poiDetailBody.querySelector("[data-poi-detail-track]");
          if (!track) return;
    
          if (button.dataset.action === "poi-detail-prev") {
            track.scrollBy({ left: -track.clientWidth, behavior: "smooth" });
          }
    
          if (button.dataset.action === "poi-detail-next") {
            track.scrollBy({ left: track.clientWidth, behavior: "smooth" });
          }
        }
    
        function activateTab(tabName) {
          tabButtons.forEach(button => {
            const active = button.dataset.tab === tabName;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
          });
    
          tabPanels.forEach(panel => {
            panel.hidden = panel.dataset.tabPanel !== tabName;
          });
    
          window.clearTimeout(searchTimer);
          clearSearchResults();
          searchRequestId += 1;
        }
    
        function searchElementsForType(type) {
          return type === "poi"
            ? { inputElement: poiSearchInput, resultsElement: poiSearchResults }
            : { inputElement: waypointSearchInput, resultsElement: waypointSearchResults };
        }
    
        function handleSearchInput(type) {
          const { inputElement, resultsElement } = searchElementsForType(type);
          const query = inputElement.value.trim();
          window.clearTimeout(searchTimer);
    
          if (query.length < 3) {
            searchRequestId += 1;
            clearSearchResults(resultsElement);
            return;
          }
    
          if (type === "poi") {
            lastPoiSearchBbox = null;
            updatePoiSearchRefreshButton();
          }
    
          searchTimer = window.setTimeout(() => {
            if (type === "poi") {
              searchPois(query, resultsElement);
            } else {
              searchPlaces(query, resultsElement);
            }
          }, 500);
        }
    
        function handleSearchKeydown(type, event) {
          if (event.key !== "Escape") return;
          const { resultsElement } = searchElementsForType(type);
          clearSearchResults(resultsElement);
        }
    
        function handleSearchResultsClick(type, event) {
          const { inputElement, resultsElement } = searchElementsForType(type);
          const poiButton = event.target.closest('button[data-action="select-poi-search-result"]');
          if (poiButton) {
            const lat = Number.parseFloat(poiButton.dataset.lat);
            const lng = Number.parseFloat(poiButton.dataset.lng);
            const index = addPoint(lat, lng, poiButton.dataset.label || "", "manual", "poi", poiButton.dataset.poiId || null, poiButton.dataset.poiEnabled !== "false");
            inputElement.value = "";
            clearSearchResults(resultsElement);
            fitRoute();
            if (index >= 0) {
              activateTab("poi");
              selectPointSegment(index);
            }
            return;
          }
    
          const button = event.target.closest('button[data-action="select-search-result"]');
          if (!button) return;
    
          const lat = Number.parseFloat(button.dataset.lat);
          const lng = Number.parseFloat(button.dataset.lng);
          const index = addPoint(lat, lng, button.dataset.label || "", "geocoder", type);
          inputElement.value = "";
          clearSearchResults(resultsElement);
          fitRoute();
          if (index >= 0) {
            activateTab(type);
            selectPointSegment(index);
          }
        }
    
        function refreshPoiSearchResults() {
          const query = poiSearchInput.value.trim();
          clearSearchResults(poiSearchResults);
          if (query.length >= 3) {
            searchPois(query, poiSearchResults);
          }
        }
    
        function togglePoiBrowserPanel() {
          poiBrowserCollapsed = !poiBrowserCollapsed;
          renderPoiBrowser();
        }
    
        function handlePoiBrowserFiltersChange(event) {
          const select = event.target.closest("#poiCategoryFilter");
          if (!select) return;
          selectedPoiCategory = select.value;
          renderPoiBrowser();
        }
    
        function handlePoiBrowserListClick(event) {
          const openButton = event.target.closest('button[data-action="open-displayed-poi"]');
          if (openButton) {
            const poi = displayedPois.find(candidate => candidate.id === openButton.dataset.poiKey);
            if (poi && editPoi) {
              map.closePopup();
              editPoi(String(poi.id), Number.isInteger(displayedPoiSegmentIndex) ? displayedPoiSegmentIndex : null);
            } else if (poi) {
              window.location.assign(`/pois/${encodeURIComponent(poi.id)}/edit`);
            }
            return;
          }
    
          const button = event.target.closest('button[data-action="add-displayed-poi"]');
          if (!button) return;
    
          const poi = displayedPois.find(candidate => candidate.id === button.dataset.poiKey);
          if (!poi) return;
    
          addPoiToItinerary(poi, displayedPoiSegmentIndex);
        }
    
        function handlePoiBrowserListMouseover(event) {
          const item = event.target.closest(".poi-browser-item");
          if (item) setHighlightedPoi(item.dataset.poiKey);
        }
    
        function handlePoiBrowserListMouseout(event) {
          const item = event.target.closest(".poi-browser-item");
          if (item && !item.contains(event.relatedTarget)) {
            setHighlightedPoi(null);
          }
        }
    
        function handlePoiBrowserListFocusin(event) {
          const item = event.target.closest(".poi-browser-item");
          if (item) setHighlightedPoi(item.dataset.poiKey);
        }
    
        function handlePoiBrowserListFocusout(event) {
          const item = event.target.closest(".poi-browser-item");
          if (item && !item.contains(event.relatedTarget)) {
            setHighlightedPoi(null);
          }
        }
    
        function handlePointListKeydown(event) {
          if (activeSegmentIndex === null) return;
          if (event.target.closest("input, textarea, select")) return;
    
          if (event.key === "ArrowUp" || event.key === "Up") {
            event.preventDefault();
            moveActiveSegment(-1);
          }
    
          if (event.key === "ArrowDown" || event.key === "Down") {
            event.preventDefault();
            moveActiveSegment(1);
          }
        }
    
        function handlePointListClick(event) {
          const button = event.target.closest("button");
          if (!button) {
            if (event.target.closest("input, label")) return;
    
            const item = event.target.closest(".point");
            if (!item) return;
    
            const index = Number.parseInt(item.dataset.index, 10);
            activatePointFromMapOrCard(index);
            return;
          }
    
          const action = button.dataset.action;
    
          if (action === "toggle-segment") {
            const segmentIndex = Number.parseInt(button.dataset.segment, 10);
    
            if (activeSegmentIndex === segmentIndex) {
              deactivateSegment();
            } else {
              activateSegment(segmentIndex, true, true);
            }
            return;
          }
    
          if (action === "fit-segment") {
            const segmentIndex = Number.parseInt(button.dataset.segment, 10);
            activeSegmentIndex = segmentIndex;
            drawSegmentBuffer(segmentIndex);
            drawSegmentWalkingRoute(segmentIndex);
            fitSegmentView(segmentIndex);
            renderList();
            return;
          }
    
          if (action === "segment-pois") {
            const segmentIndex = Number.parseInt(button.dataset.segment, 10);
            const input = pointList.querySelector(`input[data-action="segment-buffer-distance"][data-segment="${segmentIndex}"]`);
            if (input && !setSegmentBufferDistance(segmentIndex, input.value)) return;
    
            activeSegmentIndex = segmentIndex;
            drawSegmentBuffer(segmentIndex);
            renderList();
            showSegmentPois(segmentIndex);
            return;
          }
    
          if (action === "segment-route-fetch") {
            const segmentIndex = Number.parseInt(button.dataset.segment, 10);
            activeSegmentIndex = segmentIndex;
            drawSegmentBuffer(segmentIndex);
            renderList();
            fetchSegmentWalkingRoutes(segmentIndex);
            return;
          }
    
          if (action === "segment-route-prev" || action === "segment-route-next") {
            const segmentIndex = Number.parseInt(button.dataset.segment, 10);
            const direction = action === "segment-route-prev" ? -1 : 1;
            browseSegmentWalkingRoute(segmentIndex, direction);
            return;
          }
    
          const index = Number.parseInt(button.dataset.index, 10);
    
          if (action === "relabel-card-point") {
            relabelPointFromGeocoder(index);
            return;
          }
    
          if (action === "up") movePoint(index, -1);
          if (action === "down") movePoint(index, 1);
          if (action === "delete") removePoint(index);
          if (action === "zoom") {
            const point = points[index];
            map.setView([point.lat, point.lng], 13);
            markers[index].openPopup();
          }
          if (action === "convert-waypoint-poi") {
            const point = points[index];
            if (point && pointType(point) === "waypoint" && createPoiAt) {
              const segmentIndex = segmentIndexForPointIndex(index);
              createPoiAt(point.lat, point.lng, segmentIndex, point.id, point.label || pointTitle(point, index));
            }
          }
          if (action === "edit-card-poi") {
            editPoiFromPointIndex(index);
          }
        }
    
        function handleMapCanvasClick(event) {
          const confirmBufferWaypointButton = event.target.closest('button[data-action="confirm-buffer-waypoint"]');
          if (confirmBufferWaypointButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            confirmPendingBufferWaypoint(confirmBufferWaypointButton.dataset.choice);
            return;
          }
    
          const relabelButton = event.target.closest('button[data-action="relabel-map-point"]');
          if (relabelButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const index = Number.parseInt(relabelButton.dataset.index, 10);
            relabelPointFromGeocoder(index);
            return;
          }

          const confirmRemovePointButton = event.target.closest('button[data-action="confirm-remove-point"]');
          if (confirmRemovePointButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const index = Number.parseInt(confirmRemovePointButton.dataset.index, 10);
            if (!points[index]) {
              map.closePopup();
              return;
            }
            if (confirmRemovePointButton.dataset.choice === "remove") {
              map.closePopup();
              removePoint(index);
            } else if (markers[index]) {
              markers[index].setPopupContent(markerPopupContent(points[index], index));
              markers[index].openPopup();
            }
            return;
          }
    
          const deleteButton = event.target.closest('button[data-action="delete-map-point"]');
          if (deleteButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const index = Number.parseInt(deleteButton.dataset.index, 10);
            if (points[index] && markers[index]) {
              markers[index].setPopupContent(pointRemovalConfirmContent(index));
              markers[index].openPopup();
            }
            return;
          }

          const convertWaypointButton = event.target.closest('button[data-action="convert-map-waypoint-poi"]');
          if (convertWaypointButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const index = Number.parseInt(convertWaypointButton.dataset.index, 10);
            const point = points[index];
            if (point && pointType(point) === "waypoint" && createPoiAt) {
              const segmentIndex = segmentIndexForPointIndex(index);
              map.closePopup();
              createPoiAt(point.lat, point.lng, segmentIndex, point.id, point.label || pointTitle(point, index));
            }
            return;
          }

          const editMapPoiButton = event.target.closest('button[data-action="edit-map-poi"]');
          if (editMapPoiButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const index = Number.parseInt(editMapPoiButton.dataset.index, 10);
            map.closePopup();
            editPoiFromPointIndex(index);
            return;
          }
    
          const expandPoiButton = event.target.closest('button[data-action="expand-poi"]');
          if (expandPoiButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const segmentIndex = Number.parseInt(expandPoiButton.dataset.segment, 10);
            const poi = displayedPois.find(candidate => candidate.id === expandPoiButton.dataset.poiKey);
            if (poi) {
              openPoiDetailDialog(poi, segmentIndex);
            }
            return;
          }

          const editDisplayedPoiButton = event.target.closest('button[data-action="edit-poi"]');
          if (editDisplayedPoiButton) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextMapClick();
            const segmentIndex = Number.parseInt(editDisplayedPoiButton.dataset.segment, 10);
            if (editPoi && editDisplayedPoiButton.dataset.poiKey) {
              map.closePopup();
              editPoi(editDisplayedPoiButton.dataset.poiKey, Number.isInteger(segmentIndex) ? segmentIndex : null);
            }
            return;
          }
    
          const button = event.target.closest('button[data-action="add-poi"]');
          if (!button) return;
          event.preventDefault();
          event.stopPropagation();
          suppressNextMapClick();
    
          const segmentIndex = Number.parseInt(button.dataset.segment, 10);
          addPoiToItinerary({
            id: button.dataset.poiKey || null,
            label: button.dataset.label || "",
            lat: Number.parseFloat(button.dataset.lat),
            lng: Number.parseFloat(button.dataset.lng),
            enabled: button.dataset.poiEnabled !== "false"
          }, segmentIndex);
        }
    
        function handlePointListInput(event) {
          const bufferInput = event.target.closest('input[data-action="segment-buffer-distance"]');
          if (bufferInput) {
            updateSegmentBufferFromInput(bufferInput, false);
            return;
          }
    
          const input = event.target.closest('input[data-action="label"]');
          if (!input) return;
    
          const index = Number.parseInt(input.dataset.index, 10);
          if (!points[index]) return;
    
          if (editingLabelIndex !== index) {
            rememberItineraryState();
            editingLabelIndex = index;
          }
          points[index].label = input.value;
          points[index].labelSource = "manual";
          points[index].movedSinceLabel = false;
          if (markers[index]) {
            markers[index].setPopupContent(markerPopupContent(points[index], index));
          }
          notifyDirtyState();
        }
    
        function handlePointListChange(event) {
          const bufferInput = event.target.closest('input[data-action="segment-buffer-distance"]');
          if (bufferInput) {
            updateSegmentBufferFromInput(bufferInput, true);
            return;
          }
    
          if (event.target.closest('input[data-action="label"]')) {
            editingLabelIndex = null;
          }
        }
    
        function handlePointListFocusout(event) {
          if (event.target.closest('input[data-action="label"]')) {
            editingLabelIndex = null;
          }
        }
    
        function handlePointListPointerdown(event) {
          const handle = event.target.closest(".drag-handle");
          if (!handle) return;
    
          const item = handle.closest(".point");
          if (!item) return;
    
          armedDragIndex = Number.parseInt(item.dataset.index, 10);
          item.draggable = true;
        }
    
        function handlePointListPointerup() {
          armedDragIndex = null;
        }
    
        function handlePointListDragstart(event) {
          const item = event.target.closest(".point");
          const itemIndex = item ? Number.parseInt(item.dataset.index, 10) : null;
    
          if (!item || itemIndex !== armedDragIndex) {
            event.preventDefault();
            return;
          }
    
          draggedPointIndex = itemIndex;
          item.classList.add("dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(draggedPointIndex));
        }
    
        function handlePointListDragover(event) {
          const item = event.target.closest(".point");
          if (!item || draggedPointIndex === null) return;
    
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          pointList.querySelectorAll(".drag-over").forEach(point => point.classList.remove("drag-over"));
          item.classList.add("drag-over");
        }
    
        function handlePointListDragleave(event) {
          const item = event.target.closest(".point");
          if (item) item.classList.remove("drag-over");
        }
    
        function handlePointListDrop(event) {
          const item = event.target.closest(".point");
          if (!item || draggedPointIndex === null) return;
    
          event.preventDefault();
          const targetIndex = Number.parseInt(item.dataset.index, 10);
          const rect = item.getBoundingClientRect();
          const insertAfterTarget = event.clientY > rect.top + rect.height / 2;
          reorderPoint(draggedPointIndex, targetIndex + (insertAfterTarget ? 1 : 0));
          draggedPointIndex = null;
        }
    
        function handlePointListDragend() {
          draggedPointIndex = null;
          armedDragIndex = null;
          pointList.querySelectorAll(".dragging, .drag-over").forEach(point => {
            point.classList.remove("dragging", "drag-over");
          });
        }
    
        updateHistoryButtons();
        requestAnimationFrame(() => map.invalidateSize());
        const windowLoadHandler = () => map.invalidateSize();
        window.addEventListener("load", windowLoadHandler);
    
        const initialItineraryId = options.itineraryId || new URLSearchParams(window.location.search).get("itinerary");
        if (initialItineraryId) {
          loadItineraryForEditing(initialItineraryId, initialSegmentIndex);
        } else if (initialDraftState?.points) {
          restoreItineraryState(initialDraftState);
          undoStack = [];
          redoStack = [];
          updateHistoryButtons();
          notifyDirtyState(true);
        }

        const poiSaveMessageHandler = event => {
          const data = event?.data || event;
          if (!data || data.editorToken !== editorSessionToken || !data.pointId || !data.poi) return;
          replaceWaypointWithPoi(data.pointId, data.poi);
        };
        const poiSaveStorageHandler = event => {
          if (event.key !== poiSaveChannelName || !event.newValue) return;
          try {
            poiSaveMessageHandler({ data: JSON.parse(event.newValue) });
          } catch {
            // Ignore malformed cross-tab messages.
          }
        };
        poiSaveChannel?.addEventListener("message", poiSaveMessageHandler);
        window.addEventListener("storage", poiSaveStorageHandler);
    
        let resizeObserver = null;
        if ("ResizeObserver" in window) {
          resizeObserver = new ResizeObserver(() => {
            map.invalidateSize();
          });
          resizeObserver.observe(mapElement);
        }
    
        return {
          destroy() {
            document.removeEventListener("keydown", documentKeydownHandler);
            window.removeEventListener("load", windowLoadHandler);
            window.clearTimeout(poiLookupTimer);
            if (resizeObserver) {
              resizeObserver.disconnect();
            }
            poiSaveChannel?.removeEventListener("message", poiSaveMessageHandler);
            poiSaveChannel?.close();
            window.removeEventListener("storage", poiSaveStorageHandler);
            mapElement.removeEventListener("pointerdown", suppressPopupActionMapClick, true);
            mapElement.removeEventListener("click", suppressPopupActionMapClick, true);
            map.remove();
          },
          draftSnapshot,
          clearAll,
          fitRoute,
          showRouteSummary,
          saveItinerary,
          revertItinerary,
          undoItinerary,
          redoItinerary,
          closeRouteDialog: () => routeDialog.close(),
          closePoiDetailDialog: () => poiDetailDialog.close(),
          addPoiFromDetail: addDetailedPoiToItinerary,
          activateTab,
          handleSearchInput,
          handleSearchKeydown,
          handleSearchResultsClick,
          refreshPoiSearchResults,
          togglePoiBrowser: togglePoiBrowserPanel,
          handlePoiBrowserFiltersChange,
          handlePoiBrowserListClick,
          handlePoiBrowserListMouseover,
          handlePoiBrowserListMouseout,
          handlePoiBrowserListFocusin,
          handlePoiBrowserListFocusout,
          handlePoiDetailBodyClick,
          handlePointListKeydown,
          handlePointListClick,
          handlePointListInput,
          handlePointListChange,
          handlePointListFocusout,
          handlePointListPointerdown,
          handlePointListPointerup,
          handlePointListDragstart,
          handlePointListDragover,
          handlePointListDragleave,
          handlePointListDrop,
          handlePointListDragend,
          handleMapCanvasClick
        };
    
  };
})();
