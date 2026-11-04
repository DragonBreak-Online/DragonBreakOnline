const config = window.DRAGONBREAK_DASHBOARD_CONFIG || {}
const apiBaseUrl = (config.apiBaseUrl || '').replace(/\/$/, '')
const tokenKey = 'dragonbreak.dashboard.token'

const state = {
  token: localStorage.getItem(tokenKey) || '',
  user: null,
  players: [],
  selectedProfileId: null,
  requirements: [],
  assignments: [],
  access: null,
  roles: {},
  knownPermissions: [],
  selectedRequirementId: '',
  assignGroup: '',
  activeView: 'dragonbaron',
  dragonbaron: null,
  dbHeld: [],
  dbScope: null,
  dbScopeGuildId: '',
  dbScopeGuildName: '',
  bansList: [],
  modEvents: [],
}

const el = id => document.getElementById(id)

const nodes = {
  apiStatus: el('apiStatus'),
  statusText: el('statusText'),
  userName: el('userName'),
  loginButton: el('loginButton'),
  logoutButton: el('logoutButton'),
  signedOut: el('signedOut'),
  dragonbaronView: el('dragonbaronView'),
  ticketsView: el('ticketsView'),
  ticketsTableBody: el('ticketsTableBody'),
  refreshTicketsBtn: el('refreshTicketsBtn'),
  ticketReplyBox: el('ticketReplyBox'),
  ticketReplyBoxTitle: el('ticketReplyBoxTitle'),
  ticketReplyInput: el('ticketReplyInput'),
  sendTicketReplyBtn: el('sendTicketReplyBtn'),
  closeTicketReplyBoxBtn: el('closeTicketReplyBoxBtn'),
  closeTicketActionBtn: el('closeTicketActionBtn'),
  accessView: el('accessView'),
  playersView: el('playersView'),
  bansView: el('bansView'),
  bansStats: el('bansStats'),
  bansActiveCount: el('bansActiveCount'),
  bansActiveTable: el('bansActiveTable'),
  bansModCount: el('bansModCount'),
  bansModTable: el('bansModTable'),
  factionsView: el('factionsView'),
  permissionsView: el('permissionsView'),
  dbStats: el('dbStats'),
  dbCopyAdminInviteBtn: el('dbCopyAdminInviteBtn'),
  dbCopyModInviteBtn: el('dbCopyModInviteBtn'),
  dbFlushDigestBtn: el('dbFlushDigestBtn'),
  dbLastRunLabel: el('dbLastRunLabel'),
  dbRefreshBtn: el('dbRefreshBtn'),
  dbSettingsForm: el('dbSettingsForm'),
  dbSwitchAsk: el('dbSwitchAsk'),
  dbSwitchModel: el('dbSwitchModel'),
  dbSwitchDetect: el('dbSwitchDetect'),
  dbReportMode: el('dbReportMode'),
  dbStaffAuthors: el('dbStaffAuthors'),
  dbOocMode: el('dbOocMode'),
  dbOocPrefilter: el('dbOocPrefilter'),
  dbCallsPerHour: el('dbCallsPerHour'),
  dbCallsPerRun: el('dbCallsPerRun'),
  dbReportsPerHour: el('dbReportsPerHour'),
  dbSaveSettingsBtn: el('dbSaveSettingsBtn'),
  dbTimeoutForm: el('dbTimeoutForm'),
  dbTimeoutUserId: el('dbTimeoutUserId'),
  dbTimeoutGuildSelect: el('dbTimeoutGuildSelect'),
  dbTimeoutDuration: el('dbTimeoutDuration'),
  dbTimeoutReason: el('dbTimeoutReason'),
  dbTimeoutForce: el('dbTimeoutForce'),
  dbCheckTimeoutBtn: el('dbCheckTimeoutBtn'),
  dbApplyTimeoutBtn: el('dbApplyTimeoutBtn'),
  dbTimeoutResults: el('dbTimeoutResults'),
  dbGuildCount: el('dbGuildCount'),
  dbGuildsTable: el('dbGuildsTable'),
  dbScopePanel: el('dbScopePanel'),
  dbScopeGuildName: el('dbScopeGuildName'),
  dbCloseScopeBtn: el('dbCloseScopeBtn'),
  dbScopeTable: el('dbScopeTable'),
  dbRecentCount: el('dbRecentCount'),
  dbInfractionsTable: el('dbInfractionsTable'),
  dbHeldCount: el('dbHeldCount'),
  dbHeldTable: el('dbHeldTable'),
  dbClientFlagsCount: el('dbClientFlagsCount'),
  dbClientFlagsTable: el('dbClientFlagsTable'),
  dbAnticheatFlagsCount: el('dbAnticheatFlagsCount'),
  dbAnticheatFlagsTable: el('dbAnticheatFlagsTable'),
  accessForm: el('accessForm'),
  serverLockedInput: el('serverLockedInput'),
  lockedRoleIdsInput: el('lockedRoleIdsInput'),
  lockedDiscordIdsInput: el('lockedDiscordIdsInput'),
  whitelistRoleIdInput: el('whitelistRoleIdInput'),
  bannedRoleIdInput: el('bannedRoleIdInput'),
  accessCheckForm: el('accessCheckForm'),
  accessCheckDiscordId: el('accessCheckDiscordId'),
  accessCheckResult: el('accessCheckResult'),
  playerCount: el('playerCount'),
  playerSearchInput: el('playerSearchInput'),
  newPlayerButton: el('newPlayerButton'),
  playersRefreshButton: el('playersRefreshButton'),
  playersTable: el('playersTable'),
  selectedPlayerLabel: el('selectedPlayerLabel'),
  playerForm: el('playerForm'),
  playerDiscordIdInput: el('playerDiscordIdInput'),
  playerUsernameInput: el('playerUsernameInput'),
  playerDisplayNameInput: el('playerDisplayNameInput'),
  playerNotesInput: el('playerNotesInput'),
  whitelistPlayerButton: el('whitelistPlayerButton'),
  banPlayerButton: el('banPlayerButton'),
  playerDeviceLinks: el('playerDeviceLinks'),
  playerAssignmentsTable: el('playerAssignmentsTable'),
  playerFactionForm: el('playerFactionForm'),
  playerRequirementSelect: el('playerRequirementSelect'),
  playerFactionNotesInput: el('playerFactionNotesInput'),
  stats: el('stats'),
  scopeFilter: el('scopeFilter'),
  groupFilter: el('groupFilter'),
  refreshButton: el('refreshButton'),
  requirementsTable: el('requirementsTable'),
  assignmentsTable: el('assignmentsTable'),
  assignGroupSelect: el('assignGroupSelect'),
  requirementSelect: el('requirementSelect'),
  selectedSlot: el('selectedSlot'),
  slotCount: el('slotCount'),
  assignmentCount: el('assignmentCount'),
  assignmentForm: el('assignmentForm'),
  discordIdInput: el('discordIdInput'),
  slotSelect: el('slotSelect'),
  playerSlotSelect: el('playerSlotSelect'),
  playerNameInput: el('playerNameInput'),
  notesInput: el('notesInput'),
  rolesTable: el('rolesTable'),
  roleCount: el('roleCount'),
  roleForm: el('roleForm'),
  roleIdInput: el('roleIdInput'),
  roleNameInput: el('roleNameInput'),
  selectedRole: el('selectedRole'),
  permissionChecks: el('permissionChecks'),
  toast: el('toast'),
}

function toast(message) {
  nodes.toast.textContent = message
  nodes.toast.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => nodes.toast.classList.add('hidden'), 3200)
}

// Character slot: '' in a select means "all characters" (slot null on the
// backend); '0'..'2' are individual characters, shown to admins as 1-based.
function slotFromSelect(value) {
  return value === '' || value === null || value === undefined ? null : Number(value)
}

function slotLabel(slot) {
  return slot === null || slot === undefined ? 'All' : `Character ${Number(slot) + 1}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function api(path, options = {}) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with ${res.status}`)
  }
  return data
}

function captureTokenFromUrl() {
  const url = new URL(window.location.href)
  // Token arrives in the URL fragment; keep the legacy ?token= query as a
  // fallback for one deploy cycle (older backends still redirect with it).
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
  const token = hashParams.get('token') || url.searchParams.get('token')
  if (!token) return
  state.token = token
  localStorage.setItem(tokenKey, token)
  // replaceState with the bare pathname drops both the query and the fragment.
  window.history.replaceState({}, '', url.pathname)
}

async function login() {
  if (config.siteLoginUrl) {
    window.location.href = config.siteLoginUrl
    return
  }
  const redirect = `${window.location.origin}${window.location.pathname}`
  const data = await fetch(`${apiBaseUrl}/auth/dashboard/url?redirect=${encodeURIComponent(redirect)}`)
    .then(res => res.json())
  if (!data.url) throw new Error(data.error || 'OAuth URL unavailable')
  window.location.href = data.url
}

