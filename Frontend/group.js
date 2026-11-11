// ===== HokieConnect – group page code =====
// Uses the group API functions and formatGroupCounts from groups.js,
// and escapeEventHtml, formatTimeRange and formatDistance from events.js

if (!sessionStorage.getItem('authToken')) {
  window.location.href = 'index.html';
}

// Read the id from the address bar (example: group.html?id=2 -> 2)
const groupId = Number(new URLSearchParams(window.location.search).get('id'));
const groupStatus = document.getElementById('groupStatus');
const chatList = document.getElementById('chatList');
const chatInput = document.getElementById('chatInput');

// Check the chat for new messages this often while the page is open
const CHAT_REFRESH_MS = 5000;

// The latest group data, so the chat can show each sender's roles without asking the server again
let currentGroup = null;
let membersByUsername = new Map();
// Which member's ⋯ menu was open, so it stays open when the list is redrawn after a change
let openMenuFor = null;
let lastChatKey = '';
// Chat message ids already shown, so only new ones animate in (see chat-media.js)
const seenChatIds = new Set();
const CHAT_KEY = `group-${groupId}`;

function setStatus(element, message, color) {
  element.textContent = message;
  element.style.color = color || '';
}
const setGroupStatus = (message, color) => setStatus(groupStatus, message, color);

// ===== Badges =====
function roleBadge(name, color) {
  return `<span class="role-badge role-color-${escapeEventHtml(color)}">${escapeEventHtml(name)}</span>`;
}

// Creator, Admin, then the member's custom roles
function memberBadges(member) {
  return [
    member.isCreator ? roleBadge('Creator', 'gold') : '',
    member.role === 'admin' ? roleBadge('Admin', 'maroon') : '',
    ...member.customRoles.map((role) => roleBadge(role.name, role.color))
  ].join('');
}

// A member's name takes the color of their first custom role, like in most chat apps
function nameColorClass(member) {
  return member && member.customRoles.length ? `role-text-${member.customRoles[0].color}` : '';
}

// ===== Events =====
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

// ===== Member list =====
// The ⋯ menu: Message for everyone, plus admin and role controls for the creator and admins
function makeMemberMenu(member, group, roles) {
  const username = escapeEventHtml(member.username);
  const items = [];
  if (!member.isMe) {
    items.push(`<a class="member-menu-item" href="messages.html?user=${encodeURIComponent(member.username)}">Send a message</a>`);
  }
  if (group.canManage) {
    // Only the creator can remove themselves as admin
    if (member.role !== 'admin') {
      items.push(`<button type="button" class="member-menu-item change-role" data-username="${username}" data-role="admin">Make admin</button>`);
    } else if (!member.isCreator || member.isMe) {
      items.push(`<button type="button" class="member-menu-item change-role" data-username="${username}" data-role="member">${member.isMe ? 'Step down as admin' : 'Remove admin'}</button>`);
    }
    const held = new Set(member.customRoles.map((role) => role.id));
    items.push(roles.length
      ? `<div class="member-menu-label">Roles</div>` + roles.map((role) => `
          <label class="member-menu-check">
            <input type="checkbox" class="custom-role-toggle" data-username="${username}" value="${role.id}" ${held.has(role.id) ? 'checked' : ''}>
            ${roleBadge(role.name, role.color)}
          </label>`).join('')
      : `<p class="gray member-menu-note">No custom roles yet. Add some under <b>Custom roles</b> below.</p>`);
  }
  if (items.length === 0) return '';
  return `
    <details class="member-menu" data-username="${username}" ${openMenuFor === member.username ? 'open' : ''}>
      <summary aria-label="Options for ${escapeEventHtml(member.displayName)}">⋯</summary>
      <div class="member-menu-body">${items.join('')}</div>
    </details>`;
}

