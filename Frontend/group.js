// ===== HokieConnect – group page code =====
// Uses loadGroup, joinGroup, leaveGroup, setMemberRole and formatGroupCounts from groups.js,
// and escapeEventHtml, formatTimeRange and formatDistance from events.js

if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

// Read the id from the address bar (example: group.html?id=2 -> 2)
const groupId = Number(new URLSearchParams(window.location.search).get('id'));
const groupStatus = document.getElementById('groupStatus');

function setGroupStatus(message, color) {
  groupStatus.textContent = message;
  groupStatus.style.color = color || '';
}

function makeGroupEventCard(event) {
  const details = [formatTimeRange(event.startsAt, event.endsAt), escapeEventHtml(event.location), formatDistance(event.distanceMiles)]
    .filter(Boolean).join(' · ');
  return `
    <a href="event.html?id=${event.id}" class="group-event">
      <b>${escapeEventHtml(event.title)}</b>
      <span class="gray">${details}</span>
      <span class="going">${event.goingCount} Hokies going${event.iAmGoing ? ' · including you' : ''}</span>
    </a>`;
}

function makeMemberRow(member, iAmAdmin) {
  // Admins can make other members admins (so they can host events too), or take it back
  let roleButton = '';
  if (iAmAdmin && !member.isMe) {
    roleButton = member.role === 'admin'
      ? `<button type="button" class="btn attendee-message change-role" data-username="${escapeEventHtml(member.username)}" data-role="member">Remove admin</button>`
      : `<button type="button" class="btn attendee-message change-role" data-username="${escapeEventHtml(member.username)}" data-role="admin">Make admin</button>`;
  }
  return `
    <li class="attendee">
      <span class="attendee-avatar" aria-hidden="true">${escapeEventHtml(member.displayName.charAt(0).toUpperCase())}</span>
      <span class="attendee-name">
        <span><b>${escapeEventHtml(member.displayName)}</b>${member.isMe ? ' <span class="gray">(you)</span>' : ''}
          ${member.role === 'admin' ? '<span class="role-badge">Admin</span>' : ''}</span>
        <span class="gray">${member.gradYear ? `Class of ${member.gradYear}` : `@${escapeEventHtml(member.username)}`}</span>
      </span>
      ${roleButton}
      ${member.isMe ? '' : `<a class="btn attendee-message" href="messages.html?user=${encodeURIComponent(member.username)}">Message</a>`}
    </li>`;
}

async function showGroupPage() {
  const data = await loadGroup(groupId);
  if (!data) {
    document.getElementById('groupName').textContent = 'Group not found';
    return;
  }
  const { group, members, events } = data;
  const iAmAdmin = group.myRole === 'admin';

  document.title = `HokieConnect – ${group.name}`;
  document.getElementById('groupCategory').textContent = group.category || 'Group';
  document.getElementById('groupName').textContent = group.name;
  document.getElementById('groupCounts').textContent = formatGroupCounts(group);
  document.getElementById('groupDescription').textContent = group.description;

  const membershipButton = document.getElementById('membershipButton');
  membershipButton.hidden = false;
  membershipButton.textContent = group.myRole ? 'Leave group' : 'Join group';
  membershipButton.classList.toggle('btn-maroon', !group.myRole);

  const createEvent = document.getElementById('createGroupEvent');
  createEvent.hidden = !iAmAdmin;
  createEvent.href = `create-event.html?group=${group.id}`;

  document.getElementById('groupEvents').innerHTML = events.length
    ? events.map(makeGroupEventCard).join('')
    : `<p class="gray">No upcoming events yet.${iAmAdmin ? ' Use <b>Create event for this group</b> to host one!' : ''}</p>`;

  document.getElementById('memberList').innerHTML = members.map((member) => makeMemberRow(member, iAmAdmin)).join('');
}

document.getElementById('membershipButton').addEventListener('click', async () => {
  const button = document.getElementById('membershipButton');
  const leaving = button.textContent === 'Leave group';
  if (leaving && !confirm('Leave this group?')) return;

  button.disabled = true;
  const result = leaving ? await leaveGroup(groupId) : await joinGroup(groupId);
  button.disabled = false;
  if (!result.ok) {
    setGroupStatus(result.message || 'Something went wrong. Please try again.', 'red');
    return;
  }
  // The last person leaving removes the group, so go back to the list
  if (leaving && result.message.includes('removed')) {
    window.location.href = 'groups.html';
    return;
  }
  setGroupStatus(leaving ? 'You left the group.' : 'You joined the group!', 'green');
  showGroupPage();
});

document.getElementById('memberList').addEventListener('click', async (click) => {
  const button = click.target.closest('.change-role');
  if (!button) return;
  button.disabled = true;
  const result = await setMemberRole(groupId, button.dataset.username, button.dataset.role);
  if (result.ok) {
    setGroupStatus('');
    showGroupPage();
  } else {
    button.disabled = false;
    setGroupStatus(result.message || 'Could not change their role.', 'red');
  }
});

showGroupPage();