async function logout() {
  try {
    if (state.token) await api('/auth/dashboard/logout', { method: 'POST' })
  } catch {
    // Local logout still matters even if the session already expired.
  }
  state.token = ''
  state.user = null
  localStorage.removeItem(tokenKey)
  renderAuth()
}

async function loadSession() {
  if (state.token) {
    try {
      const data = await api('/auth/dashboard/me')
      state.user = data.user
      return
    } catch {
      state.token = ''
      localStorage.removeItem(tokenKey)
    }
  }
  if (config.siteLoginUrl) {
    try {
      const res = await fetch('/api/site/manage/session', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        if (data.token && data.user) {
          state.token = data.token
          state.user = data.user
          localStorage.setItem(tokenKey, data.token)
        }
      }
    } catch {
      // Not signed in via site cookie yet
    }
  }
}

async function loadFactions() {
  const data = await api('/api/faction-whitelist')
  state.requirements = data.requirements || []
  state.assignments = data.assignments || []
}

async function loadPlayers() {
  const data = await api('/api/players')
  state.players = data.players || []
}

async function loadAccess() {
  state.access = await api('/api/server-access')
}

async function loadPermissions() {
  const data = await api('/api/role-permissions')
  state.roles = data.roles || {}
  state.userPerms = data.users || {}
  state.knownPermissions = data.knownPermissions || []
}

function renderAuth() {
  const signedIn = !!state.user
  nodes.apiStatus.textContent = signedIn ? 'Online' : 'Offline'
  nodes.apiStatus.classList.toggle('online', signedIn)
  nodes.userName.textContent = signedIn ? state.user.username : 'Signed out'
  nodes.statusText.textContent = signedIn
    ? `Signed in as ${state.user.username}`
    : 'Connect with Discord to manage the realm.'
  nodes.loginButton.classList.toggle('hidden', signedIn)
  nodes.logoutButton.classList.toggle('hidden', !signedIn)
  nodes.signedOut.classList.toggle('hidden', signedIn)
  document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'))
  if (signedIn) renderActiveView()
}

function renderActiveView() {
  const titles = {
    dragonbaron: 'Dragonbaron Bot & Multi-Discord Management',
    tickets: 'Support Tickets & Dragonbaron Forum Relay',
    access: 'Server Access & Whitelist Control',
    players: 'Player Directory & Characters',
    bans: 'Active Bans & Moderation Journal',
    factions: 'Hold & Faction Assignments',
    permissions: 'Dashboard Role Access (RBAC)',
  }
  const h1 = document.querySelector('.topbar h1')
  if (h1 && titles[state.activeView]) h1.textContent = titles[state.activeView]
  if (nodes.dragonbaronView) nodes.dragonbaronView.classList.toggle('hidden', state.activeView !== 'dragonbaron')
  if (nodes.ticketsView) nodes.ticketsView.classList.toggle('hidden', state.activeView !== 'tickets')
  if (state.activeView === 'tickets') loadTickets()
  if (nodes.bansView) nodes.bansView.classList.toggle('hidden', state.activeView !== 'bans')
  nodes.accessView.classList.toggle('hidden', state.activeView !== 'access')
  nodes.playersView.classList.toggle('hidden', state.activeView !== 'players')
  nodes.factionsView.classList.toggle('hidden', state.activeView !== 'factions')
  nodes.permissionsView.classList.toggle('hidden', state.activeView !== 'permissions')
  document.querySelectorAll('.nav-button').forEach(button => {
    button.classList.toggle('active', button.dataset.view === state.activeView)
  })
}

function selectedPlayer() {
  return state.players.find(player => player.profileId === state.selectedProfileId) || null
}

// A ban ref finds the banned account and every account the device check links to it
function filteredPlayers() {
  const q = String(nodes.playerSearchInput.value || '').trim().toLowerCase()
  if (!q) return state.players
  return state.players.filter(player =>
    String(player.profileId).includes(q) ||
    String(player.discordId || '').toLowerCase().includes(q) ||
    String(player.username || '').toLowerCase().includes(q) ||
    String(player.displayName || '').toLowerCase().includes(q) ||
    (player.characterNames || []).some(c => String(c).toLowerCase().includes(q)) ||
    String(player.ban?.ref || '').toLowerCase().includes(q) ||
    (player.device?.links || []).some(link => String(link.banRef).toLowerCase().includes(q))
  )
}

function deviceText(player) {
  const links = player.device?.links || []
  if (!links.length) return '-'
  return links.map(link => (link.notAlt ? `not an alt (${link.banRef})` : `linked to ban ${link.banRef}`)).join(', ')
}

