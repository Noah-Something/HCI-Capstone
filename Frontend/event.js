// ===== HokieConnect – event details page code =====
// Uses loadEvent, setRsvp and formatLongTime from events.js

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
    formatLongTime(selectedEvent.startsAt) + ' · ' + selectedEvent.location;
  document.getElementById('eventDescription').textContent = selectedEvent.description;

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
  });

  updateRsvp();
}

showEventPage();