function makeMemberRow(member, group, roles) {
  return `
    <li class="group-member">
      <span class="attendee-avatar" aria-hidden="true">${escapeEventHtml(member.displayName.charAt(0).toUpperCase())}</span>
      <span class="group-member-info">
        <span class="group-member-name"><b class="${nameColorClass(member)}">${escapeEventHtml(member.displayName)}</b>${member.isMe ? ' <span class="gray">(you)</span>' : ''}</span>
        <span class="gray group-member-sub">${member.gradYear ? `Class of ${member.gradYear}` : `@${escapeEventHtml(member.username)}`}</span>
        <span class="role-badges">${memberBadges(member)}</span>
      </span>
      ${makeMemberMenu(member, group, roles)}
    </li>`;
}

function showMembers(group, members, roles) {
  const admins = members.filter((member) => member.role === 'admin');
  const others = members.filter((member) => member.role !== 'admin');
  const section = (title, list) => list.length
    ? `<div class="member-section-title">${title} — ${list.length}</div>
       <ul class="group-member-list">${list.map((member) => makeMemberRow(member, group, roles)).join('')}</ul>`
    : '';
  document.getElementById('memberTotal').textContent = `(${members.length})`;
  document.getElementById('memberList').innerHTML = section('Admins', admins) + section('Members', others);
}

// ===== Custom roles card =====
function showRoles(group, roles, roleColors) {
  const card = document.getElementById('rolesCard');
  card.hidden = !group.canManage;
  if (!group.canManage) return;

  const colorSelect = document.getElementById('roleColor');
  if (!colorSelect.options.length) {
    colorSelect.innerHTML = roleColors.map((color) =>
      `<option value="${color}">${color.charAt(0).toUpperCase() + color.slice(1)}</option>`).join('');
  }

  document.getElementById('roleList').innerHTML = roles.length
    ? roles.map((role) => `
        <li class="role-row" data-role-id="${role.id}">
          ${roleBadge(role.name, role.color)}
          <span class="gray role-count">${role.memberCount === 1 ? '1 member' : `${role.memberCount} members`}</span>
          <select class="input role-color-select" aria-label="Color for ${escapeEventHtml(role.name)}">
            ${roleColors.map((color) => `<option value="${color}" ${color === role.color ? 'selected' : ''}>${color.charAt(0).toUpperCase() + color.slice(1)}</option>`).join('')}
          </select>
          <button type="button" class="btn attendee-message rename-role" data-name="${escapeEventHtml(role.name)}">Rename</button>
          <button type="button" class="btn attendee-message delete-role" data-name="${escapeEventHtml(role.name)}">Delete</button>
        </li>`).join('')
    : '<li class="gray">No custom roles yet.</li>';
}

// ===== Whole page =====
async function showGroupPage() {
  const data = await loadGroup(groupId);
  if (!data) {
    document.getElementById('groupName').textContent = 'Group not found';
    return;
  }
  const { group, members, events, roles, roleColors } = data;
  currentGroup = group;
  membersByUsername = new Map(members.map((member) => [member.username, member]));
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

  document.getElementById('groupChatLayout').hidden = false;
  document.getElementById('chatLocked').hidden = Boolean(group.myRole);
  document.getElementById('chatArea').hidden = !group.myRole;
  showMembers(group, members, roles);
  showRoles(group, roles, roleColors);

  // Names and badges in the chat may have changed too
  lastChatKey = '';
  if (group.myRole) loadChat();
}

