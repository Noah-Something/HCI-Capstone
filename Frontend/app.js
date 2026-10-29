// ===== HokieConnect – home page code =====
if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}
// samples
const events = [
  { title: 'Saturday Morning 5K on the Mall', category: 'Running', when: 'Sat 8:00 AM', where: 'National Mall', going: 12 },
  { title: 'Hokies Game-Day Watch Party',      category: 'Social',  when: 'Sat 3:30 PM', where: 'Clarendon',     going: 24 },
  { title: 'Sunrise Yoga at Gravelly Point',   category: 'Yoga',    when: 'Sun 7:30 AM', where: 'Gravelly Point', going: 6 }
];
function makeEventCard(event) {
  return `
    <a href="event.html" class="card event-card">
      <div class="event-top">${event.category}</div>
      <div class="event-info">
        <h3 style="margin:0 0 6px">${event.title}</h3>
        <p class="gray" style="margin:0 0 8px">${event.when} · ${event.where}</p>
        <span class="going">${event.going} Hokies going</span>
      </div>
    </a>`;
}

function showEvents(category) {
  const list = document.getElementById('eventList');
  let html = '';
  for (const event of events) {
    if (category === 'All' || event.category === category) {
      html += makeEventCard(event);
    }
  }
  list.innerHTML = html;
}

const filterButtons = document.querySelectorAll('.filter');
for (const button of filterButtons) {
  button.addEventListener('click', () => {
    for (const b of filterButtons) b.classList.remove('active');
    button.classList.add('active');
    showEvents(button.dataset.category);
  });
}


showEvents('All');

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
    action.textContent = 'Say hi →';
  } catch (error) {
    headline.textContent = 'Meet Hokies near you';
    match.innerHTML = '';
  }
}

showFirstConnection();
