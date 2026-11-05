// ===== HokieConnect – shared event code (used by home.html and event.html) =====
// Talks to the server's /api/events routes (PostgreSQL events + event_attendees tables).
// If there is no server (for example on Live Server), it uses SAMPLE_EVENTS instead
// so the pages can still be designed and tested.

// Sample events in the SAME shape the server sends back from /api/events
const SAMPLE_EVENTS = [
  {
    id: 1,
    title: 'Saturday Morning 5K on the Mall',
    category: 'Running',
    location: 'National Mall',
    startsAt: '2026-11-07T08:00:00-05:00',
    description: 'An easy-paced 5K loop around the Mall, then coffee nearby. All paces welcome, walkers too.',
    newcomerTip: 'Look for the maroon flag at the start. Someone from the group will say hi.',
    goingCount: 12,
    iAmGoing: false
  },
  {
    id: 2,
    title: 'Hokies Game-Day Watch Party',
    category: 'Social',
    location: 'Clarendon',
    startsAt: '2026-11-07T15:30:00-05:00',
    description: 'Watch the Hokies game with other D.C. alumni. Wear maroon and orange!',
    newcomerTip: 'The host will have a VT flag at the table near the front.',
    goingCount: 24,
    iAmGoing: false
  },
  {
    id: 3,
    title: 'Sunrise Yoga at Gravelly Point',
    category: 'Yoga',
    location: 'Gravelly Point',
    startsAt: '2026-11-08T07:30:00-05:00',
    description: 'A calm outdoor yoga class while the planes take off. Bring your own mat.',
    newcomerTip: 'Arrive 10 minutes early to find a spot.',
    goingCount: 6,
    iAmGoing: false
  }
];