// ===== Chat =====
// Today shows the time, this week shows the day and time, older shows the date
function formatChatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (now - date < 6 * 24 * 60 * 60 * 1000) return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function makeChatMessage(message, previous) {
  // Show who sent it when the sender changes, or after a 10 minute gap
  const startsRun = !previous || previous.sender.username !== message.sender.username
    || new Date(message.createdAt) - new Date(previous.createdAt) > 10 * 60 * 1000;
  const member = membersByUsername.get(message.sender.username);
  const header = startsRun && !message.fromMe
    ? `<div class="chat-sender"><b class="${nameColorClass(member)}">${escapeEventHtml(message.sender.displayName)}</b>${member ? memberBadges(member) : ''}</div>`
    : '';
  const remove = message.canDelete
    ? ` · <button type="button" class="link-button delete-chat-message" data-message-id="${message.id}">Remove</button>`
    : '';
  return `
    <div class="message ${message.fromMe ? 'mine' : 'theirs'}${startsRun ? ' run-start' : ''}" data-message-id="${message.id}">
      ${header}
      ${message.image ? ChatMedia.photoHtml(message.image) : ''}
      ${message.body ? `<div class="bubble">${escapeEventHtml(message.body)}</div>` : ''}
      <span class="message-time">${formatChatTime(message.createdAt)}${remove}</span>
    </div>`;
}

async function loadChat() {
  if (!currentGroup || !currentGroup.myRole) return;
  const result = await loadGroupChat(groupId);
  const chatStatus = document.getElementById('chatStatus');
  if (!result.ok) {
    setStatus(chatStatus, result.message || 'Could not load the chat.', 'red');
    return;
  }
  setStatus(chatStatus, '');

  // Only redraw when something changed, so the chat does not jump while reading
  const key = result.messages.map((message) => message.id).join(',');
  if (key === lastChatKey) return;
  const firstLoad = lastChatKey === '';
  lastChatKey = key;

  const wasAtBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
  chatList.innerHTML = result.messages.length
    ? result.messages.map((message, index) => makeChatMessage(message, result.messages[index - 1])).join('')
    : `<p class="gray thread-start">No messages yet. Say hi to the group!</p>`;
  // Messages still sending stay at the bottom, new arrivals slide in, photos load in the background
  ChatMedia.keepPending(chatList, CHAT_KEY);
  ChatMedia.animateNew(chatList, seenChatIds);
  ChatMedia.loadPhotos(chatList);
  if (wasAtBottom || firstLoad) chatList.scrollTop = chatList.scrollHeight;
}

// The photo button, preview, paste and drag-and-drop (chat-media.js)
const chatComposer = ChatMedia.setUpComposer({
  form: document.getElementById('chatForm'),
  textarea: chatInput,
  onError: (message) => setStatus(document.getElementById('chatStatus'), message, 'red')
});

// The message shows straight away and animates in while it sends; if sending fails it can be tried again
async function sendChatMessage(body, photo) {
  const pendingMessage = ChatMedia.addPending(chatList, { body, photo, chatKey: CHAT_KEY });
  const result = await sendGroupMessage(groupId, body, photo);
  if (!result.ok) {
    ChatMedia.markFailed(pendingMessage, result.message || 'Not sent', () => sendChatMessage(body, photo));
    return;
  }
  // Already animated in, so the redraw should not animate it again
  seenChatIds.add(String(result.data.id));
  ChatMedia.markSent(pendingMessage);
  await loadChat();
  chatList.scrollTop = chatList.scrollHeight;
}

document.getElementById('chatForm').addEventListener('submit', (submit) => {
  submit.preventDefault();
  const body = chatInput.value.trim();
  const photo = chatComposer.getPhoto();
  if (!body && !photo) return;
  setStatus(document.getElementById('chatStatus'), '');
  chatInput.value = '';
  chatComposer.clear();
  ChatMedia.popButton(submit.submitter || document.querySelector('#chatForm .btn-maroon'));
  sendChatMessage(body, photo);
});

chatInput.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) {
    key.preventDefault();
    document.getElementById('chatForm').requestSubmit();
  }
});

chatList.addEventListener('click', async (click) => {
  const button = click.target.closest('.delete-chat-message');
  if (!button || !confirm('Remove this message for everyone?')) return;
  const result = await deleteGroupMessage(groupId, button.dataset.messageId);
  if (result.ok) {
    loadChat();
  } else {
    setStatus(document.getElementById('chatStatus'), result.message || 'Could not remove the message.', 'red');
  }
});

