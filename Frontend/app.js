// ===== HokieConnect – home page code =====
// Check if user is logged in
if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}
// the events list now comes from events.js
function makeEventCard(event) {
    return `
    <a href = "event.html?id=${event.id}" class="card event-card">
        <div class = "event-top">${event.category}</div>
        <div class = "event-info">
            <h3 style="margin-top:0 6px">${event.title}</h3>
            <p class ="gray" style ="margin: 0 0 8px">${event.when} · ${event.where}</p>
            <span class ="going">${event.going} Hokies going</span>
        </div>
    </a>`
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