// Sends a request to the server with the login token.
// Returns { offline: true } when there is no server (Live Server),
// otherwise { offline: false, ok, data }.
async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionStorage.getItem('authToken')}`
      }
    });

    // Live Server answers /api/... with an HTML error page, not JSON
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      return { offline: true };
    }

    // Session expired or not logged in
    if (response.status === 401) {
      sessionStorage.removeItem('authToken');
      window.location.href = 'index.html';
      return { offline: false, ok: false, data: {} };
    }

    return { offline: false, ok: response.ok, data: await response.json() };
  } catch (error) {
    return { offline: true };
  }
}

// Get upcoming events
// filters (all optional): { when: 'upcoming' | 'week' | 'past', q, category, tag, maxDistance }
async function loadEvents(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const result = await apiRequest(`/api/events${params.toString() ? `?${params}` : ''}`);
  if (result.offline) return SAMPLE_EVENTS;
  return result.ok ? result.data.events : [];
}

// Categories, suggested tags and the groups the user can host for (used by the Events pages)
async function loadEventOptions() {
  const result = await apiRequest('/api/event-options');
  if (result.offline || !result.ok) {
    return { categories: ['Running', 'Yoga', 'Social'], suggestedTags: [], popularTags: [], hostableGroups: [], maxTags: 5 };
  }
  return result.data;
}

// Create an event, returns { ok, id, message }
async function createEvent(details) {
  const result = await apiRequest('/api/events', { method: 'POST', body: JSON.stringify(details) });
  if (result.offline) return { ok: false, message: 'Creating events needs the server. Run server.js and open http://localhost:3000.' };
  return { ok: result.ok, id: result.data.id, message: result.data.message };
}

// Delete an event you created, returns true if it worked
async function deleteEvent(id) {
  const result = await apiRequest(`/api/events/${id}`, { method: 'DELETE' });
  return !result.offline && result.ok;
}

// Upload an image for an event you created, returns { ok, message }
// The image is sent as the file itself, not JSON, so it uses fetch directly
async function uploadEventImage(id, imageBlob) {
  try {
    const response = await fetch(`/api/events/${id}/image`, {
      method: 'PUT',
      headers: {
        'Content-Type': imageBlob.type,
        'Authorization': `Bearer ${sessionStorage.getItem('authToken')}`
      },
      body: imageBlob
    });
    const data = await response.json();
    return { ok: response.ok, message: data.message };
  } catch (error) {
    return { ok: false, message: 'Could not upload the image.' };
  }
}

// Shrinks an image file in the browser before uploading (largest side MAX_IMAGE_SIZE pixels, saved as JPEG)
// so uploads stay small and fast. Returns a Blob, or null if the file is not an image
const MAX_IMAGE_SIZE = 1200;
function resizeImage(file) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    };
    image.onerror = () => resolve(null);
    image.src = URL.createObjectURL(file);
  });
}

// ===== Maps =====
// Uses Google Maps when the server has a key (GOOGLEMAPS_KEY on Render), otherwise OpenStreetMap
// through Leaflet so maps still work locally without a key.
// Pages only use createMap(), which returns the same functions for both:
//   map.setPins([{ point: [lat, lng], popupHtml }])   replace the pins and zoom to fit them
//   map.setDraggablePin([lat, lng], onMove)           one pin the user can drag (create page)
//   map.onClick((lat, lng) => ...)                    clicks on the map
//   map.setView([lat, lng], zoom)

// Center of D.C., used when there is nothing else to center the map on
const DEFAULT_MAP_CENTER = [38.9072, -77.0369];

// Pins zoom in this far at most, so a single pin does not end up at street level
const MAX_FIT_ZOOM = 14;

let mapLibraryPromise = null;

// Loads Google Maps or Leaflet once per page, resolves to 'google' or 'leaflet'
function loadMapLibrary() {
  if (mapLibraryPromise) return mapLibraryPromise;
  mapLibraryPromise = (async () => {
    let config = {};
    try {
      config = await (await fetch('/api/maps-config')).json();
    } catch (error) {
      // No server (Live Server), use OpenStreetMap
    }

    if (config.googleMapsKey) {
      await new Promise((resolve, reject) => {
        window.__hokieMapsReady = resolve;
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
          key: config.googleMapsKey, v: 'weekly', libraries: 'marker', loading: 'async', callback: '__hokieMapsReady'
        });
        script.onerror = () => reject(new Error('Google Maps could not load'));
        document.head.appendChild(script);
      });
      window.__hokieMapId = config.googleMapsMapId;
      return 'google';
    }

    // Leaflet's stylesheet and script are only added when they are needed
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Map could not load'));
      document.head.appendChild(script);
    });
    return 'leaflet';
  })();
  return mapLibraryPromise;
}

// options: { center: [lat, lng], zoom, picker }
// picker: true for the create page, so scrolling over the map zooms it instead of scrolling the page
async function createMap(elementId, { center = DEFAULT_MAP_CENTER, zoom = 12, picker = false } = {}) {
  const library = await loadMapLibrary();
  return library === 'google'
    ? createGoogleMap(elementId, center, zoom, picker)
    : createLeafletMap(elementId, center, zoom);
}

function createGoogleMap(elementId, center, zoom, picker) {
  const toLatLng = ([lat, lng]) => ({ lat, lng });
  const map = new google.maps.Map(document.getElementById(elementId), {
    center: toLatLng(center),
    zoom,
    mapId: window.__hokieMapId,
    // On lists, scrolling the page should not get stuck zooming the map
    gestureHandling: picker ? 'greedy' : 'cooperative',
    // Clicking a shop or park on the picker should drop the pin, not open Google's info box
    clickableIcons: !picker,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false
  });
  const infoWindow = new google.maps.InfoWindow();
  let pins = [];
  let draggablePin = null;

  return {
    setPins(items) {
      pins.forEach((pin) => { pin.map = null; });
      pins = items.map(({ point, popupHtml }) => {
        const pin = new google.maps.marker.AdvancedMarkerElement({ map, position: toLatLng(point), gmpClickable: true });
        pin.addEventListener('gmp-click', () => {
          infoWindow.setContent(popupHtml);
          infoWindow.open({ map, anchor: pin });
        });
        return pin;
      });
      if (items.length === 1) {
        map.setCenter(toLatLng(items[0].point));
        map.setZoom(MAX_FIT_ZOOM);
      } else if (items.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        items.forEach(({ point }) => bounds.extend(toLatLng(point)));
        map.fitBounds(bounds, 40);
        google.maps.event.addListenerOnce(map, 'idle', () => {
          if (map.getZoom() > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
        });
      }
    },
    setDraggablePin(point, onMove) {
      if (!draggablePin) {
        draggablePin = new google.maps.marker.AdvancedMarkerElement({ map, gmpDraggable: true });
        draggablePin.addListener('dragend', () => {
          // position can be a LatLng or a plain {lat, lng}
          const position = draggablePin.position;
          const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
          const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
          onMove(lat, lng);
        });
      }
      draggablePin.position = toLatLng(point);
    },
    onClick(handler) {
      map.addListener('click', (event) => handler(event.latLng.lat(), event.latLng.lng()));
    },
    setView(point, newZoom) {
      map.setCenter(toLatLng(point));
      map.setZoom(newZoom);
    }
  };
}

function createLeafletMap(elementId, center, zoom) {
  // zoomSnap and wheelPxPerZoomLevel make scroll zooming finer than whole zoom levels
  const map = L.map(elementId, { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120 }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const pinLayer = L.layerGroup().addTo(map);
  let draggablePin = null;

  return {
    setPins(items) {
      pinLayer.clearLayers();
      items.forEach(({ point, popupHtml }) => L.marker(point).bindPopup(popupHtml).addTo(pinLayer));
      if (items.length === 1) {
        map.setView(items[0].point, MAX_FIT_ZOOM);
      } else if (items.length > 1) {
        map.fitBounds(items.map((item) => item.point), { padding: [30, 30], maxZoom: MAX_FIT_ZOOM });
      }
    },
    setDraggablePin(point, onMove) {
      if (!draggablePin) {
        draggablePin = L.marker(point, { draggable: true }).addTo(map);
        draggablePin.on('dragend', () => {
          const position = draggablePin.getLatLng();
          onMove(position.lat, position.lng);
        });
      }
      draggablePin.setLatLng(point);
    },
    onClick(handler) {
      map.on('click', (event) => handler(event.latlng.lat, event.latlng.lng));
    },
    setView(point, newZoom) {
      map.setView(point, newZoom);
    }
  };
}

// Text typed by users has to be escaped before it goes into HTML
function escapeEventHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function formatDistance(miles) {
  if (miles === null || miles === undefined) return '';
  return miles < 1 ? 'Less than 1 mi away' : `${Math.round(miles)} mi away`;
}

// Get one event (returns null if it does not exist)
async function loadEvent(id) {
  const result = await apiRequest(`/api/events/${id}`);
  if (result.offline) return SAMPLE_EVENTS.find(e => e.id === id) || null;
  return result.ok ? result.data.event : null;
}

// RSVP (going = true) or cancel (going = false)
// Returns { offline: true } on Live Server, otherwise { offline: false, ok, goingCount }
async function setRsvp(id, going) {
  const result = await apiRequest(`/api/events/${id}/rsvp`, { method: going ? 'POST' : 'DELETE' });
  if (result.offline) return { offline: true };
  return { offline: false, ok: result.ok, goingCount: result.data.goingCount };
}


function formatShortTime(startsAt) {
  return new Date(startsAt).toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit'
  });
}

function formatLongTime(startsAt) {
  return new Date(startsAt).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}