// ===== Joining and leaving =====
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

// ===== Member menu: admin and custom roles =====
const memberList = document.getElementById('memberList');

// Remember which menu is open, and close the others
memberList.addEventListener('toggle', (toggle) => {
  const menu = toggle.target;
  if (menu.open) {
    openMenuFor = menu.dataset.username;
    memberList.querySelectorAll('.member-menu[open]').forEach((other) => { if (other !== menu) other.open = false; });
  } else if (openMenuFor === menu.dataset.username) {
    openMenuFor = null;
  }
}, true);

// Clicking anywhere else closes the open menu
document.addEventListener('click', (click) => {
  if (!click.target.closest('.member-menu')) {
    memberList.querySelectorAll('.member-menu[open]').forEach((menu) => { menu.open = false; });
  }
});

memberList.addEventListener('click', async (click) => {
  const button = click.target.closest('.change-role');
  if (!button) return;
  if (button.dataset.role === 'member' && button.textContent.startsWith('Step down')
      && !confirm('Step down as admin? You will not be able to host events for this group.')) return;
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

memberList.addEventListener('change', async (change) => {
  const box = change.target.closest('.custom-role-toggle');
  if (!box) return;
  const menu = box.closest('.member-menu');
  const roleIds = [...menu.querySelectorAll('.custom-role-toggle:checked')].map((checked) => Number(checked.value));
  menu.querySelectorAll('.custom-role-toggle').forEach((other) => { other.disabled = true; });
  const result = await setMemberCustomRoles(groupId, box.dataset.username, roleIds);
  if (!result.ok) setGroupStatus(result.message || 'Could not change their roles.', 'red');
  showGroupPage();
});

// ===== Custom roles card =====
const roleStatus = document.getElementById('roleStatus');

document.getElementById('roleForm').addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const nameInput = document.getElementById('roleName');
  const result = await createGroupRole(groupId, nameInput.value.trim(), document.getElementById('roleColor').value);
  if (!result.ok) {
    setStatus(roleStatus, result.message || 'Could not add the role.', 'red');
    return;
  }
  setStatus(roleStatus, `Added "${nameInput.value.trim()}". Give it to members from the ⋯ menu next to their name.`, 'green');
  nameInput.value = '';
  showGroupPage();
});

const roleList = document.getElementById('roleList');

roleList.addEventListener('change', async (change) => {
  const select = change.target.closest('.role-color-select');
  if (!select) return;
  const result = await updateGroupRole(groupId, select.closest('.role-row').dataset.roleId, { color: select.value });
  setStatus(roleStatus, result.ok ? '' : (result.message || 'Could not change the color.'), result.ok ? '' : 'red');
  showGroupPage();
});

roleList.addEventListener('click', async (click) => {
  const roleId = click.target.closest('.role-row')?.dataset.roleId;
  const rename = click.target.closest('.rename-role');
  const remove = click.target.closest('.delete-role');
  if (!roleId || (!rename && !remove)) return;

  let result;
  if (rename) {
    const name = prompt('New name for this role:', rename.dataset.name);
    if (name === null || name.trim() === '' || name.trim() === rename.dataset.name) return;
    result = await updateGroupRole(groupId, roleId, { name: name.trim() });
  } else {
    if (!confirm(`Delete the "${remove.dataset.name}" role? Everyone who has it will lose it.`)) return;
    result = await deleteGroupRole(groupId, roleId);
  }
  setStatus(roleStatus, result.ok ? '' : (result.message || 'Something went wrong. Please try again.'), result.ok ? '' : 'red');
  if (result.ok) showGroupPage();
});

// ===== Start =====
showGroupPage();

setInterval(() => {
  if (!document.hidden) loadChat();
}, CHAT_REFRESH_MS);
