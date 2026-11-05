// ===== HokieConnect – Groups tab code =====
// Uses loadGroups, joinGroup, loadGroupCategories and formatGroupCounts from groups.js,
// and escapeEventHtml from events.js

if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

const groupList = document.getElementById('groupList');
const groupCount = document.getElementById('groupCount');
let showOnlyMine = false;

function makeGroupCard(group) {
  // Members see their role, everyone else gets a Join button
  const action = group.myRole
    ? `<span class="group-role">${group.myRole === 'admin' ? '★ Admin' : '✓ Joined'}</span>`
    : `<button type="button" class="btn btn-maroon join-group" data-group-id="${group.id}">Join</button>`;

  // A box holding the link and the button, since a button can't go inside a link
  return `
    <div class="card event-card">
      <a href="group.html?id=${group.id}" class="event-card-link">
        <div class="event-top">${escapeEventHtml(group.category || 'Group')}</div>
        <div class="event-info">
          <h3 style="margin:0 0 6px">${escapeEventHtml(group.name)}</h3>
          ${group.description ? `<p class="group-description">${escapeEventHtml(group.description)}</p>` : ''}
          <p class="gray" style="margin:0">${formatGroupCounts(group)}</p>
        </div>
      </a>
      <div class="event-card-actions">${action}</div>
    </div>`;
}

async function showGroups() {
  groupCount.textContent = 'Finding groups ...';
  const groups = await loadGroups({
    q: document.getElementById('groupSearch').value.trim(),
    category: document.getElementById('groupCategory').value,
    mine: showOnlyMine
  });

  if (groups === null) {
    groupCount.textContent = 'Could not load groups. Is server.js running?';
    groupList.innerHTML = '';
    return;
  }
  groupCount.textContent = groups.length === 1 ? '1 group' : `${groups.length} groups`;
  groupList.innerHTML = groups.length
    ? groups.map(makeGroupCard).join('')
    : (showOnlyMine
      ? '<p class="gray">You have not joined any groups yet. Find one under All groups, or <a href="create-group.html"><b>start your own</b></a>!</p>'
      : '<p class="gray">No groups match. <a href="create-group.html"><b>Start one!</b></a></p>');
}

// Join straight from the list, then redraw so the card shows "Joined"
groupList.addEventListener('click', async (click) => {
  const button = click.target.closest('.join-group');
  if (!button) return;
  button.disabled = true;
  const result = await joinGroup(Number(button.dataset.groupId));
  if (result.ok) {
    showGroups();
  } else {
    button.disabled = false;
    groupCount.textContent = result.message || 'Could not join the group.';
  }
});

// "All groups" / "My groups"
for (const tab of document.querySelectorAll('[data-view]')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-view]')) other.classList.remove('active');
    tab.classList.add('active');
    showOnlyMine = tab.dataset.view === 'mine';
    showGroups();
  });
}

document.getElementById('groupCategory').addEventListener('change', showGroups);
// Wait until the user stops typing before searching
let typingTimer;
document.getElementById('groupSearch').addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(showGroups, 400);
});

loadGroupCategories().then((categories) => {
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    document.getElementById('groupCategory').appendChild(option);
  }
  showGroups();
});
