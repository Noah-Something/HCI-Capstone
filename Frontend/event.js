// ===== HokieConnect – event details page code =====
// Uses loadEvent, setRsvp, loadAttendees and formatTimeRange from events.js

// If the user is not logged in, send them back to the login page
if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

// Read the id from the address bar (example: event.html?id=2 -> 2)
const eventId = Number(new URLSearchParams(window.location.search).get('id'));

async function showEventPage() {
  // Get the event from the server (or the sample data on Live Server)
  const selectedEvent = await loadEvent(eventId);

  if (!selectedEvent) {
    document.getElementById('eventTitle').textContent = 'Event not found';
    document.getElementById('rsvpButton').style.display = 'none';
    document.getElementById('tipBox').style.display = 'none';
    return;
  }

  //  Put the event's info on the page
  // (textContent is used so text typed by users can't break the page)
  document.getElementById('eventCategory').textContent = selectedEvent.category;
  document.getElementById('eventTitle').textContent = selectedEvent.title;
  document.getElementById('eventWhen').textContent =
    formatTimeRange(selectedEvent.startsAt, selectedEvent.endsAt, true);
  document.getElementById('eventWhere').textContent =
    [selectedEvent.location, formatDistance(selectedEvent.distanceMiles)].filter(Boolean).join(' · ');
  document.getElementById('eventDescription').textContent = selectedEvent.description;

  // Host, tags and image (sample events on Live Server do not have these)
  if (selectedEvent.host) {
    // Group events link to the group's page
    const hostLine = document.getElementById('eventHost');
    hostLine.textContent = 'Hosted by ';
    if (selectedEvent.host.type === 'group' && selectedEvent.host.id) {
      const groupLink = document.createElement('a');
      groupLink.href = `group.html?id=${selectedEvent.host.id}`;
      groupLink.textContent = selectedEvent.host.name;
      hostLine.append(groupLink, ' (group)');
    } else {
      hostLine.append(selectedEvent.host.name);
    }
    if (selectedEvent.isMine) hostLine.append(' · You');
  }
  document.getElementById('eventTags').innerHTML = (selectedEvent.tags || [])
    .map((tag) => `<span class="chip">#${escapeEventHtml(tag)}</span>`).join('');
  if (selectedEvent.imageUrl) {
    const image = document.getElementById('eventImage');
    image.src = selectedEvent.imageUrl;
    image.alt = selectedEvent.title;
    image.hidden = false;
  }

  // Map pin and a directions link that opens in the phone's or computer's map app
  if (selectedEvent.latitude !== null && selectedEvent.latitude !== undefined) {
    document.getElementById('eventMapBox').hidden = false;
    const point = [selectedEvent.latitude, selectedEvent.longitude];
    createMap('eventMap', { center: point, zoom: 15 })
      .then((map) => {
        map.setPins([{ point, popupHtml: `<b>${escapeEventHtml(selectedEvent.location)}</b>` }]);
        map.setView(point, 15);
      })
      .catch(() => { document.getElementById('eventMap').hidden = true; });
    document.getElementById('directionsLink').href =
      `https://www.google.com/maps/dir/?api=1&destination=${selectedEvent.latitude},${selectedEvent.longitude}`;
  }

  // Only the person who created the event can delete it
  if (selectedEvent.isMine) {
    const deleteButton = document.getElementById('deleteButton');
    deleteButton.hidden = false;
    deleteButton.addEventListener('click', async () => {
      if (!confirm('Delete this event? Everyone who RSVP\'d will lose it too.')) return;
      if (await deleteEvent(selectedEvent.id)) {
        window.location.href = 'events.html';
      } else {
        document.getElementById('rsvpStatus').textContent = 'Could not delete the event. Please try again.';
      }
    });
  }

  if (selectedEvent.newcomerTip) {
    document.getElementById('eventTip').textContent = selectedEvent.newcomerTip;
  } else {
    document.getElementById('tipBox').style.display = 'none';
  }

  // RSVP button
  let going = selectedEvent.iAmGoing;     // the server remembers if you already RSVP'd
  let count = selectedEvent.goingCount;
  const rsvpButton = document.getElementById('rsvpButton');
  const goingCount = document.getElementById('goingCount');
  const rsvpStatus = document.getElementById('rsvpStatus');

  function updateRsvp() {
    goingCount.textContent = count + ' Hokies going';
    if (going) {
      rsvpButton.textContent = "✓ You're going (click to undo)";
      rsvpButton.classList.add('btn-going');
    } else {
      rsvpButton.textContent = "RSVP · I'm going";
      rsvpButton.classList.remove('btn-going');
    }
  }

  rsvpButton.addEventListener('click', async () => {
    rsvpButton.disabled = true;
    rsvpStatus.textContent = '';
    const result = await setRsvp(selectedEvent.id, !going);

    if (result.offline) {
      // Live Server: just change the page
      going = !going;
      count += going ? 1 : -1;
    } else if (result.ok) {
      // Real server: use the count the database sends back
      going = !going;
      count = result.goingCount;
    } else {
      rsvpStatus.textContent = 'Could not save your RSVP. Please try again.';
    }

    rsvpButton.disabled = false;
    updateRsvp();
    showAttendees(selectedEvent.id);
  });

  updateRsvp();
  showAttendees(selectedEvent.id);
}

// List everyone going, with a link to message each of them (not yourself)
async function showAttendees(id) {
  const attendees = await loadAttendees(id);
  const box = document.getElementById('attendeesBox');
  if (attendees === null) {
    // Live Server has no attendee data
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const list = document.getElementById('attendeeList');
  if (attendees.length === 0) {
    list.innerHTML = '<li class="gray">No one yet. Be the first to RSVP!</li>';
    return;
  }
  list.innerHTML = attendees.map((person) => `
    <li class="attendee">
      <span class="attendee-avatar" aria-hidden="true">${escapeEventHtml(person.displayName.charAt(0).toUpperCase())}</span>
      <span class="attendee-name">
        <span><b>${escapeEventHtml(person.displayName)}</b>${person.isMe ? ' <span class="gray">(you)</span>' : ''}</span>
        <span class="gray">${person.gradYear ? `Class of ${person.gradYear}` : `@${escapeEventHtml(person.username)}`}</span>
      </span>
      ${person.isMe ? '' : `<a class="btn attendee-message" href="messages.html?user=${encodeURIComponent(person.username)}">Message</a>`}
    </li>`).join('');
}

showEventPage();