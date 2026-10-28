'use strict'

const fs = require('fs')
const path = require('path')

const PERMS_FILE = process.env.DRAGONBARON_PERMS_FILE || path.resolve(__dirname, '../../data/dragonbaron-permissions.json')

// Staff Roles in DragonBreak Online Guild
const ROLES = Object.freeze({
  OWNER: '1494126527489507369',
  DEV: '1494491999305338981',
  LEAD_GM: '1494126618065506425',
  GM: '1553844072878178384',
  TRIAL_GM: '1558248795932860507'
})

const DEFAULT_PERMISSIONS = Object.freeze({
  tickets: {
    name: 'tickets',
    label: 'GM Tickets & Support',
    description: 'View open calls, claim, release, and close support tickets (/gm)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM, ROLES.GM]
  },
  factions: {
    name: 'factions',
    label: 'Faction Roster & Leadership',
    description: 'View faction rosters, appoint faction leaders, remove members (/faction)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  charters: {
    name: 'charters',
    label: 'Faction Charters Review',
    description: 'Review pending charters, inspect details, approve or deny (/charter)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  citizenship: {
    name: 'citizenship',
    label: 'Citizenship & Immigration',
    description: 'View citizenship rolls, grant/revoke hold citizenship, clear/set cooldowns (/citizenship)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  items_spells: {
    name: 'items_spells',
    label: 'Items & Spells Management',
    description: 'Give/take items, grant/remove spells, and unstuck players (/giveitem, /takeitem, /givespell, /removespell, /unstuck)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM, ROLES.GM]
  },
  moderation: {
    name: 'moderation',
    label: 'Player Discipline & Suspensions',
    description: 'Kick online players, issue warnings, strikes, and timed suspensions (/kick, /discipline, /tempban)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  bans: {
    name: 'bans',
    label: 'Account Bans & Active Ban List',
    description: 'Permanent account bans, early lifts, and view active bans (/ban, /unban, /bans)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  announcements: {
    name: 'announcements',
    label: 'Server Announcements',
    description: 'Broadcast in-game administrative announcements to all online players (/announce)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  world_time: {
    name: 'world_time',
    label: 'World Clock & Date Control',
    description: 'Check Tamriel in-game date/moons and advance world clock hours (/time, /settime)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM]
  },
  audit_stats: {
    name: 'audit_stats',
    label: 'Staff Audit & Diagnostics',
    description: 'View 7-day staff command counts, online players, and server performance (/staffstats, /players, /load, /whoami)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM, ROLES.GM]
  },
  ask: {
    name: 'ask',
    label: 'Ask Dragonbaron (AI)',
    description: 'Ask the local AI about server data (read-only, private answers, runs nothing)',
    allowedRoles: [ROLES.OWNER, ROLES.DEV, ROLES.LEAD_GM, ROLES.GM]
  },
  config: {
    name: 'config',
    label: 'Permission & Role Configuration',
    description: 'Assign Discord roles to permission nodes and manage Dragonbaron access',
    allowedRoles: [ROLES.OWNER, ROLES.DEV],
    superAdminOnly: true
  }
})

// Nodes that grant their own command only, never the control panel
const PANEL_EXEMPT = new Set(['ask'])

let cachedPermissions = null

function loadPermissions() {
  if (cachedPermissions) return cachedPermissions
  try {
    if (fs.existsSync(PERMS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PERMS_FILE, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        const merged = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS))
        for (const [k, v] of Object.entries(parsed)) {
          if (merged[k] && Array.isArray(v.allowedRoles)) {
            merged[k].allowedRoles = [...new Set(v.allowedRoles.map(String))]
          }
        }
        cachedPermissions = merged
        return cachedPermissions
      }
    }
  } catch (err) {
    console.error('[dragonbaron-perms] Failed to read permissions file, using defaults:', err.message)
  }
  cachedPermissions = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS))
  savePermissions(cachedPermissions)
  return cachedPermissions
}

function savePermissions(data) {
  try {
    cachedPermissions = data
    const dir = path.dirname(PERMS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = `${PERMS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, PERMS_FILE)
    return true
  } catch (err) {
    console.error('[dragonbaron-perms] Failed to save permissions file:', err.message)
    return false
  }
}

function hasPermission(memberRoles, nodeName) {
  const perms = loadPermissions()
  const roleList = (memberRoles || []).map(String)
  // Owners and Devs always have full superadmin access
  if (roleList.includes(ROLES.OWNER) || roleList.includes(ROLES.DEV)) return true
  const node = perms[nodeName]
  if (!node) return false
  return (node.allowedRoles || []).some(r => roleList.includes(r))
}

function canAccessPanel(memberRoles) {
  const perms = loadPermissions()
  const roleList = (memberRoles || []).map(String)
  if (roleList.includes(ROLES.OWNER) || roleList.includes(ROLES.DEV)) return true
  for (const [key, node] of Object.entries(perms)) {
    if (PANEL_EXEMPT.has(key)) continue
    if ((node.allowedRoles || []).some(r => roleList.includes(r))) return true
  }
  return false
}

function canConfigure(memberRoles) {
  return hasPermission(memberRoles, 'config')
}

function setPermissionRoles(nodeName, newRoleIds) {
  const perms = loadPermissions()
  if (!perms[nodeName]) return false
  perms[nodeName].allowedRoles = [...new Set((newRoleIds || []).map(String))]
  return savePermissions(perms)
}

function resetPermissionRoles(nodeName) {
  const perms = loadPermissions()
  if (!DEFAULT_PERMISSIONS[nodeName]) return false
  perms[nodeName].allowedRoles = [...DEFAULT_PERMISSIONS[nodeName].allowedRoles]
  return savePermissions(perms)
}

// The highest staff rank held, for what /dragonbaron ask may read: owner, dev, leadgm, gm, trialgm, or null
function askTier(memberRoles) {
  const held = new Set((memberRoles || []).map(String))
  for (const [tier, role] of [['owner', ROLES.OWNER], ['dev', ROLES.DEV], ['leadgm', ROLES.LEAD_GM], ['gm', ROLES.GM], ['trialgm', ROLES.TRIAL_GM]]) {
    if (held.has(role)) return tier
  }
  return null
}

function resetAll() {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS))
  return savePermissions(fresh)
}

module.exports = {
  ROLES,
  DEFAULT_PERMISSIONS,
  loadPermissions,
  savePermissions,
  hasPermission,
  canAccessPanel,
  canConfigure,
  setPermissionRoles,
  resetPermissionRoles,
  resetAll,
  askTier,
  PANEL_EXEMPT,
  _resetCache: () => { cachedPermissions = null }
}
