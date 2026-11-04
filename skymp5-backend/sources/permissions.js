'use strict'
// Maps Discord role IDs and individual Discord user IDs to flat permission strings using data/role-permissions.json

const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'role-permissions.json')

function _load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (!data.roles) data.roles = {}
    if (!data.users) data.users = {}
    return data
  } catch {
    return { roles: {}, users: {} }
  }
}

function _save(config) {
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n')
}

function listRolePermissions() {
  return _load()
}

function setRolePermissions(roleId, name, permissions) {
  const normalizedRoleId = String(roleId || '').trim()
  if (!normalizedRoleId) {
    const err = new Error('roleId is required')
    err.status = 400
    throw err
  }
  if (!Array.isArray(permissions)) {
    const err = new Error('permissions must be an array')
    err.status = 400
    throw err
  }

  const config = _load()
  config.roles[normalizedRoleId] = {
    name: String(name || normalizedRoleId).trim(),
    permissions: [...new Set(permissions.map(p => String(p || '').trim()).filter(Boolean))],
  }
  _save(config)
  return config.roles[normalizedRoleId]
}

function deleteRolePermissions(roleId) {
  const config = _load()
  if (config.roles) delete config.roles[String(roleId || '').trim()]
  _save(config)
}

function setUserPermissions(discordId, name, permissions) {
  const normalizedId = String(discordId || '').trim()
  if (!/^\d{15,22}$/.test(normalizedId)) {
    const err = new Error('Valid Discord user ID (15-22 digits) is required')
    err.status = 400
    throw err
  }
  if (!Array.isArray(permissions)) {
    const err = new Error('permissions must be an array')
    err.status = 400
    throw err
  }

  const config = _load()
  config.users[normalizedId] = {
    name: String(name || normalizedId).trim(),
    permissions: [...new Set(permissions.map(p => String(p || '').trim()).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  }
  _save(config)
  return config.users[normalizedId]
}

function deleteUserPermissions(discordId) {
  const config = _load()
  if (config.users) delete config.users[String(discordId || '').trim()]
  _save(config)
}

/** Resolves Discord role IDs + optional Discord user ID to a deduplicated flat array of permission strings. */
function resolvePermissions(roleIds = [], discordId = '') {
  const config = _load()
  const perms  = new Set()
  for (const roleId of roleIds || []) {
    const entry = config.roles[roleId]
    if (entry && Array.isArray(entry.permissions)) {
      entry.permissions.forEach(p => perms.add(p))
    }
  }
  if (discordId && config.users && config.users[String(discordId)]) {
    const uEntry = config.users[String(discordId)]
    if (Array.isArray(uEntry.permissions)) {
      uEntry.permissions.forEach(p => perms.add(p))
    }
  }
  return [...perms]
}

/** True if the permissions array grants `required`; 'admin.*' is a wildcard granting everything. */
function hasPermission(permissions, required) {
  if (permissions.includes('admin.*')) return true
  return permissions.includes(required)
}

module.exports = {
  listRolePermissions,
  setRolePermissions,
  deleteRolePermissions,
  setUserPermissions,
  deleteUserPermissions,
  resolvePermissions,
  hasPermission,
}
