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
