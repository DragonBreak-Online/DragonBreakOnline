'use strict'
// Read-only views of record files other processes write. Every writer replaces its file by .tmp and rename, or appends
// (the journal), so no lock is needed. Nothing here ever opens a file for writing.

const fs = require('fs')

const MAX_JSON_BYTES = 32 * 1024 * 1024
const MAX_TAIL_BYTES = 8 * 1024 * 1024

// A JSON file parsed again only when its inode, mtime or size changes. read() -> { status, asOf, value }:
// status ok, missing (no file: nothing on record) or unreadable (kept the last good copy, asOf says from when)
function jsonFile(file, parse, { maxBytes = MAX_JSON_BYTES } = {}) {
  let stamp = null, good = null, status = 'missing', path = file
  const view = () => ({ status, asOf: good ? good.asOf : null, value: good ? good.value : null })
  return {
    get file() { return path },
    read(nextPath) {
      if (nextPath && nextPath !== path) { path = nextPath; stamp = null; good = null }
      let st
      try { st = fs.statSync(path) } catch (err) {
        stamp = null
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') { good = null; status = 'missing' } else status = 'unreadable'
        return view()
      }
      const next = `${st.ino}:${st.mtimeMs}:${st.size}`
      if (next === stamp) return view()
      stamp = next
      if (!st.isFile() || st.size > maxBytes) { status = 'unreadable'; return view() }
      try {
        good = { value: parse(JSON.parse(fs.readFileSync(path, 'utf8'))), asOf: st.mtime.toISOString() }
        status = 'ok'
      } catch { status = 'unreadable' }
      return view()
    },
  }
}

// An append-only JSONL file read on from the byte it stopped at, at most once per minIntervalMs, up to its last newline.
// A new inode or a shorter file starts it again. read() -> { status, asOf, rows, bad }
function jsonlTail(file, parseLine, { minIntervalMs = 30000, maxBytes = MAX_TAIL_BYTES, now = Date.now } = {}) {
  let ino = null, offset = 0, rows = [], bad = 0, status = 'missing', asOf = null, lastAt = -Infinity
  const view = () => ({ status, asOf, rows, bad })
  return {
    read() {
      if (now() - lastAt < minIntervalMs) return view()
      lastAt = now()
      let st
      try { st = fs.statSync(file) } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') { ino = null; offset = 0; rows = []; bad = 0; status = 'missing'; asOf = null } else status = 'unreadable'
        return view()
      }
      if (!st.isFile()) { status = 'unreadable'; return view() }
      if (st.ino !== ino || st.size < offset) { ino = st.ino; offset = 0; rows = []; bad = 0 }
      if (st.size > offset) {
        let fd
        try {
          fd = fs.openSync(file, 'r')
          const buf = Buffer.alloc(Math.min(st.size - offset, maxBytes))
          const got = fs.readSync(fd, buf, 0, buf.length, offset)
          const end = buf.subarray(0, got).lastIndexOf(10)
          if (end >= 0) {
            const added = []
            for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
              if (!line.trim()) continue
              let row = null
              try { row = parseLine(JSON.parse(line)) } catch { row = null }
              if (row) added.push(row); else bad++
            }
            rows = rows.concat(added)
            offset += end + 1
          } else if (got === maxBytes) { offset += got; bad++ }
        } catch { status = 'unreadable'; return view() } finally { if (fd !== undefined) fs.closeSync(fd) }
      }
      status = 'ok'
      asOf = st.mtime.toISOString()
      return view()
    },
  }
}

module.exports = { jsonFile, jsonlTail, MAX_JSON_BYTES }
