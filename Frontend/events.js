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

// ===== Maps (Leaflet + OpenStreetMap, loaded in the page's <head>) =====
// Center of D.C., used when there is nothing else to center the map on
const DEFAULT_MAP_CENTER = [38.9072, -77.0369];

function makeMap(elementId, center = DEFAULT_MAP_CENTER, zoom = 12) {
  const map = L.map(elementId).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  return map;
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