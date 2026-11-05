// ===== HokieConnect – Events tab code =====
// Uses loadEvents, loadEventOptions, createMap, escapeEventHtml, formatTimeRange and formatDistance from events.js

if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

const eventResults = document.getElementById('eventResults');
const eventResultCount = document.getElementById('eventResultCount');

// One map for the page, its pins are replaced every time the filters change
const eventsMapReady = createMap('eventsMap');

function makeEventResultCard(event) {
  const details = [formatTimeRange(event.startsAt, event.endsAt), escapeEventHtml(event.location), formatDistance(event.distanceMiles)]
    .filter(Boolean).join(' · ');
  const tags = (event.tags || []).map((tag) => `<span class="chip">#${escapeEventHtml(tag)}</span>`).join('');
  const host = event.host
    ? `Hosted by ${escapeEventHtml(event.host.name)}${event.host.type === 'group' ? ' (group)' : ''}${event.isMine ? ' · You' : ''}`
    : '';

  const hasLocation = event.latitude !== null && event.latitude !== undefined;

  // The card is a box instead of one big link, so the map button can sit next to the link (a button
  // inside a link is not allowed in HTML). Clicking anywhere else on the card still opens the event
  return `
    <div class="card event-card">
      <a href="event.html?id=${event.id}" class="event-card-link">
        ${event.imageUrl
          ? `<img class="event-card-image" src="${event.imageUrl}" alt="" loading="lazy">`
          : ''}
        <div class="event-top">${escapeEventHtml(event.category)}</div>
        <div class="event-info">
          <h3 style="margin:0 0 6px">${escapeEventHtml(event.title)}</h3>
          <p class="gray" style="margin:0 0 6px">${details}</p>
          ${host ? `<p class="gray event-host">${host}</p>` : ''}
          ${tags ? `<div class="chips" style="margin-bottom:8px">${tags}</div>` : ''}
          <span class="going">${event.goingCount} Hokies going${event.iAmGoing ? ' · including you' : ''}</span>
        </div>
      </a>
      ${hasLocation
        ? `<div class="event-card-actions">
             <button type="button" class="btn show-on-map" data-event-id="${event.id}">📍 Locate on map</button>
           </div>`
        : ''}
    </div>`;
}

// "Show on map": scroll up to the map, zoom in on the event and open its popup
eventResults.addEventListener('click', async (click) => {
  const button = click.target.closest('.show-on-map');
  if (!button) return;
  try {
    const map = await eventsMapReady;
    if (map.focusPin(Number(button.dataset.eventId))) {
      document.getElementById('eventsMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } catch (error) {
    // The map could not load, showEventPins already hid it
  }
});

// Put a pin on the map for every event that has coordinates, and zoom to fit them
async function showEventPins(events) {
  try {
    const map = await eventsMapReady;
    map.setPins(events
      .filter((event) => event.latitude !== null && event.latitude !== undefined)
      .map((event) => ({
        id: event.id,
        point: [event.latitude, event.longitude],
        popupHtml: `<b><a href="event.html?id=${event.id}">${escapeEventHtml(event.title)}</a></b><br>
                    ${formatTimeRange(event.startsAt, event.endsAt)} · ${escapeEventHtml(event.location)}`
      })));
  } catch (error) {
    document.getElementById('eventsMap').hidden = true;
  }
}

async function showEvents() {
  const filters = {
    when: document.getElementById('whenFilter').value,
    q: document.getElementById('searchFilter').value.trim(),
    category: document.getElementById('categoryFilter').value,
    tag: document.getElementById('tagFilter').value.trim(),
    maxDistance: document.getElementById('distanceFilter').value
  };

  eventResultCount.textContent = 'Finding events ...';
  const events = await loadEvents(filters);

  // Events only have a distance if the user saved a location on their profile
  const anyDistance = events.some((event) => event.distanceMiles !== null && event.distanceMiles !== undefined);
  document.getElementById('distanceTip').hidden = anyDistance || events.length === 0;

  eventResultCount.textContent = events.length === 1 ? '1 event' : `${events.length} events`;
  eventResults.innerHTML = events.length
    ? events.map(makeEventResultCard).join('')
    : '<p class="gray">No events match these filters. Try widening your search, or <a href="create-event.html"><b>create one</b></a>!</p>';
  showEventPins(events);
}

async function setUpFilters() {
  const options = await loadEventOptions();
  for (const category of options.categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    document.getElementById('categoryFilter').appendChild(option);
  }
  // Tags people already use come first, then the suggested ones
  for (const tag of new Set([...options.popularTags, ...options.suggestedTags])) {
    const option = document.createElement('option');
    option.value = tag;
    document.getElementById('tagSuggestions').appendChild(option);
  }
}

for (const id of ['whenFilter', 'categoryFilter', 'distanceFilter']) {
  document.getElementById(id).addEventListener('change', showEvents);
}
// Wait until the user stops typing before searching
let typingTimer;
for (const id of ['searchFilter', 'tagFilter']) {
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(showEvents, 400);
  });
}

setUpFilters().then(showEvents);