function renderPlayers() {
  const rows = filteredPlayers()
  nodes.playerCount.textContent = `${rows.length} shown`
  nodes.playersTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Profile</th>
          <th>Discord Name</th>
          <th>Characters</th>
          <th>Discord ID</th>
          <th>Access</th>
          <th>Device</th>
          <th>Factions</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(player => `
          <tr class="${player.profileId === state.selectedProfileId ? 'selected' : ''}">
            <td>#${player.profileId}</td>
            <td>${escapeHtml(player.displayName || player.username || 'Unnamed')}</td>
            <td>${escapeHtml((player.characterNames || []).join(', ') || '-')}</td>
            <td>${escapeHtml(player.discordId)}</td>
            <td><span class="tag ${player.access?.allowed ? '' : 'locked'}">${escapeHtml(player.access?.allowed ? 'allowed' : (player.access?.error || 'blocked'))}</span>${player.ban ? ` <span class="tag locked">banned${player.ban.ref ? ` ${escapeHtml(player.ban.ref)}` : ''}</span>` : ''}</td>
            <td>${escapeHtml(deviceText(player))}</td>
            <td>${escapeHtml((player.assignments || []).map(a => a.requirement ? `${a.requirement.group} ${a.requirement.rank}` : a.requirementId).join(', '))}</td>
            <td><button class="ghost mini" data-select-player="${player.profileId}" type="button">Open</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
  renderPlayerDetail()
}

function renderPlayerDetail() {
  const player = selectedPlayer()
  nodes.selectedPlayerLabel.textContent = player ? `Profile #${player.profileId}` : 'New player'
  nodes.playerDiscordIdInput.value = player?.discordId || ''
  nodes.playerDiscordIdInput.disabled = !!player
  nodes.playerUsernameInput.value = player?.username || ''
  nodes.playerDisplayNameInput.value = player?.displayName || ''
  nodes.playerNotesInput.value = player?.notes || ''
  nodes.whitelistPlayerButton.disabled = !player
  nodes.banPlayerButton.disabled = !player
  nodes.whitelistPlayerButton.textContent = player?.access?.roles?.includes(state.access?.whitelistRoleId)
    ? 'Remove Whitelist'
    : 'Add Whitelist'
  nodes.banPlayerButton.textContent = playerIsBanned(player)
    ? 'Remove Ban'
    : 'Add Ban'
  nodes.playerDeviceLinks.innerHTML = player ? renderPlayerDeviceLinks(player) : ''
  nodes.playerAssignmentsTable.innerHTML = player
    ? renderPlayerAssignments(player)
    : '<div class="empty-row">Save the player before assigning factions.</div>'
  nodes.playerRequirementSelect.innerHTML = state.requirements
    .map(req => `<option value="${escapeHtml(req.id)}">${escapeHtml(req.group)} - ${escapeHtml(req.rank)}</option>`)
    .join('')
  nodes.playerFactionForm.querySelector('button[type="submit"]').disabled = !player
}

// Report-only device check: a PC this player shares with a banned account, as its ban ref; a lead, not proof
function renderPlayerDeviceLinks(player) {
  const links = player.device?.links || []
  if (!links.length) return '<div class="empty-row">No PC shared with a banned account.</div>'
  return `
    <table>
      <thead>
        <tr>
          <th>Linked ban</th>
          <th>Shared PC</th>
          <th>Login</th>
          <th>First seen</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${links.map(link => `
          <tr>
            <td>${escapeHtml(link.banRef)}${link.notAlt ? ' <span class="tag">not an alt</span>' : ''}</td>
            <td>${escapeHtml(link.sharedAccounts >= 2 ? `yes, ${link.sharedAccounts} other accounts` : link.sharedAccounts === 1 ? '1 other account' : 'no')}</td>
            <td>${escapeHtml(link.bound ? 'PC-bound' : 'older launcher')}</td>
            <td>${escapeHtml(link.createdVsBanDays === null ? '-' : link.createdVsBanDays >= 0 ? `${link.createdVsBanDays} d after the ban` : `${-link.createdVsBanDays} d before the ban`)}</td>
            <td><button class="${link.notAlt ? 'ghost' : 'danger'} mini" data-not-alt="${escapeHtml(link.banRef)}" data-not-alt-value="${link.notAlt ? 'false' : 'true'}" type="button">${link.notAlt ? 'Undo' : 'Not an alt'}</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function renderPlayerAssignments(player) {
  const assignments = player.assignments || []
  if (!assignments.length) return '<div class="empty-row">No faction slots assigned.</div>'
  return `
    <table>
      <thead>
        <tr>
          <th>Group</th>
          <th>Rank</th>
          <th>Character</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${assignments.map(assignment => `
          <tr>
            <td>${escapeHtml(assignment.requirement?.group || assignment.requirementId)}</td>
            <td>${escapeHtml(assignment.requirement?.rank || '')}</td>
            <td>${escapeHtml(slotLabel(assignment.slot))}</td>
            <td><button class="danger mini" data-delete-player-assignment="${escapeHtml(assignment.id)}" type="button">Remove</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function renderAccess() {
  const access = state.access || {}
  nodes.serverLockedInput.checked = access.serverLocked === true
  nodes.lockedRoleIdsInput.value = (access.lockedRoleIds || []).join('\n')
  nodes.lockedDiscordIdsInput.value = (access.lockedDiscordIds || []).join('\n')
  nodes.whitelistRoleIdInput.value = access.whitelistRoleId || ''
  nodes.bannedRoleIdInput.value = access.bannedRoleId || ''
}

function filteredRequirements() {
  const scope = nodes.scopeFilter.value
  const group = nodes.groupFilter.value
  return state.requirements.filter(req =>
    (!scope || req.scope === scope) &&
    (!group || req.group === group)
  )
}

function renderStats() {
  const uniqueSlots = state.requirements.filter(req => req.capacity === 1).length
  const openUnique = state.requirements.filter(req => req.capacity === 1 && req.assigned === 0).length
  const repeatable = state.requirements.filter(req => req.capacity === null).length
  nodes.stats.innerHTML = [
    ['Assignments', state.assignments.length],
    ['Unique Open', openUnique],
    ['Unique Slots', uniqueSlots],
    ['Repeatable Ranks', repeatable],
  ].map(([label, value]) => `
    <div class="stat">
      <strong>${value}</strong>
      <span class="muted">${label}</span>
    </div>
  `).join('')
}

function renderFilters() {
  const groups = [...new Set(state.requirements.map(req => req.group))].sort()
  const selected = nodes.groupFilter.value
  nodes.groupFilter.innerHTML = '<option value="">All</option>' + groups
    .map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    .join('')
  nodes.groupFilter.value = groups.includes(selected) ? selected : ''
}

function renderRequirements() {
  const rows = filteredRequirements()
  nodes.slotCount.textContent = `${rows.length} shown`
  nodes.requirementsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Scope</th>
          <th>Group</th>
          <th>Rank</th>
          <th>Slots</th>
          <th>Permission</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(req => `
          <tr class="${req.id === state.selectedRequirementId ? 'selected' : ''}">
            <td><span class="tag">${escapeHtml(req.scope)}</span></td>
            <td>${escapeHtml(req.group)}</td>
            <td>${escapeHtml(req.rank)}</td>
            <td>${req.capacity === null ? 'Open' : `${req.assigned}/${req.capacity}`}</td>
            <td>${escapeHtml(req.permission)}</td>
            <td><button class="ghost mini" data-select="${escapeHtml(req.id)}" type="button">Select</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `

  renderAssignForm()
}

function renderAssignForm() {
  const groups = [...new Set(state.requirements.map(req => req.group))]
  if (!groups.includes(state.assignGroup)) {
    state.assignGroup = groups[0] || ''
  }
  nodes.assignGroupSelect.innerHTML = groups
    .map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    .join('')
  nodes.assignGroupSelect.value = state.assignGroup
  renderRoleSelect()
}

function renderRoleSelect() {
  const roles = state.requirements.filter(req => req.group === state.assignGroup)
  nodes.requirementSelect.innerHTML = roles
    .map(req => `<option value="${escapeHtml(req.id)}">${escapeHtml(req.rank)}</option>`)
    .join('')
  if (!roles.some(req => req.id === state.selectedRequirementId)) {
    state.selectedRequirementId = roles[0] ? roles[0].id : ''
  }
  nodes.requirementSelect.value = state.selectedRequirementId
  renderSelectedSlot()
}

function renderSelectedSlot() {
  const req = state.requirements.find(item => item.id === state.selectedRequirementId)
  nodes.selectedSlot.textContent = req ? `${req.group} - ${req.rank}` : 'No slot selected'
}

function renderAssignments() {
  const byReq = new Map(state.requirements.map(req => [req.id, req]))
  nodes.assignmentCount.textContent = `${state.assignments.length} total`
  nodes.assignmentsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Discord ID</th>
          <th>Character</th>
          <th>Group</th>
          <th>Rank</th>
          <th>Permission</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${state.assignments.map(assignment => {
          const req = byReq.get(assignment.requirementId) || {}
          return `
            <tr>
              <td>${escapeHtml(assignment.playerName || 'Unnamed')}</td>
              <td>${escapeHtml(assignment.discordId)}</td>
              <td>${escapeHtml(slotLabel(assignment.slot))}</td>
              <td>${escapeHtml(req.group || '')}</td>
              <td>${escapeHtml(req.rank || '')}</td>
              <td>${escapeHtml(req.permission || '')}</td>
              <td><button class="danger mini" data-delete-assignment="${escapeHtml(assignment.id)}" type="button">Remove</button></td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  `
}

function renderFactions() {
  renderStats()
  renderFilters()
  renderRequirements()
  renderAssignments()
}

function renderPermissionChecks(selected = []) {
  nodes.permissionChecks.innerHTML = state.knownPermissions.map(permission => `
    <label class="check-row">
      <input type="checkbox" value="${escapeHtml(permission)}" ${selected.includes(permission) ? 'checked' : ''}>
      <span>${escapeHtml(permission)}</span>
    </label>
  `).join('')
}

const USER_PRESETS = {
  admin: [
    'admin.*', 'dashboard.access', 'permissions.manage', 'players.view', 'players.manage',
    'server.access.view', 'server.access.manage', 'factions.view', 'factions.manage',
    'lore.write', 'rules.write', 'staff.whitelist_info', 'dragonbaron.view',
    'dragonbaron.manage', 'dragonbaron.held', 'dragonbaron.moderate'
  ],
  mod: [
    'dashboard.access', 'players.view', 'players.manage', 'server.access.view',
    'factions.view', 'factions.manage', 'staff.whitelist_info', 'dragonbaron.view',
    'dragonbaron.moderate'
  ],
  viewer: [
    'dashboard.access', 'players.view', 'server.access.view', 'factions.view', 'dragonbaron.view'
  ]
}

function renderUserPermissionChecks(selected = USER_PRESETS.admin) {
  if (!nodes.userPermissionChecks) return
  nodes.userPermissionChecks.innerHTML = state.knownPermissions.map(permission => `
    <label class="check-row">
      <input type="checkbox" value="${escapeHtml(permission)}" ${selected.includes(permission) ? 'checked' : ''}>
      <span>${escapeHtml(permission)}</span>
    </label>
  `).join('')
}

function renderRoles() {
  const uEntries = Object.entries(state.userPerms || {})
  if (nodes.userPermCount && nodes.userPermsTable) {
    nodes.userPermCount.textContent = `${uEntries.length} authorized user${uEntries.length === 1 ? '' : 's'}`
    nodes.userPermsTable.innerHTML = uEntries.length ? `
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Discord ID</th>
            <th>Permissions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${uEntries.map(([uid, u]) => `
            <tr>
              <td><strong>${escapeHtml(u.name || uid)}</strong></td>
              <td><code>${escapeHtml(uid)}</code></td>
              <td>${escapeHtml((u.permissions || []).includes('admin.*') ? 'Full Admin (admin.* + all permissions)' : (u.permissions || []).join(', '))}</td>
              <td>
                <button class="ghost mini" data-edit-user-perm="${escapeHtml(uid)}" type="button">Edit</button>
                <button class="danger mini" data-delete-user-perm="${escapeHtml(uid)}" type="button">Revoke</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="empty-row">No individual user overrides configured yet.</div>'
  }
  if (nodes.userPermPlayerSelect) {
    const playersSorted = [...(state.players || [])].sort((a, b) => String(a.displayName || a.username || '').localeCompare(String(b.displayName || b.username || '')))
    nodes.userPermPlayerSelect.innerHTML = [
      '<option value="">-- Select a registered player to fill ID &amp; Name --</option>',
      ...playersSorted.filter(p => p.discordId).map(p => `<option value="${escapeHtml(p.discordId)}" data-pname="${escapeHtml(p.displayName || p.username || p.discordId)}">${escapeHtml(p.displayName || p.username)} (#${p.profileId} - ${escapeHtml(p.discordId)})</option>`)
    ].join('')
  }
  renderUserPermissionChecks()

  const entries = Object.entries(state.roles)
  nodes.roleCount.textContent = `${entries.length} configured`
  nodes.rolesTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Role ID</th>
          <th>Permissions</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(([roleId, role]) => `
          <tr>
            <td>${escapeHtml(role.name)}</td>
            <td>${escapeHtml(roleId)}</td>
            <td>${escapeHtml((role.permissions || []).join(', '))}</td>
            <td>
              <button class="ghost mini" data-edit-role="${escapeHtml(roleId)}" type="button">Edit</button>
              <button class="danger mini" data-delete-role="${escapeHtml(roleId)}" type="button">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
  renderPermissionChecks()
}

async function loadBans() {
  const data = await api('/api/dragonbaron/bans')
  state.bansList = data.bans || []
  state.modEvents = data.moderationEvents || []
  state.punishSources = data.sources || {}
}

function renderBans() {
  if (!nodes.bansStats) return
  const bans = state.bansList || []
  const mods = state.modEvents || []
  const linkedPlayers = (state.players || []).filter(p => (p.device?.links || []).some(l => !l.notAlt)).length
  nodes.bansStats.innerHTML = `
    <div class="stat">
      <span class="muted">Active Punishments</span>
      <strong>${bans.length}</strong>
      <span class="muted">Bans, suspensions, timeouts &amp; hold jail</span>
    </div>
    <div class="stat">
      <span class="muted">Punishment &amp; Mod History</span>
      <strong>${mods.length}</strong>
      <span class="muted">Discipline, bans, lifts, kicks &amp; timeouts</span>
    </div>
    <div class="stat">
      <span class="muted">Flagged Shared PCs</span>
      <strong>${linkedPlayers}</strong>
      <span class="muted">Accounts sharing a PC with a ban</span>
    </div>
    <div class="stat">
      <span class="muted">Total Registered Players</span>
      <strong>${(state.players || []).length}</strong>
      <span class="muted">Across all profiles</span>
    </div>
  `
  nodes.bansActiveCount.textContent = `${bans.length} active`
  nodes.bansActiveTable.innerHTML = bans.length ? `
    <table style="--label-2:'Kind';--label-3:'Player / Character';--label-4:'Discord ID';--label-5:'Reason';--label-6:'By Staff';--label-7:'Date';--label-8:'Actions'">
      <caption class="hidden">Active server punishments and bans</caption>
      <thead>
        <tr>
          <th scope="col">Ref</th>
          <th scope="col">Kind</th>
          <th scope="col">Player / Character</th>
          <th scope="col">Discord ID</th>
          <th scope="col">Reason</th>
          <th scope="col">By Staff</th>
          <th scope="col">Started</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${bans.map(b => `
          <tr>
            <th scope="row"><span class="tag locked">${escapeHtml(b.ref || 'ACTIVE')}</span></th>
            <td><span class="tag">${escapeHtml(b.kind || 'ban')}</span></td>
            <td>${escapeHtml(b.username)}${b.profileId ? ` (#${b.profileId})` : ''}</td>
            <td><code>${escapeHtml(b.discordId || '-')}</code></td>
            <td>${escapeHtml(b.reason)}</td>
            <td>${escapeHtml(b.bannedBy)}</td>
            <td>${escapeHtml((b.bannedAt || '').replace('T', ' ').slice(0, 16))}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap">
              ${b.threadUrl ? `<a class="ghost mini" href="${escapeHtml(b.threadUrl)}" target="_blank" rel="noopener" style="text-decoration:none">Discord Thread</a>` : ''}
              ${b.profileId && String(b.kind).includes('ban') ? `<button class="ghost mini" data-unban-profile="${b.profileId}" type="button">Unban</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div class="empty-row">No active punishments.</div>'

  nodes.bansModCount.textContent = `${mods.length} records`
  nodes.bansModTable.innerHTML = mods.length ? `
    <table style="--label-2:'Source / State';--label-3:'Target';--label-4:'By Staff';--label-5:'Reason';--label-6:'Time'">
      <caption class="hidden">Recent punishment and moderation records</caption>
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col">Source / State</th>
          <th scope="col">Target</th>
          <th scope="col">Staff</th>
          <th scope="col">Reason / Notes</th>
          <th scope="col">Time</th>
        </tr>
      </thead>
      <tbody>
        ${mods.map(m => `
          <tr>
            <th scope="row"><span class="tag ${m.active ? 'locked' : ''}">${escapeHtml(m.kind)}${m.ref ? ` ${escapeHtml(m.ref)}` : ''}</span></th>
            <td><span class="muted">${escapeHtml(m.source || 'server')} &middot; ${escapeHtml(m.state || 'recorded')}</span></td>
            <td>${escapeHtml(m.username || m.discordId || '-')}${m.profileId ? ` (#${m.profileId})` : ''}${m.discordId ? ` <code>${escapeHtml(m.discordId)}</code>` : ''}</td>
            <td>${escapeHtml(m.actor || '-')}</td>
            <td>${escapeHtml(m.reason || '-')}${m.until ? ` (until ${escapeHtml(String(m.until).replace('T', ' ').slice(0, 16))})` : ''}</td>
            <td>${escapeHtml((m.at || '').replace('T', ' ').slice(0, 16))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div class="empty-row">No recent moderation events recorded.</div>'
}

async function loadDragonbaron(force = false) {
  state.dragonbaron = await api(`/api/dragonbaron/overview${force ? '?refresh=1' : ''}`)
  if (state.dragonbaron?.viewerPermissions?.canViewHeld) {
    try {
      const heldData = await api('/api/dragonbaron/held')
      state.dbHeld = heldData.items || []
    } catch {
      state.dbHeld = []
    }
  } else {
    state.dbHeld = []
  }
}

function renderDragonbaron() {
  const db = state.dragonbaron
  if (!db) return
  const sw = db.switches || {}
  const st = db.settings || {}
  const rt = db.runtime || {}
  const guilds = db.guilds || []
  const c24 = rt.counts24h || {}

  nodes.dbStats.innerHTML = `
    <div class="stat">
      <span class="muted">Bot Switches</span>
      <strong>${escapeHtml(`detect=${sw.detect} ? ask=${sw.ask}`)}</strong>
      <span class="muted">model=${escapeHtml(sw.model)} ? mode=${escapeHtml(st.reportMode)}</span>
    </div>
    <div class="stat">
      <span class="muted">Connected Discords</span>
      <strong>${guilds.filter(g => g.monitoringOn).length} / ${guilds.length}</strong>
      <span class="muted">${guilds.reduce((n, g) => n + (g.areas || 0), 0)} monitored areas</span>
    </div>
    <div class="stat">
      <span class="muted">24h Infractions</span>
      <strong>${(c24.reported || 0) + (c24.digest || 0)} reported</strong>
      <span class="muted">benign ${c24.benign || 0} ? held ${c24.held || 0} ? waiting digest ${rt.digestWaiting || 0}</span>
    </div>
    <div class="stat">
      <span class="muted">Model Call Budget</span>
      <strong>${rt.calls1h || 0} / ${st.callsPerHour || 120} (1h)</strong>
      <span class="muted">${rt.calls24h || 0} calls in 24h ? ${st.callsPerRun || 45}/run</span>
    </div>
  `

  nodes.dbLastRunLabel.textContent = rt.lastRun
    ? `Last check: ${rt.lastRun.replace('T', ' ').slice(0, 19)} UTC${rt.lastError ? ` (err: ${rt.lastError})` : ''}`
    : 'No run recorded yet'

  nodes.dbSwitchAsk.value = sw.ask || 'off'
  nodes.dbSwitchModel.value = sw.model || 'off'
  nodes.dbSwitchDetect.value = sw.detect || 'off'
  nodes.dbReportMode.value = st.reportMode || 'immediate'
  nodes.dbStaffAuthors.value = st.staffAuthors || 'main_only'
  nodes.dbOocMode.value = st.oocMode || 'single'
  nodes.dbOocPrefilter.value = st.oocPrefilter || 'on'
  nodes.dbCallsPerHour.value = st.callsPerHour ?? 120
  nodes.dbCallsPerRun.value = st.callsPerRun ?? 45
  nodes.dbReportsPerHour.value = st.reportsPerHour ?? 6

  const canManage = !!db.viewerPermissions?.canManage
  nodes.dbSaveSettingsBtn.disabled = !canManage
  nodes.dbFlushDigestBtn.disabled = !canManage

  const prevGuild = nodes.dbTimeoutGuildSelect.value || 'all'
  nodes.dbTimeoutGuildSelect.innerHTML = [
    '<option value="all">All Connected Discords (--all-guilds)</option>',
    ...guilds.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${escapeHtml(g.id)})</option>`),
  ].join('')
  nodes.dbTimeoutGuildSelect.value = prevGuild

  nodes.dbGuildCount.textContent = `${guilds.length} servers connected`
  nodes.dbGuildsTable.innerHTML = `
    <table style="--label-2:'Guild ID';--label-3:'Members';--label-4:'Bot Access';--label-5:'Areas (IC/OOC)';--label-6:'Status';--label-7:'Actions'">
      <caption class="hidden">Connected Discord guilds and infraction scope</caption>
      <thead>
        <tr>
          <th scope="col">Server</th>
          <th scope="col">Guild ID</th>
          <th scope="col">Members</th>
          <th scope="col">Bot Access</th>
          <th scope="col">Areas (IC / OOC)</th>
          <th scope="col">Infraction Watch</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${guilds.map(g => `
          <tr>
            <th scope="row">${escapeHtml(g.name)}${g.main ? ' <span class="tag">MAIN</span>' : ''}</th>
            <td><code>${escapeHtml(g.id)}</code></td>
            <td>${escapeHtml(g.members ?? '-')} (${escapeHtml(g.online ?? '-')} online)</td>
            <td><span class="tag ${g.admin ? '' : 'locked'}">${escapeHtml(g.admin ? 'ADMIN' : g.can_timeout ? 'MOD' : 'LIMITED')}</span></td>
            <td>${escapeHtml(g.areas || 0)} (${escapeHtml(g.icAreas || 0)} IC, ${escapeHtml(g.oocAreas || 0)} OOC)</td>
            <td><span class="tag ${g.monitoringOn ? '' : 'locked'}">${g.monitoringOn ? 'Monitoring ON' : 'OFF'}</span></td>
            <td>
              <button class="ghost mini" data-db-scope="${escapeHtml(g.id)}" data-db-scope-name="${escapeHtml(g.name)}" type="button">Channels</button>
              ${canManage ? `<button class="${g.monitoringOn ? 'danger' : 'ghost'} mini" data-db-toggle-guild="${escapeHtml(g.id)}" data-db-toggle-val="${g.monitoringOn ? 'false' : 'true'}" type="button">${g.monitoringOn ? 'Turn Off' : 'Turn On'}</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `


  const acflags = rt.anticheatFlags || []
  if (nodes.dbAnticheatFlagsCount && nodes.dbAnticheatFlagsTable) {
    nodes.dbAnticheatFlagsCount.textContent = `${acflags.length} recorded`
    nodes.dbAnticheatFlagsTable.innerHTML = acflags.length ? `
      <table style="--label-2:'Detection Kind';--label-3:'Character & Profile';--label-4:'Flag Details / Metrics';--label-5:'Time';--label-6:'Status'">
        <caption class="hidden">In-game anti-cheat flags and exploit detection</caption>
        <thead>
          <tr>
            <th scope="col">Player / Account</th>
            <th scope="col">Detection Kind</th>
            <th scope="col">Character &amp; Profile</th>
            <th scope="col">Detection Details / Metrics</th>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          ${acflags.map(f => {
            const isLive = !f.shadow
            const isStaff = !!f.staff
            const kindBadge = isLive ? `<span class="tag danger">${escapeHtml(f.kind || 'cheat')}</span>` : `<span class="tag locked">${escapeHtml(f.kind || 'cheat')} (shadow)</span>`
            const statusBadge = isStaff ? `<span class="tag">Staff</span>` : (isLive ? `<span class="tag danger">LIVE ALERT</span>` : `<span class="tag muted">Log only</span>`)
            return `
            <tr>
              <th scope="row">
                ${escapeHtml(f.discord_username || (f.profile ? `Profile #${f.profile}` : 'Unknown'))}<br>
                <code>${escapeHtml(f.discord_id ? `@${f.discord_id}` : (f.profile ? `Profile #${f.profile}` : '-'))}</code>
              </th>
              <td>${kindBadge}</td>
              <td><strong>${escapeHtml(f.name || '-')}</strong><br><span class="muted">Profile #${escapeHtml(f.profile ?? '-')} &middot; #${escapeHtml(f.tag || '')}</span></td>
              <td><code>${escapeHtml(f.text || '')}</code></td>
              <td>${escapeHtml((f.t || f.at || '').replace('T', ' ').slice(0, 19))}</td>
              <td>${statusBadge}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    ` : '<div class="empty">No in-game anti-cheat flags recorded.</div>'
  }

  const cflags = rt.clientFlags || []
  if (nodes.dbClientFlagsCount && nodes.dbClientFlagsTable) {
    nodes.dbClientFlagsCount.textContent = `${cflags.length} flagged`
    nodes.dbClientFlagsTable.innerHTML = cflags.length ? `
      <table style="--label-2:'Flag Type';--label-3:'Server & Channel';--label-4:'What They Did / Excerpt';--label-5:'Time';--label-6:'Actions'">
        <caption class="hidden">Flagged 3rd-party Discord clients and spying signals</caption>
        <thead>
          <tr>
            <th scope="col">Player / Discord ID</th>
            <th scope="col">Flag Signature</th>
            <th scope="col">Server &amp; Channel</th>
            <th scope="col">What They Did / Excerpt</th>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${cflags.map(f => `
            <tr>
              <th scope="row">${escapeHtml(f.author || f.username || '-')}${f.staff ? ` <span class="tag">${escapeHtml(f.staff_role || 'Staff')}</span>` : ''}<br><code>${escapeHtml(f.author_id || '')}</code></th>
              <td><span class="tag locked">${escapeHtml(f.flag_type || 'client_mod')}</span></td>
              <td>${escapeHtml(f.guild || '-')} &middot; #${escapeHtml(f.channel || '-')}</td>
              <td><strong>${escapeHtml(f.reason || '')}</strong><br><span class="muted">${escapeHtml(f.excerpt || '')}</span></td>
              <td>${escapeHtml((f.at || '').replace('T', ' ').slice(0, 16))}</td>
              <td>
                ${f.jump ? `<a href="${escapeHtml(f.jump)}" target="_blank" rel="noopener" style="color:var(--accent);margin-right:8px">Jump</a>` : ''}
                ${f.author_id ? `<button class="ghost mini" data-db-prefill-timeout="${escapeHtml(f.author_id)}" type="button">Timeout</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="empty-row">No 3rd-party Discord client signatures flagged yet. Click "Scan Discords for 3rd-Party Clients" to scan recent messages across all 11 servers.</div>'
  }

  const recs = rt.recentInfractions || []
  nodes.dbRecentCount.textContent = `${recs.length} recent`
  nodes.dbInfractionsTable.innerHTML = recs.length ? `
    <table style="--label-2:'Server';--label-3:'Severity';--label-4:'Status';--label-5:'Time';--label-6:'Link'">
      <caption class="hidden">Recent infraction detections</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Server</th>
          <th scope="col">Severity</th>
          <th scope="col">Status</th>
          <th scope="col">Time (UTC)</th>
          <th scope="col">Link</th>
        </tr>
      </thead>
      <tbody>
        ${recs.map(r => `
          <tr>
            <th scope="row">${escapeHtml(r.category || 'rule hit')}</th>
            <td>${escapeHtml(r.guildName)}</td>
            <td><span class="tag ${r.severity === 'high' ? 'locked' : ''}">${escapeHtml(r.severity || '-')}</span></td>
            <td>${escapeHtml(r.outcome)}</td>
            <td>${escapeHtml((r.at || '').replace('T', ' ').slice(0, 16))}</td>
            <td>${r.jumpUrl ? `<a href="${escapeHtml(r.jumpUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">Jump</a>` : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div class="empty-row">No recent infractions recorded.</div>'

  if (!db.viewerPermissions?.canViewHeld) {
    nodes.dbHeldCount.textContent = 'Owner permission required'
    nodes.dbHeldTable.innerHTML = '<div class="empty-row">Requires dragonbaron.held (Owner role) to view held staff hits.</div>'
  } else {
    nodes.dbHeldCount.textContent = `${state.dbHeld.length} held`
    nodes.dbHeldTable.innerHTML = state.dbHeld.length ? `
      <table style="--label-2:'Role & Guild';--label-3:'Rule & Reason';--label-4:'Excerpt';--label-5:'Link'">
        <caption class="hidden">Owners held staff infraction queue</caption>
        <thead>
          <tr>
            <th scope="col">Author</th>
            <th scope="col">Role &amp; Server</th>
            <th scope="col">Rules &amp; Reason</th>
            <th scope="col">Excerpt</th>
            <th scope="col">Link</th>
          </tr>
        </thead>
        <tbody>
          ${state.dbHeld.map(h => `
            <tr>
              <th scope="row">${escapeHtml(h.author)}</th>
              <td>${escapeHtml(h.staff_role || '')} ? ${escapeHtml(h.guild || '')}</td>
              <td><strong>${escapeHtml((h.rule_ids || []).join(', '))}</strong>: ${escapeHtml(h.reason || '')}</td>
              <td>${escapeHtml(h.excerpt || '')}</td>
              <td>${h.jump ? `<a href="${escapeHtml(h.jump)}" target="_blank" rel="noopener" style="color:var(--accent)">Jump</a>` : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="empty-row">No held staff hits.</div>'
  }
}

function renderDbScope() {
  if (!state.dbScope) {
    nodes.dbScopePanel.classList.add('hidden')
    return
  }
  nodes.dbScopePanel.classList.remove('hidden')
  nodes.dbScopeGuildName.textContent = `${state.dbScopeGuildName} (${state.dbScopeGuildId})`
  const overrides = state.dbScope.overrides || {}
  const areas = (state.dbScope.areas || []).map(a => ({ ...a, status: 'area' }))
  const skipped = (state.dbScope.skipped || []).map(s => ({ ...s, profile: 'skip', status: 'skip' }))
  const rows = [...areas, ...skipped]
  const canManage = !!state.dragonbaron?.viewerPermissions?.canManage

  nodes.dbScopeTable.innerHTML = `
    <table style="--label-2:'Category';--label-3:'Current Profile';--label-4:'Reason';--label-5:'Override Profile'">
      <caption class="hidden">Channels and categories in selected Discord server</caption>
      <thead>
        <tr>
          <th scope="col">Channel</th>
          <th scope="col">Category</th>
          <th scope="col">Current Profile</th>
          <th scope="col">Classifier Reason</th>
          <th scope="col">Profile Override</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const curOverride = overrides[r.id] || 'auto'
          const profLabel = r.status === 'skip' ? 'skip' : `${r.profile}${r.flavour ? ':' + r.flavour : ''}`
          return `
            <tr>
              <th scope="row">#${escapeHtml(r.name)} <span class="muted">(${escapeHtml(r.id)})</span></th>
              <td>${escapeHtml(r.cat || '-')}</td>
              <td><span class="tag ${r.status === 'skip' ? 'locked' : ''}">${escapeHtml(profLabel)}</span></td>
              <td>${escapeHtml(r.why || '-')}</td>
              <td>
                ${['target', 'type', 'ticket', 'staff-only', 'ticket-like', 'read-only', 'bot-cannot-read'].includes(r.why)
                  ? `<span class="muted">Safety skip (${escapeHtml(r.why)})</span>`
                  : `<select data-db-override-id="${escapeHtml(r.id)}" ${canManage ? '' : 'disabled'}>
                  <option value="auto" ${curOverride === 'auto' ? 'selected' : ''}>Auto (${escapeHtml(profLabel)})</option>
                  <option value="ooc" ${curOverride === 'ooc' ? 'selected' : ''}>Force OOC (bleed check)</option>
                  <option value="ic" ${curOverride === 'ic' ? 'selected' : ''}>Force IC (full roleplay rules)</option>
                  <option value="ic:ads" ${curOverride === 'ic:ads' ? 'selected' : ''}>Force IC: Ads</option>
                  <option value="ic:obituaries" ${curOverride === 'ic:obituaries' ? 'selected' : ''}>Force IC: Obituaries</option>
                  <option value="ic:sheets" ${curOverride === 'ic:sheets' ? 'selected' : ''}>Force IC: Character Sheets</option>
                  <option value="skip" ${curOverride === 'skip' ? 'selected' : ''}>Force Skip (never read)</option>
                </select>`}
              </td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  `
}

async function refreshAll() {
  await Promise.allSettled([
    loadBans().then(renderBans).catch(err => console.warn('Bans load failed:', err.message)),
    loadPlayers().then(() => { renderPlayers(); renderBans(); }).catch(err => console.warn('Players load failed:', err.message)),
    loadFactions().then(renderFactions).catch(err => console.warn('Factions load failed:', err.message)),
    loadAccess().then(renderAccess).catch(err => console.warn('Access load failed:', err.message)),
    loadPermissions().then(renderRoles).catch(err => {
      nodes.permissionsView.innerHTML = `<section class="empty-state"><h2>Permission access unavailable</h2><p>${escapeHtml(err.message)}</p></section>`
    }),
    loadDragonbaron().then(renderDragonbaron).catch(err => console.warn('Dragonbaron load failed:', err.message)),
  ])
}

async function refreshPlayers() {
  await loadPlayers()
  renderPlayers()
}

function clearSelectedPlayer() {
  state.selectedProfileId = null
  nodes.playerForm.reset()
  nodes.playerFactionNotesInput.value = ''
  renderPlayers()
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

async function saveAccess(event) {
  event.preventDefault()
  state.access = await api('/api/server-access', {
    method: 'PUT',
    body: JSON.stringify({
      serverLocked: nodes.serverLockedInput.checked,
      lockedRoleIds: lines(nodes.lockedRoleIdsInput.value),
      lockedDiscordIds: lines(nodes.lockedDiscordIdsInput.value),
      whitelistRoleId: nodes.whitelistRoleIdInput.value,
      bannedRoleId: nodes.bannedRoleIdInput.value,
    }),
  })
  renderAccess()
  toast('Server access policy saved')
}

async function checkAccess(event) {
  event.preventDefault()
  const discordId = nodes.accessCheckDiscordId.value.trim()
  const result = await api(`/api/server-access/check/${encodeURIComponent(discordId)}`)
  nodes.accessCheckResult.textContent = result.allowed
    ? `Allowed (${result.roles.length} role${result.roles.length === 1 ? '' : 's'})`
    : `Blocked: ${result.error || 'accessDenied'}`
}

async function savePlayer(event) {
  event.preventDefault()
  const player = selectedPlayer()
  const body = {
    discordId: nodes.playerDiscordIdInput.value,
    username: nodes.playerUsernameInput.value,
    displayName: nodes.playerDisplayNameInput.value,
    notes: nodes.playerNotesInput.value,
  }
  const saved = player
    ? await api(`/api/players/${player.profileId}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/players', { method: 'POST', body: JSON.stringify(body) })
  state.selectedProfileId = saved.profileId
  await refreshPlayers()
  toast('Player saved')
}

async function toggleWhitelist() {
  const player = selectedPlayer()
  if (!player) return
  const enabled = !player.access?.roles?.includes(state.access?.whitelistRoleId)
  await api(`/api/players/${player.profileId}/whitelist`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
  await refreshPlayers()
  toast(enabled ? 'Player whitelisted' : 'Player removed from whitelist')
}

// Banned when a bans.json snapshot exists or the discord ban role is present
function playerIsBanned(player) {
  return !!(player?.ban || player?.access?.roles?.includes(state.access?.bannedRoleId))
}

async function toggleBan() {
  const player = selectedPlayer()
  if (!player) return
  const enabled = !playerIsBanned(player)
  await api(`/api/players/${player.profileId}/ban`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
  await refreshPlayers()
  toast(enabled ? 'Player banned' : 'Player unbanned')
}

async function assignSelectedPlayerFaction(event) {
  event.preventDefault()
  const player = selectedPlayer()
  if (!player) return
  await api(`/api/players/${player.profileId}/factions`, {
    method: 'POST',
    body: JSON.stringify({
      requirementId: nodes.playerRequirementSelect.value,
      slot: slotFromSelect(nodes.playerSlotSelect.value),
      playerName: player.displayName || player.username,
      notes: nodes.playerFactionNotesInput.value,
    }),
  })
  nodes.playerFactionNotesInput.value = ''
  await loadFactions()
  renderFactions()
  await refreshPlayers()
  toast('Faction assigned')
}

async function saveAssignment(event) {
  event.preventDefault()
  const body = {
    requirementId: nodes.requirementSelect.value,
    discordId: nodes.discordIdInput.value,
    slot: slotFromSelect(nodes.slotSelect.value),
    playerName: nodes.playerNameInput.value,
    notes: nodes.notesInput.value,
  }
  await api('/api/faction-whitelist/assignments', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  nodes.assignmentForm.reset()
  await loadFactions()
  renderFactions()
  toast('Assignment saved')
}

async function saveRole(event) {
  event.preventDefault()
  const permissions = [...nodes.permissionChecks.querySelectorAll('input:checked')].map(input => input.value)
  await api(`/api/role-permissions/${encodeURIComponent(nodes.roleIdInput.value)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: nodes.roleNameInput.value,
      permissions,
    }),
  })
  nodes.roleForm.reset()
  nodes.selectedRole.textContent = 'New role'
  await loadPermissions()
  renderRoles()
  toast('Role permissions saved')
}

function bindEvents() {
  nodes.loginButton.addEventListener('click', () => login().catch(err => toast(err.message)))
  nodes.logoutButton.addEventListener('click', () => logout())
  nodes.refreshButton.addEventListener('click', () => refreshAll().catch(err => toast(err.message)))
  nodes.newPlayerButton.addEventListener('click', clearSelectedPlayer)
  nodes.playersRefreshButton.addEventListener('click', () => refreshPlayers().catch(err => toast(err.message)))
  nodes.playerSearchInput.addEventListener('input', renderPlayers)
  nodes.playerForm.addEventListener('submit', event => savePlayer(event).catch(err => toast(err.message)))
  nodes.whitelistPlayerButton.addEventListener('click', () => toggleWhitelist().catch(err => toast(err.message)))
  nodes.banPlayerButton.addEventListener('click', () => toggleBan().catch(err => toast(err.message)))
  nodes.playerFactionForm.addEventListener('submit', event => assignSelectedPlayerFaction(event).catch(err => toast(err.message)))
  nodes.accessForm.addEventListener('submit', event => saveAccess(event).catch(err => toast(err.message)))
  nodes.accessCheckForm.addEventListener('submit', event => checkAccess(event).catch(err => toast(err.message)))
  nodes.scopeFilter.addEventListener('change', renderRequirements)
  nodes.groupFilter.addEventListener('change', renderRequirements)
  nodes.assignGroupSelect.addEventListener('change', event => {
    state.assignGroup = event.target.value
    renderRoleSelect()
  })
  nodes.requirementSelect.addEventListener('change', event => {
    state.selectedRequirementId = event.target.value
    renderSelectedSlot()
    renderRequirements()
  })
  nodes.assignmentForm.addEventListener('submit', event => saveAssignment(event).catch(err => toast(err.message)))
  nodes.roleForm.addEventListener('submit', event => saveRole(event).catch(err => toast(err.message)))

  nodes.dbRefreshBtn.addEventListener('click', () => {
    loadDragonbaron(true).then(renderDragonbaron).then(() => toast('Dragonbaron status refreshed')).catch(err => toast(err.message))
  })
  nodes.dbCopyAdminInviteBtn.addEventListener('click', () => {
    const url = state.dragonbaron?.inviteUrls?.admin || 'https://discord.com/oauth2/authorize?client_id=1549543461382787142&permissions=8&scope=bot%20applications.commands'
    navigator.clipboard.writeText(url).then(() => toast('Copied Admin Invite URL to clipboard'))
  })
  nodes.dbCopyModInviteBtn.addEventListener('click', () => {
    const url = state.dragonbaron?.inviteUrls?.moderation || 'https://discord.com/oauth2/authorize?client_id=1549543461382787142&permissions=1100585438326&scope=bot%20applications.commands'
    navigator.clipboard.writeText(url).then(() => toast('Copied Moderation Invite URL to clipboard'))
  })
  if (nodes.dbScanClientsBtn) {
    nodes.dbScanClientsBtn.addEventListener('click', () => {
      toast('Scanning all 11 Discord servers for Vencord / FakeNitro / 3rd-party client signatures...')
      api('/api/dragonbaron/run', { method: 'POST', body: JSON.stringify({ scanClientFlags: true }) })
        .then(() => loadDragonbaron(true))
        .then(renderDragonbaron)
        .then(() => toast('3rd-party client scan complete'))
        .catch(err => toast(err.message))
    })
  }
  nodes.dbFlushDigestBtn.addEventListener('click', () => {
    toast('Running infraction-watch & flushing digest...')
    api('/api/dragonbaron/run', { method: 'POST', body: JSON.stringify({ flushDigest: true }) })
      .then(() => loadDragonbaron(true))
      .then(renderDragonbaron)
      .then(() => toast('Infraction check & digest flush complete'))
      .catch(err => toast(err.message))
  })
  nodes.dbSettingsForm.addEventListener('submit', async event => {
    event.preventDefault()
    try {
      await api('/api/dragonbaron/switches', {
        method: 'PUT',
        body: JSON.stringify({
          ask: nodes.dbSwitchAsk.value,
          model: nodes.dbSwitchModel.value,
          detect: nodes.dbSwitchDetect.value,
        }),
      })
      await api('/api/dragonbaron/config', {
        method: 'PUT',
        body: JSON.stringify({
          reportMode: nodes.dbReportMode.value,
          staffAuthors: nodes.dbStaffAuthors.value,
          oocMode: nodes.dbOocMode.value,
          oocPrefilter: nodes.dbOocPrefilter.value,
          callsPerHour: Number(nodes.dbCallsPerHour.value),
          callsPerRun: Number(nodes.dbCallsPerRun.value),
          reportsPerHour: Number(nodes.dbReportsPerHour.value),
        }),
      })
      await loadDragonbaron(true)
      renderDragonbaron()
      toast('Saved Dragonbaron switches & settings')
    } catch (err) {
      toast(err.message)
    }
  })
  nodes.dbCloseScopeBtn.addEventListener('click', () => {
    state.dbScope = null
    renderDbScope()
  })
  nodes.dbScopeTable.addEventListener('change', event => {
    const sel = event.target.closest('[data-db-override-id]')
    if (!sel) return
    const targetId = sel.dataset.dbOverrideId
    const profile = sel.value
    api('/api/dragonbaron/profile-override', {
      method: 'POST',
      body: JSON.stringify({ targetId, profile }),
    })
      .then(() => api(`/api/dragonbaron/scope?guild=${encodeURIComponent(state.dbScopeGuildId)}`))
      .then(data => {
        state.dbScope = data
        renderDbScope()
        toast(`Updated channel override (${profile})`)
      })
      .catch(err => toast(err.message))
  })
  function renderTimeoutResults(results) {
    const rows = Array.isArray(results) ? results : [results]
    nodes.dbTimeoutResults.innerHTML = rows.length ? `
      <table>
        <thead>
          <tr><th>Server</th><th>Member</th><th>Result</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.guild || 'Selected Guild')}</td>
              <td>${escapeHtml(r.member || '-')}</td>
              <td>${escapeHtml(
                r.error ? `Error: ${r.error}` :
                r.skipped ? `Skipped: ${r.skipped}` :
                r.cleared ? 'Timeout cleared' :
                r.until ? `Timed out until ${r.until}` :
                r.timed_out ? `Active timeout until ${r.until}` :
                `Not timed out${r.staff ? ` (staff: ${r.staff})` : ''}`
              )}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="empty-row">User not found in connected guilds.</div>'
  }
  nodes.dbCheckTimeoutBtn.addEventListener('click', () => {
    const userId = nodes.dbTimeoutUserId.value.trim()
    const guildId = nodes.dbTimeoutGuildSelect.value
    if (!userId) return toast('Enter a Discord User ID first')
    api('/api/dragonbaron/timeout-status', {
      method: 'POST',
      body: JSON.stringify({ userId, guildId }),
    })
      .then(data => renderTimeoutResults(data.results))
      .catch(err => toast(err.message))
  })
  nodes.dbTimeoutForm.addEventListener('submit', event => {
    event.preventDefault()
    const userId = nodes.dbTimeoutUserId.value.trim()
    const guildId = nodes.dbTimeoutGuildSelect.value
    const durationMinutes = Number(nodes.dbTimeoutDuration.value)
    const reason = nodes.dbTimeoutReason.value.trim()
    const force = nodes.dbTimeoutForce.checked
    api('/api/dragonbaron/timeout', {
      method: 'POST',
      body: JSON.stringify({ userId, guildId, durationMinutes, reason, force }),
    })
      .then(data => {
        renderTimeoutResults(data.results)
        toast(durationMinutes === 0 ? 'Cleared timeout' : 'Applied timeout')
      })
      .catch(err => toast(err.message))
  })

  document.querySelector('.nav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]')
    if (!button) return
    state.activeView = button.dataset.view
    renderActiveView()
  })

  document.body.addEventListener('click', event => {
    const select = event.target.closest('[data-select]')
    if (select) {
      state.selectedRequirementId = select.dataset.select
      const req = state.requirements.find(r => r.id === state.selectedRequirementId)
      if (req) state.assignGroup = req.group
      renderRequirements()
      return
    }

    const selectPlayer = event.target.closest('[data-select-player]')
    if (selectPlayer) {
      state.selectedProfileId = Number(selectPlayer.dataset.selectPlayer)
      renderPlayers()
      return
    }

    const deleteAssignment = event.target.closest('[data-delete-assignment]')
    if (deleteAssignment) {
      api(`/api/faction-whitelist/assignments/${encodeURIComponent(deleteAssignment.dataset.deleteAssignment)}`, {
        method: 'DELETE',
      })
        .then(loadFactions)
        .then(renderFactions)
        .then(refreshPlayers)
        .then(() => toast('Assignment removed'))
        .catch(err => toast(err.message))
      return
    }

    const notAlt = event.target.closest('[data-not-alt]')
    if (notAlt) {
      const player = selectedPlayer()
      if (!player) return
      const marked = notAlt.dataset.notAltValue === 'true'
      api(`/api/players/${player.profileId}/not-alt`, {
        method: 'PUT',
        body: JSON.stringify({ banRef: notAlt.dataset.notAlt, notAlt: marked }),
      })
        .then(refreshPlayers)
        .then(() => toast(marked ? 'Marked not an alt' : 'Not-an-alt mark removed'))
        .catch(err => toast(err.message))
      return
    }

    const deletePlayerAssignment = event.target.closest('[data-delete-player-assignment]')
    if (deletePlayerAssignment) {
      const player = selectedPlayer()
      if (!player) return
      api(`/api/players/${player.profileId}/factions/${encodeURIComponent(deletePlayerAssignment.dataset.deletePlayerAssignment)}`, {
        method: 'DELETE',
      })
        .then(loadFactions)
        .then(renderFactions)
        .then(refreshPlayers)
        .then(() => toast('Faction removed'))
        .catch(err => toast(err.message))
      return
    }

    const editRole = event.target.closest('[data-edit-role]')
    if (editRole) {
      const roleId = editRole.dataset.editRole
      const role = state.roles[roleId]
      nodes.roleIdInput.value = roleId
      nodes.roleNameInput.value = role.name || ''
      nodes.selectedRole.textContent = role.name || roleId
      renderPermissionChecks(role.permissions || [])
      return
    }

    const dbToggle = event.target.closest('[data-db-toggle-guild]')
    if (dbToggle) {
      const guildId = dbToggle.dataset.dbToggleGuild
      const enabled = dbToggle.dataset.dbToggleVal === 'true'
      api('/api/dragonbaron/guild-toggle', {
        method: 'POST',
        body: JSON.stringify({ guildId, enabled }),
      })
        .then(() => loadDragonbaron(true))
        .then(renderDragonbaron)
        .then(() => toast(enabled ? 'Guild monitoring enabled' : 'Guild monitoring disabled'))
        .catch(err => toast(err.message))
      return
    }

    const dbScopeBtn = event.target.closest('[data-db-scope]')
    if (dbScopeBtn) {
      const guildId = dbScopeBtn.dataset.dbScope
      const guildName = dbScopeBtn.dataset.dbScopeName
      state.dbScopeGuildId = guildId
      state.dbScopeGuildName = guildName
      toast(`Loading channel scope for ${guildName}...`)
      api(`/api/dragonbaron/scope?guild=${encodeURIComponent(guildId)}`)
        .then(data => {
          state.dbScope = data
          renderDbScope()
          nodes.dbScopePanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
        .catch(err => toast(err.message))
      return
    }

    const unbanBtn = event.target.closest('[data-unban-profile]')
    if (unbanBtn) {
      const pid = Number(unbanBtn.dataset.unbanProfile)
      api(`/api/players/${pid}/ban`, { method: 'PUT', body: JSON.stringify({ enabled: false }) })
        .then(() => Promise.all([refreshPlayers(), loadBans()]))
        .then(renderBans)
        .then(() => toast(`Unbanned profile #${pid}`))
        .catch(err => toast(err.message))
      return
    }

    const deleteRole = event.target.closest('[data-delete-role]')
    if (deleteRole) {
      api(`/api/role-permissions/${encodeURIComponent(deleteRole.dataset.deleteRole)}`, { method: 'DELETE' })
        .then(loadPermissions)
        .then(renderRoles)
        .then(() => toast('Role removed'))
        .catch(err => toast(err.message))
    }
  })
}

async function start() {
  bindEvents()
  captureTokenFromUrl()
  try {
    await loadSession()
    renderAuth()
    if (state.user) await refreshAll()
  } catch (err) {
    localStorage.removeItem(tokenKey)
    state.token = ''
    state.user = null
    renderAuth()
    toast(err.message)
  }

  const url = new URL(window.location.href)
  const error = url.searchParams.get('error')
  if (error) toast(error)
}

start()

// -------------------------------------------------------------------------------------------------
// Support Tickets & Dragonbaron Relay UI Logic
// -------------------------------------------------------------------------------------------------
let selectedTicketChannelId = null

async function loadTickets() {
  if (!nodes.ticketsTableBody) return
  nodes.ticketsTableBody.innerHTML = '<tr><td colspan="6" class="muted">Fetching open tickets...</td></tr>'
  try {
    const res = await api('/api/dragonbaron/tickets')
    const tickets = res.tickets || []
    if (!tickets.length) {
      nodes.ticketsTableBody.innerHTML = '<tr><td colspan="6" class="muted">No open tickets tracked yet.</td></tr>'
      return
    }
    nodes.ticketsTableBody.innerHTML = tickets.map(t => {
      const typeLabel = t.typeLabel || (t.type ? t.type.toUpperCase() : 'Ticket')
      const num = t.number || '0000'
      const opener = t.username || 'Unknown'
      const summary = t.summary ? (t.summary.length > 55 ? t.summary.slice(0, 55) + '...' : t.summary) : 'None'
      const threadUrl = t.threadUrl || `https://discord.com/channels/1565789714487971980/${t.threadId}`
      return `
        <tr>
          <td><strong>#${t.channelName || `${t.type}-${num}`}</strong></td>
          <td><span class="pill ok">${typeLabel}</span></td>
          <td><strong>${opener}</strong></td>
          <td class="muted">${summary}</td>
          <td><a href="${threadUrl}" target="_blank" rel="noopener" class="link" style="color:#60a5fa;">Open Forum Thread ↗</a></td>
          <td>
            <button class="primary mini" data-ticket-reply="${t.channelId}" data-ticket-name="${t.channelName || num}">Reply</button>
          </td>
        </tr>
      `
    }).join('')
  } catch (err) {
    nodes.ticketsTableBody.innerHTML = `<tr><td colspan="6" class="error">Failed to load tickets: ${err.message}</td></tr>`
  }
}

if (nodes.refreshTicketsBtn) {
  nodes.refreshTicketsBtn.addEventListener('click', loadTickets)
}

if (nodes.ticketsTableBody) {
  nodes.ticketsTableBody.addEventListener('click', event => {
    const btn = event.target.closest('[data-ticket-reply]')
    if (!btn) return
    selectedTicketChannelId = btn.dataset.ticketReply
    const name = btn.dataset.ticketName
    if (nodes.ticketReplyBoxTitle) {
      nodes.ticketReplyBoxTitle.textContent = `Reply to #${name}`
    }
    if (nodes.ticketReplyBox) {
      nodes.ticketReplyBox.classList.remove('hidden')
      nodes.ticketReplyBox.scrollIntoView({ behavior: 'smooth' })
    }
    if (nodes.ticketReplyInput) {
      nodes.ticketReplyInput.value = ''
      nodes.ticketReplyInput.focus()
    }
  })
}

if (nodes.closeReplyBoxBtn) {
  nodes.closeReplyBoxBtn.addEventListener('click', () => {
    if (nodes.ticketReplyBox) nodes.ticketReplyBox.classList.add('hidden')
  })
}

if (nodes.closeTicketReplyBoxBtn) {
  nodes.closeTicketReplyBoxBtn.addEventListener('click', () => {
    if (nodes.ticketReplyBox) nodes.ticketReplyBox.classList.add('hidden')
  })
}

if (nodes.sendTicketReplyBtn) {
  nodes.sendTicketReplyBtn.addEventListener('click', async () => {
    if (!selectedTicketChannelId) return
    const text = nodes.ticketReplyInput ? nodes.ticketReplyInput.value.trim() : ''
    if (!text) {
      toast('Please enter a response message.')
      return
    }
    try {
      nodes.sendTicketReplyBtn.disabled = true
      nodes.sendTicketReplyBtn.textContent = 'Sending as Dragonbaron...'
      await api(`/api/dragonbaron/tickets/${selectedTicketChannelId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      toast('Reply sent to player as Dragonbaron!')
      if (nodes.ticketReplyInput) nodes.ticketReplyInput.value = ''
      if (nodes.ticketReplyBox) nodes.ticketReplyBox.classList.add('hidden')
    } catch (err) {
      toast('Error sending reply: ' + err.message)
    } finally {
      nodes.sendTicketReplyBtn.disabled = false
      nodes.sendTicketReplyBtn.textContent = 'Send Reply as Dragonbaron'
    }
  })
}

if (nodes.closeTicketActionBtn) {
  nodes.closeTicketActionBtn.addEventListener('click', async () => {
    if (!selectedTicketChannelId) return
    if (!confirm('Are you sure you want to close this ticket and archive the forum thread?')) return
    try {
      nodes.closeTicketActionBtn.disabled = true
      nodes.closeTicketActionBtn.textContent = 'Closing...'
      await api(`/api/dragonbaron/tickets/${selectedTicketChannelId}/close`, { method: 'POST' })
      toast('Ticket closed and archived successfully!')
      if (nodes.ticketReplyBox) nodes.ticketReplyBox.classList.add('hidden')
      loadTickets()
    } catch (err) {
      toast('Error closing ticket: ' + err.message)
    } finally {
      nodes.closeTicketActionBtn.disabled = false
      nodes.closeTicketActionBtn.textContent = 'Close Ticket'
    }
  })
}
