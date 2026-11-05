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

// Get all events
async function loadEvents() {
  const result = await apiRequest('/api/events');
  if (result.offline) return SAMPLE_EVENTS;
  return result.ok ? result.data.events : [];
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