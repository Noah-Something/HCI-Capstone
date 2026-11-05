// ===== HokieConnect – home page code =====
// Check if user is logged in
if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

// ===== Recommended events =====
// The server ranks upcoming events for this user (/api/events?sort=recommended, see recommendEvent in server.js)
// or SAMPLE_EVENTS are used on Live Server (see events.js)
let events = [];

// How many recommended events are loaded, and how many cards show at once
const RECOMMENDED_TO_LOAD = 40;
const RECOMMENDED_TO_SHOW = 6;

function makeEventCard(event) {
  const details = [formatTimeRange(event.startsAt, event.endsAt), escapeHtml(event.location), formatDistance(event.distanceMiles)]
    .filter(Boolean).join(' · ');
  // Why this event was recommended, e.g. "Matches your interest in Running · 2 mi from you"
  const reasons = event.recommendation ? event.recommendation.reasons : [];
  return `
    <a href="event.html?id=${event.id}" class="card event-card">
      ${event.imageUrl ? `<img class="event-card-image" src="${event.imageUrl}" alt="" loading="lazy">` : ''}
      <div class="event-top">${escapeHtml(event.category)}</div>
      <div class="event-info">
        <h3 style="margin:0 0 6px">${escapeHtml(event.title)}</h3>
        <p class="gray" style="margin:0 0 8px">${details}</p>
        ${reasons.length ? `<p class="recommend-reason">★ ${reasons.map(escapeHtml).join(' · ')}</p>` : ''}
        <span class="going">${event.goingCount} Hokies going${event.iAmGoing ? ' · including you' : ''}</span>
      </div>
    </a>`;
}

function showEvents(category) {
  const list = document.getElementById('eventList');
  const matching = events.filter((event) => category === 'All' || event.category === category);
  list.innerHTML = matching.length
    ? matching.slice(0, RECOMMENDED_TO_SHOW).map(makeEventCard).join('')
    : '<p class="gray">No upcoming events yet. <a href="create-event.html"><b>Host one!</b></a></p>';
}

// One button per category that has a recommended event, in order of the best match
function showCategoryFilters() {
  const categories = ['All', ...new Set(events.map((event) => event.category))];
  const container = document.getElementById('categoryFilters');
  container.innerHTML = categories.map((category) =>
    `<button class="filter${category === 'All' ? ' active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
  ).join('');
  // With only "All" there is nothing to filter
  container.hidden = categories.length <= 2;
}

document.getElementById('categoryFilters').addEventListener('click', (click) => {
  const button = click.target.closest('.filter');
  if (!button) return;
  for (const b of document.querySelectorAll('#categoryFilters .filter')) b.classList.remove('active');
  button.classList.add('active');
  showEvents(button.dataset.category);
});

loadEvents({ sort: 'recommended', limit: RECOMMENDED_TO_LOAD }).then((list) => {
  events = list;
  showCategoryFilters();
  showEvents('All');
});

// ===== "Your first connection" card =====
// Hokies within this many miles count as "near you"
const NEARBY_MILES = 10;

// Names are typed by users, so escape them before putting them in the page
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function showFirstConnection() {
  const card = document.getElementById('connectionCard');
  const headline = document.getElementById('connectionHeadline');
  const match = document.getElementById('connectionMatch');
  const action = document.getElementById('connectionAction');

  try {
    const response = await fetch('/api/hokies', {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('authToken')}` }
    });
    if (response.status === 401) {
      // Session expired or logged out elsewhere
      sessionStorage.removeItem('authToken');
      window.location.href = 'index.html';
      return;
    }
    if (!response.ok) throw new Error('Load failed');
    const data = await response.json();

    // Without a location there is no "near you", so ask for it first
    if (!data.viewer.hasLocation) {
      card.href = 'profile.html';
      headline.textContent = 'Find Hokies who live near you';
      match.innerHTML = '<p class="connection-detail">Share your location on your profile to see who is close by.</p>';
      action.textContent = 'Add your location →';
      return;
    }

    const nearby = data.hokies.filter((h) => h.distanceMiles !== null && h.distanceMiles <= NEARBY_MILES);
    if (nearby.length === 0) {
      headline.textContent = `No Hokies within ${NEARBY_MILES} miles yet`;
      match.innerHTML = '<p class="connection-detail">Check back soon, or widen your search on the Hokies page.</p>';
      return;
    }

    headline.textContent = nearby.length === 1
      ? `1 Hokie lives within ${NEARBY_MILES} miles of you`
      : `${nearby.length} Hokies live within ${NEARBY_MILES} miles of you`;

    // Hokies come back sorted by score, so the first nearby one is the best local match
    const top = nearby[0];
    const shared = [...top.sharedInterests, ...top.sharedWellness];
    const details = [
      top.gradYear ? `Class of ${top.gradYear}` : '',
      top.distanceMiles < 1 ? 'Less than 1 mi away' : `${Math.round(top.distanceMiles)} mi away`
    ].filter(Boolean).join(' · ');

    match.innerHTML = `
      <div class="connection-match">
        <div class="connection-match-header">
          <b>${escapeHtml(top.displayName)}</b>
          <span class="connection-score">${top.score}% match</span>
        </div>
        <p class="connection-detail">${details}</p>
        ${shared.length ? `<p class="connection-detail">You both like ${escapeHtml(shared.slice(0, 3).join(', '))}</p>` : ''}
      </div>`;
    // Opens a conversation with the top match
    card.href = `messages.html?user=${encodeURIComponent(top.username)}`;
    action.textContent = `Say hi to ${top.displayName} →`;
  } catch (error) {
    headline.textContent = 'Meet Hokies near you';
    match.innerHTML = '';
  }
}

showFirstConnection();
