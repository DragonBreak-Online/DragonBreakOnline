'use strict'
// Presigned URLs for a private R2 bucket (S3 SigV4, query-string auth), so the dev files never need a public bucket.
// R2 takes path-style URLs: <endpoint>/<bucket>/<key>, region "auto".

const crypto = require('crypto')

const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest()
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex')
// RFC 3986, as SigV4 wants: everything but unreserved characters is percent-encoded
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

// method GET, PUT or DELETE; url: the object's URL without a query (https://<host>/<bucket>/<key> for R2)
function presign(method, url, { accessKeyId, secretAccessKey, region = 'auto', expiresSec = 600, now = new Date() }) {
  const u = new URL(url)
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${region}/s3/aws4_request`
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&')
  const canonicalPath = u.pathname.split('/').map(seg => enc(decodeURIComponent(seg))).join('/')
  const canonical = [method, canonicalPath, canonicalQuery, `host:${u.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request')
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex')
  return `${u.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

const presignGet = (url, opts) => presign('GET', url, opts)

module.exports = { presign, presignGet }
