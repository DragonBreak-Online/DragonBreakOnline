'use strict'
// The polled GETs send the last answer's ETag, and a 304 reuses that answer, so an unchanged file list costs no body (memory only)

// fetchJSON(url, headers, redirectsLeft, meta) fills meta.status and meta.etag, and resolves nothing on a 304
function createPollCache(fetchJSON) {
  const last = new Map()
  return async function polledJSON(url) {
    const hit = last.get(url)
    const meta = {}
    const body = await fetchJSON(url, hit ? { 'If-None-Match': hit.etag } : {}, 3, meta)
    if (meta.status === 304) {
      if (hit) return hit.body
      throw new Error(`HTTP 304 from ${url} with no earlier answer`)
    }
    if (meta.etag) last.set(url, { etag: meta.etag, body })
    else last.delete(url)
    return body
  }
}

module.exports = { createPollCache }
