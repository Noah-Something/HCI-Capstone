// ===== HokieConnect – shared group code (used by groups.html, group.html and create-group.html) =====
// Talks to the server's /api/groups routes. Uses apiRequest from events.js, so load events.js first.

// filters (all optional): { q, category, mine: true }
// Returns a list of groups, or null if the server could not be reached
async function loadGroups(filters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.category) params.set('category', filters.category);
  if (filters.mine) params.set('mine', '1');
  const result = await apiRequest(`/api/groups${params.toString() ? `?${params}` : ''}`);
  if (result.offline || !result.ok) return null;
  return result.data.groups;
}

// One group: { group, members, events }, or null if it does not exist
async function loadGroup(id) {
  const result = await apiRequest(`/api/groups/${id}`);
  if (result.offline || !result.ok) return null;
  return result.data;
}

// Returns { ok, id, message }
async function createGroup(details) {
  const result = await apiRequest('/api/groups', { method: 'POST', body: JSON.stringify(details) });
  if (result.offline) return { ok: false, message: 'Creating groups needs the server. Run server.js and open http://localhost:3000.' };
  return { ok: result.ok, id: result.data.id, message: result.data.message };
}

// Join or leave, returns { ok, message }
async function joinGroup(id) {
  const result = await apiRequest(`/api/groups/${id}/join`, { method: 'POST' });
  return { ok: !result.offline && result.ok, message: result.offline ? 'Could not reach the server.' : result.data.message };
}

async function leaveGroup(id) {
  const result = await apiRequest(`/api/groups/${id}/membership`, { method: 'DELETE' });
  return { ok: !result.offline && result.ok, message: result.offline ? 'Could not reach the server.' : result.data.message };
}

// Admins only: role is 'admin' or 'member', returns { ok, message }
async function setMemberRole(groupId, username, role) {
  const result = await apiRequest(`/api/groups/${groupId}/members/${encodeURIComponent(username)}`, {
    method: 'PUT', body: JSON.stringify({ role })
  });
  return { ok: !result.offline && result.ok, message: result.offline ? 'Could not reach the server.' : result.data.message };
}

// Turns an apiRequest result into { ok, message, data }
function groupResult(result) {
  if (result.offline) return { ok: false, message: 'Could not reach the server.', data: {} };
  return { ok: result.ok, message: result.data.message, data: result.data };
}

// ===== Group chat (members only) =====
// Returns { ok, messages } or { ok: false, message }
async function loadGroupChat(groupId) {
  const result = groupResult(await apiRequest(`/api/groups/${groupId}/messages`));
  return { ...result, messages: result.data.messages || [] };
}

async function sendGroupMessage(groupId, body) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }));
}

async function deleteGroupMessage(groupId, messageId) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/messages/${messageId}`, { method: 'DELETE' }));
}

// ===== Custom roles (the creator and admins only) =====
async function createGroupRole(groupId, name, color) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/roles`, { method: 'POST', body: JSON.stringify({ name, color }) }));
}

// changes: { name, color }, either can be left out
async function updateGroupRole(groupId, roleId, changes) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/roles/${roleId}`, { method: 'PUT', body: JSON.stringify(changes) }));
}

async function deleteGroupRole(groupId, roleId) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/roles/${roleId}`, { method: 'DELETE' }));
}

// Replaces the custom roles a member holds with roleIds
async function setMemberCustomRoles(groupId, username, roleIds) {
  return groupResult(await apiRequest(`/api/groups/${groupId}/members/${encodeURIComponent(username)}/roles`, {
    method: 'PUT', body: JSON.stringify({ roleIds })
  }));
}

// The categories groups and events share (the profile interests list)
async function loadGroupCategories() {
  try {
    const options = await (await fetch('/api/profile/options')).json();
    return options.interests;
  } catch (error) {
    return [];
  }
}

// "12 members · 2 upcoming events"
function formatGroupCounts(group) {
  const members = group.memberCount === 1 ? '1 member' : `${group.memberCount} members`;
  const events = group.upcomingEventCount === 1 ? '1 upcoming event' : `${group.upcomingEventCount} upcoming events`;
  return `${members} · ${events}`;
}
