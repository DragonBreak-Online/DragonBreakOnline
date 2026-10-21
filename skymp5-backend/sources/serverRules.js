'use strict'
// The official Server Rules (data/rules): the master text that the website page and the Discord rules channel copy.
// Read-only. Only the player text is served; the staff handbook in the same folder is never sent (rules G16).
// The manifest (data/rules/manifest.json) names the version, the effective date, what changed and the files.

const fs   = require('fs')
const path = require('path')

const RULES_DIR = process.env.RULES_DIR || path.join(__dirname, '..', 'data', 'rules')
const MAX_TEXT_BYTES = 256 * 1024
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/

// Line endings and a BOM are not a change: a Windows checkout turns LF into CRLF
const normalizeText = s => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n')

function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('manifest.json is not an object')
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) throw new Error('manifest.json: version must be a short id like 2026-10-22')
  if (typeof m.effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.effective)) throw new Error('manifest.json: effective must be YYYY-MM-DD')
  if (!Array.isArray(m.changes) || m.changes.length < 1 || m.changes.length > 20 ||
      !m.changes.every(c => typeof c === 'string' && c.trim() && c.length <= 300)) {
    throw new Error('manifest.json: changes must be 1 to 20 short lines')
  }
  const f = m.files && typeof m.files === 'object' ? m.files.rules : null
  if (typeof f !== 'string' || path.basename(f) !== f || !/^[\w.-]+\.md$/.test(f)) throw new Error('manifest.json: files.rules must be a .md file beside it')
  return { version: m.version, effective: m.effective, changes: m.changes.map(c => c.trim()), file: f }
}

function readManifest(dir = RULES_DIR) {
  return validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')))
}

function readText(file) {
  const buf = fs.readFileSync(file)
  if (buf.length > MAX_TEXT_BYTES) throw new Error(`${path.basename(file)} is larger than ${MAX_TEXT_BYTES} bytes`)
  const text = normalizeText(buf.toString('utf8'))
  if (!text.trim()) throw new Error(`${path.basename(file)} is empty`)
  return text
}

const stamp = file => { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}:${s.ino}` }
let cache = null

// The current rules, re-read only when the manifest or the text changes on disk; throws when either is missing or malformed
function currentRules(dir = RULES_DIR) {
  const manifest = readManifest(dir)
  const file = path.join(dir, manifest.file)
  const key = [dir, stamp(path.join(dir, 'manifest.json')), stamp(file)].join('|')
  if (cache && cache.key === key) return cache.doc
  const doc = Object.freeze({
    version: manifest.version,
    effective: manifest.effective,
    changes: Object.freeze(manifest.changes),
    rules: readText(file),
  })
  cache = { key, doc }
  return doc
}

module.exports = { currentRules, validateManifest, normalizeText, RULES_DIR, VERSION_RE, resetCache: () => { cache = null } }
