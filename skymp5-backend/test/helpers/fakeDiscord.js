'use strict'
// A fake discord.com for the login tests: https.request and https.get to discord.com answer here, any other host is refused, nothing leaves the machine

const https = require('https')
const { EventEmitter } = require('events')

function install({ user }) {
  const calls = { token: 0, me: 0, other: [] }
  const answer = path => {
    if (path === '/api/oauth2/token') { calls.token++; return { access_token: 'fake-access', token_type: 'Bearer' } }
    if (path === '/api/users/@me') { calls.me++; return typeof user === 'function' ? user() : user }
    return null
  }
  const fake = (options, cb) => {
    const opts = typeof options === 'string' ? new URL(options) : options
    const req = new EventEmitter()
    req.write = () => true
    req.setTimeout = () => req
    req.destroy = err => { if (err) req.emit('error', err); req.emit('close') }
    req.end = () => {
      setImmediate(() => {
        if (opts.hostname !== 'discord.com') { calls.other.push(opts.hostname); return req.emit('error', new Error(`fake network: ${opts.hostname} refused`)) }
        const body = answer(opts.path)
        const res = new EventEmitter()
        res.statusCode = body ? 200 : 404
        res.setEncoding = () => {}
        if (cb) cb(res)
        res.emit('data', JSON.stringify(body || { message: 'not found' }))
        res.emit('end')
        req.emit('close')
      })
      return req
    }
    return req
  }
  const real = { request: https.request, get: https.get }
  https.request = fake
  https.get = (options, cb) => fake(options, cb).end()
  return { calls, restore: () => Object.assign(https, real) }
}

module.exports = { install }
