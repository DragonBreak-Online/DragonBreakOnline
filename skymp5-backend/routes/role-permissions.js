'use strict'

const { Router }        = require('express')
const requirePermission = require('../middleware/requirePermission')
const permissions       = require('../sources/permissions')
const audit             = require('../sources/discord/audit')

const router = Router()

const KNOWN_PERMISSIONS = [
  'admin.*',
  'dashboard.access',
  'permissions.manage',
  'players.view',
  'players.manage',
  'server.access.view',
  'server.access.manage',
  'factions.view',
  'factions.manage',
  'lore.write',
  'rules.write',
  'staff.whitelist_info',
  'dragonbaron.view',
  'dragonbaron.manage',
  'dragonbaron.held',
  'dragonbaron.moderate',
]

router.get('/', requirePermission('permissions.manage'), (_req, res) => {
  const data = permissions.listRolePermissions()
  res.json({
    roles: data.roles || {},
    users: data.users || {},
    knownPermissions: KNOWN_PERMISSIONS,
  })
})

router.put('/users/:discordId', requirePermission('permissions.manage'), (req, res) => {
  try {
    const { name, permissions: userPermissions } = req.body || {}
    const user = permissions.setUserPermissions(req.params.discordId, name, userPermissions)
    audit.log(`PERM ${req.session.username} set user ${name || req.params.discordId} (${req.params.discordId}) website permissions to [${(userPermissions || []).join(', ')}]`)
    res.json(user)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'failed to save user permissions' })
  }
})

router.delete('/users/:discordId', requirePermission('permissions.manage'), (req, res) => {
  permissions.deleteUserPermissions(req.params.discordId)
  audit.log(`PERM ${req.session.username} removed all direct website permissions of user ${req.params.discordId}`)
  res.json({ ok: true })
})

router.put('/:roleId', requirePermission('permissions.manage'), (req, res) => {
  try {
    const { name, permissions: rolePermissions } = req.body || {}
    const role = permissions.setRolePermissions(req.params.roleId, name, rolePermissions)
    audit.log(`PERM ${req.session.username} set role ${name || req.params.roleId} (${req.params.roleId}) to [${(rolePermissions || []).join(', ')}]`)
    res.json(role)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'failed to save role permissions' })
  }
})

router.delete('/:roleId', requirePermission('permissions.manage'), (req, res) => {
  permissions.deleteRolePermissions(req.params.roleId)
  audit.log(`PERM ${req.session.username} removed all permissions of role ${req.params.roleId}`)
  res.json({ ok: true })
})

module.exports = router
