'use strict'
// The live-files guard (sources/liveBucket.js): merge-files, populate-files, setup-client and the webhook never write the live client files; every run here uses copies of this backend in a temp folder

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs     = require('fs')
const http   = require('http')
const os     = require('os')
const path   = require('path')
const { once } = require('events')
const { spawnSync, execFileSync } = require('child_process')

// Never read a real .env, and keep the ban and player stores out of these tests
require.cache[require.resolve('dotenv')] = { exports: { config: () => ({}) } }
for (const key of Object.keys(process.env)) if (key.startsWith('AUTO_REPORT')) delete process.env[key]
for (const key of ['CLIENT_FILES_DIR', 'DBO_RELEASE_REPO', 'DBO_MERGE_LIVE_BUCKET', 'CLIENT_BRANCH']) delete process.env[key]
function stub(rel, exports) {
  const file = require.resolve(rel)
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('../sources/bans', { isBanned: () => null })
stub('../sources/players', { load: () => ({}) })

const config     = require('../config')
const liveBucket = require('../sources/liveBucket')

const BACKEND = path.join(__dirname, '..')
const NODE_MODULES = path.dirname(path.dirname(require.resolve('archiver/package.json')))
const COPIED = ['config.js', 'package.json', 'scripts', 'routes', 'sources', 'middleware']
// No user or system git config, no prompt, and no network: a clone that slips through can only be local
const GIT_ENV = { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file' }
Object.assign(process.env, GIT_ENV)
const HAS_GIT = spawnSync('git', ['--version']).status === 0
let tmp

before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-guard-')) })
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// Every file under dir with its sha256 (links not followed), to show that a run changed nothing
function snapshot(dir, out = {}, base = dir) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name)
    if (e.isSymbolicLink()) out[path.relative(base, file)] = `-> ${fs.readlinkSync(file)}`
    else if (e.isDirectory()) snapshot(file, out, base)
    else out[path.relative(base, file)] = sha256(fs.readFileSync(file))
  }
  return out
}

// A copy of this backend's code under root/skymp5-backend, as a backend export holds it: no sources/client, no .env, empty data/
function backendCopy(root) {
  const dir = path.join(root, 'skymp5-backend')
  const clientSource = path.join(BACKEND, 'sources', 'client')
  for (const name of COPIED) {
    fs.cpSync(path.join(BACKEND, name), path.join(dir, name), { recursive: true, filter: src => src !== clientSource })
  }
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.symlinkSync(NODE_MODULES, path.join(dir, 'node_modules'), 'junction')
  return dir
}

// A stand-in for the live checkout, named by DBO_RELEASE_REPO: a bucket with a zip and a root, a backend with a manifest.
// asCheckout: also a git checkout one commit behind its upstream, with head() reading its HEAD
function liveCheckout(name, { asCheckout = false } = {}) {
  const repo = path.join(tmp, name)
  const head = asCheckout ? behindCheckout(repo) : null
  const backend = backendCopy(repo)
  const bucket = path.join(repo, 'build', 'client-files')
  write(path.join(bucket, 'skymp-client.zip'), 'the live zip')
  write(path.join(bucket, 'root', 'Data', 'Platform', 'UI', 'index.html'), 'the live ui')
  const manifest = path.join(backend, 'data', 'files-version.json')
  write(manifest, '{"version":"live"}\n')
  return { repo, backend, bucket, manifest, head }
}

const WORK_FILES = { 'Data/Platform/UI/index.html': 'ui', 'Data/Platform/Plugins/skymp5-client.js': 'client' }

// A work folder whose root a package step prepared, as overlay-build.sh and pack-client.sh leave it
function workFolder(name, files = WORK_FILES) {
  const dir = path.join(tmp, name)
  for (const [rel, data] of Object.entries(files)) write(path.join(dir, 'root', rel), data)
  return dir
}

// mount --bind from onto, in a private mount namespace (unshare -m) that no other process sees and that ends with the command
const BIND = ['unshare', '-m', '--propagation', 'private', 'sh', '-ec', 'mount --bind "$1" "$2"; shift 2; exec "$@"', 'sh']

// One script of a backend copy, with only the given env (CLIENT_FILES_DIR is always set) and a cwd without a .env, unless cwd names another; bind: [from, onto] for that run only
function run(backend, script, env, { cwd = tmp, bind = null } = {}) {
  assert.ok(env.CLIENT_FILES_DIR, 'every run names its bucket')
  const [cmd, ...args] = [...(bind ? [...BIND, ...bind] : []), process.execPath, path.join(backend, 'scripts', script)]
  return spawnSync(cmd, args, {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), DBO_RELEASE_REPO: path.join(tmp, 'no-live-checkout'), ...GIT_ENV, ...env },
  })
}

const zipNames = file => JSON.parse(execFileSync('python3', ['-c',
  'import json, sys, zipfile; print(json.dumps(sorted(i.filename for i in zipfile.ZipFile(sys.argv[1]).infolist() if not i.is_dir())))', file],
{ encoding: 'utf8' }))

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// A git checkout at dir one commit behind its upstream, so a pull --ff-only has something to take; returns its HEAD reader
function behindCheckout(dir) {
  const upstream = `${dir}-upstream`
  fs.mkdirSync(upstream, { recursive: true })
  git(upstream, 'init', '-q')
  write(path.join(upstream, 'README'), 'one\n')
  git(upstream, 'add', 'README')
  git(upstream, 'commit', '-qm', 'one')
  git(tmp, 'clone', '-q', upstream, dir)
  write(path.join(upstream, 'README'), 'two\n')
  git(upstream, 'commit', '-qam', 'two')
  return () => git(dir, 'rev-parse', 'HEAD')
}

async function until(check, ms) {
  for (const end = Date.now() + ms; !check();) {
    if (Date.now() > end) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}

test('merge-files: refuses the live bucket, also through a symlink or below it, and writes nothing', () => {
  const live = liveCheckout('live-bucket')
  const exp = backendCopy(path.join(tmp, 'export-live-bucket'))
  const link = path.join(tmp, 'live-bucket-link')
  fs.symlinkSync(live.bucket, link)
  const before = snapshot(live.bucket)
  for (const bucket of [live.bucket, link, path.join(link, 'staging')]) {
    const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: bucket, DBO_RELEASE_REPO: live.repo })
    assert.equal(r.status, 1, `${bucket}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /refusing to write into the live client files: .* is the live client files bucket/)
    assert.match(r.stderr, /staged release path/)
    assert.match(r.stderr, /DBO_MERGE_LIVE_BUCKET=1/)
  }
  // Any other value is no opt-in
  const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: link, DBO_RELEASE_REPO: live.repo, DBO_MERGE_LIVE_BUCKET: 'true' })
  assert.equal(r.status, 1)
  assert.deepEqual(snapshot(live.bucket), before)
  assert.equal(fs.existsSync(path.join(exp, 'data', 'files-version.json')), false)

  // A live bucket that is itself a link is refused by the folder it points to as well
  const moved = path.join(tmp, 'live-bucket-moved')
  fs.renameSync(live.bucket, moved)
  fs.symlinkSync(moved, live.bucket)
  const target = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: moved, DBO_RELEASE_REPO: live.repo })
  assert.equal(target.status, 1, target.stdout + target.stderr)
  assert.match(target.stderr, /is the live client files bucket/)
  assert.deepEqual(snapshot(moved), before)
})

test('merge-files: refuses the default bucket of the checkout it runs from', () => {
  // CLIENT_FILES_DIR unset means this default, so the runs below name it instead of unsetting it
  assert.equal(config.clientFilesDir, liveBucket.DEFAULT_CLIENT_FILES_DIR)
  assert.match(liveBucket.liveTarget({ bucket: config.clientFilesDir }), /is the default bucket/)
  const checkout = path.join(tmp, 'checkout-default')
  const backend = backendCopy(checkout)
  const bucket = path.join(checkout, 'build', 'client-files')
  write(path.join(bucket, 'skymp-client.zip'), 'served zip')
  write(path.join(bucket, 'root', 'Data', 'Platform', 'UI', 'index.html'), 'served ui')
  const link = path.join(tmp, 'checkout-default-build')
  fs.symlinkSync(path.join(checkout, 'build'), link)
  const before = snapshot(bucket)
  for (const named of [bucket, [backend, '..', 'build', '.', 'client-files'].join(path.sep), path.join(link, 'client-files')]) {
    const r = run(backend, 'merge-files.js', { CLIENT_FILES_DIR: named })
    assert.equal(r.status, 1, `${named}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /refusing to write into the live client files: .* is the default bucket/)
  }
  assert.deepEqual(snapshot(bucket), before)
  assert.equal(fs.existsSync(path.join(backend, 'data', 'files-version.json')), false)
})

test('merge-files: refuses to run in the live checkout even with a work folder, since it would rewrite the live manifest', () => {
  const live = liveCheckout('live-manifest')
  const work = workFolder('work-live-manifest')
  const before = snapshot(live.repo)
  const r = run(live.backend, 'merge-files.js', { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /this is the live checkout: it would rewrite the live manifest/)
  assert.equal(fs.readFileSync(live.manifest, 'utf8'), '{"version":"live"}\n')
  assert.deepEqual(snapshot(live.repo), before)
  assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
})

test('merge-files: DBO_MERGE_LIVE_BUCKET=1 rebuilds the live files on purpose, but never re-zips the live root without a source', () => {
  const live = liveCheckout('live-opt-in')
  const env = { CLIENT_FILES_DIR: live.bucket, DBO_RELEASE_REPO: live.repo, DBO_MERGE_LIVE_BUCKET: '1' }
  const before = snapshot(live.repo)
  const bare = run(live.backend, 'merge-files.js', env)
  assert.equal(bare.status, 1, bare.stdout + bare.stderr)
  assert.match(bare.stderr, /there is no client source .*, so the zip would be whatever the live root .* already holds/)
  assert.deepEqual(snapshot(live.repo), before)

  write(path.join(live.backend, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  const merged = run(live.backend, 'merge-files.js', env)
  assert.equal(merged.status, 0, merged.stdout + merged.stderr)
  assert.match(merged.stderr, /DBO_MERGE_LIVE_BUCKET=1: writing into the live client files as asked/)
  assert.deepEqual(zipNames(path.join(live.bucket, 'skymp-client.zip')), ['Data/Platform/UI/index.html'])
  const manifest = JSON.parse(fs.readFileSync(live.manifest, 'utf8'))
  assert.deepEqual(manifest.files.map(f => f.path), ['Data/Platform/UI/index.html'])
  assert.equal(manifest.files[0].sha256, sha256('the new ui'))
})

test('merge-files: refuses an empty client source instead of zipping what the root already holds', () => {
  const exp = backendCopy(path.join(tmp, 'export-empty-source'))
  const work = workFolder('work-empty-source')
  // Only names the copy skips: nothing to merge
  write(path.join(exp, 'sources', 'client', '.gitignore'), '*\n')
  fs.mkdirSync(path.join(exp, 'sources', 'client', 'Data', 'Platform'), { recursive: true })
  const before = snapshot(work)
  const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: work })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /refusing to merge: the client source .* is empty, so the zip would be whatever .* already holds/)
  assert.deepEqual(snapshot(work), before)
  assert.equal(fs.existsSync(path.join(exp, 'data', 'files-version.json')), false)
})

test('merge-files: with no client source a work folder root is packaged as it is, and the zip holds only what the manifest lists', () => {
  const exp = backendCopy(path.join(tmp, 'export-as-is'))
  const work = workFolder('work-as-is', {
    ...WORK_FILES,
    'skymp5-client-settings.txt': 'the launcher writes this per player',
    'Data/Platform/.gitignore': '*.log\n',
    '.git/HEAD': 'ref: refs/heads/main\n',
  })
  const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: work })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const listed = JSON.parse(fs.readFileSync(path.join(exp, 'data', 'files-version.json'), 'utf8')).files.map(f => f.path).sort()
  assert.deepEqual(listed, Object.keys(WORK_FILES).sort())
  assert.deepEqual(zipNames(path.join(work, 'skymp-client.zip')), listed)
  assert.match(r.stdout, /no client source: packaging the work folder's root .* as it is/)

  // No source and nothing but skipped names in the root: nothing to package
  const bare = workFolder('work-as-is-bare', { 'skymp5-client-settings.txt': 'x' })
  const refused = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: bare })
  assert.equal(refused.status, 1, refused.stdout + refused.stderr)
  assert.match(refused.stderr, /there is no client source .* and no file in .* to package/)
  assert.equal(fs.existsSync(path.join(bare, 'skymp-client.zip')), false)
})

test('populate-files: refuses the live bucket and an empty build output, and writes the live root only when opted in', () => {
  const live = liveCheckout('live-populate')
  const exp = backendCopy(path.join(tmp, 'export-populate'))
  const link = path.join(tmp, 'live-populate-link')
  fs.symlinkSync(live.bucket, link)
  const src = path.join(tmp, 'build-populate', 'Data')
  write(path.join(src, 'Platform', 'UI', 'index.html'), 'the built ui')
  const before = snapshot(live.bucket)
  const refused = run(exp, 'populate-files.js', { SKYMP_CLIENT_DATA: src, CLIENT_FILES_DIR: link, DBO_RELEASE_REPO: live.repo })
  assert.equal(refused.status, 1, refused.stdout + refused.stderr)
  assert.match(refused.stderr, /refusing to write into the live client files: .* is the live client files bucket/)
  assert.deepEqual(snapshot(live.bucket), before)

  const work = workFolder('work-populate')
  const empty = path.join(tmp, 'build-populate-empty', 'Data')
  fs.mkdirSync(path.join(empty, 'Platform', 'UI'), { recursive: true })
  const workBefore = snapshot(work)
  const nothing = run(exp, 'populate-files.js', { SKYMP_CLIENT_DATA: empty, CLIENT_FILES_DIR: work })
  assert.equal(nothing.status, 1, nothing.stdout + nothing.stderr)
  assert.match(nothing.stderr, /Client build output is empty/)
  assert.deepEqual(snapshot(work), workBefore)

  const optedIn = run(exp, 'populate-files.js', { SKYMP_CLIENT_DATA: src, CLIENT_FILES_DIR: link, DBO_RELEASE_REPO: live.repo, DBO_MERGE_LIVE_BUCKET: '1' })
  assert.equal(optedIn.status, 0, optedIn.stdout + optedIn.stderr)
  assert.equal(fs.readFileSync(path.join(live.bucket, 'root', 'Data', 'Platform', 'UI', 'index.html'), 'utf8'), 'the built ui')
})

test('setup-client: refuses the live files before it pulls, and pulls only a checkout of its own', { skip: !HAS_GIT && 'git is not installed' }, () => {
  const live = liveCheckout('live-setup')
  const clientDir = path.join(live.backend, 'sources', 'client')
  const head = behindCheckout(clientDir)
  const start = head()
  const before = snapshot(live.bucket)
  const refused = run(live.backend, 'setup-client.js', { CLIENT_FILES_DIR: live.bucket, DBO_RELEASE_REPO: live.repo })
  assert.equal(refused.status, 1, refused.stdout + refused.stderr)
  assert.match(refused.stderr, /\[setup\] refusing to write into the live client files/)
  assert.equal(head(), start)
  assert.deepEqual(snapshot(live.bucket), before)

  // A .git folder git does not accept makes git -C land in the checkout around it
  const outer = path.join(tmp, 'outer-setup')
  const outerHead = behindCheckout(outer)
  const outerStart = outerHead()
  const backend = backendCopy(outer)
  fs.mkdirSync(path.join(backend, 'sources', 'client', '.git'), { recursive: true })
  write(path.join(backend, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'a plain folder')
  const work = workFolder('work-setup')
  const plain = run(backend, 'setup-client.js', { CLIENT_FILES_DIR: work })
  assert.equal(plain.status, 1, plain.stdout + plain.stderr)
  assert.match(plain.stderr, /\[setup\] refusing to pull: .* is not its own git checkout \(git -C lands in .*outer-setup\)/)
  assert.equal(outerHead(), outerStart)
  assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
})

test('webhook: a signed push never pulls the checkout around a plain sources/client', { skip: !HAS_GIT && 'git is not installed' }, async (t) => {
  const outer = path.join(tmp, 'outer-webhook')
  const head = behindCheckout(outer)
  const start = head()
  const backend = backendCopy(outer)
  write(path.join(backend, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'a plain folder, not a checkout')
  const work = workFolder('work-webhook')

  // The copy's modules read these while they load
  const env = { CLIENT_FILES_DIR: work, GITHUB_WEBHOOK_SECRET: 'test-secret' }
  Object.assign(process.env, env)
  t.after(() => { for (const key of Object.keys(env)) delete process.env[key] })
  const errors = t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'warn', () => {})
  const express = require('express')
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use('/webhooks', require(path.join(backend, 'routes', 'webhook.js')))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const body = JSON.stringify({ ref: 'refs/heads/main', pusher: { name: 'test' }, commits: [{}] })
  const signature = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(body).digest('hex')
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, path: '/webhooks/github', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': signature },
    }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.end(body)
  })
  assert.equal(status, 200)

  const said = () => errors.mock.calls.map(c => c.arguments.join(' ')).join('\n')
  await until(() => /refusing to pull/.test(said()) || head() !== start, 15000)
  assert.equal(head(), start, 'the push pulled the checkout around sources/client')
  assert.match(said(), /\[webhook\] refusing to pull: .* is not its own git checkout \(git -C lands in .*outer-webhook\)/)
  assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
})

test('webhook: never pulls or merges for the live files whatever DBO_MERGE_LIVE_BUCKET says, and pulls and merges its own checkout into a work folder', { skip: !HAS_GIT && 'git is not installed' }, async (t) => {
  t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
  const { pullAndMerge } = require('../routes/webhook').internals
  const live = liveCheckout('live-webhook')
  const link = path.join(tmp, 'live-webhook-link')
  fs.symlinkSync(live.bucket, link)
  const releaseRepo = config.releaseRepo
  config.releaseRepo = live.repo
  process.env.DBO_MERGE_LIVE_BUCKET = '1'
  t.after(() => { config.releaseRepo = releaseRepo; delete process.env.DBO_MERGE_LIVE_BUCKET })

  const clientDir = path.join(tmp, 'client-webhook')
  const head = behindCheckout(clientDir)
  const start = head()
  let merges = 0
  const merge = async () => { merges++ }
  for (const bucket of [live.bucket, link, liveBucket.DEFAULT_CLIENT_FILES_DIR]) {
    assert.equal(await pullAndMerge({ clientDir, bucket, merge }), 'refused', bucket)
  }
  assert.equal(head(), start)
  assert.equal(merges, 0)

  const work = workFolder('work-webhook-own')
  fs.mkdirSync(path.join(clientDir, 'plain'))
  assert.equal(await pullAndMerge({ clientDir: path.join(clientDir, 'plain'), bucket: work, merge }), 'refused')
  assert.equal(await pullAndMerge({ clientDir: path.join(tmp, 'no-such-client'), bucket: work, merge }), 'refused')
  assert.equal(head(), start)
  assert.equal(await pullAndMerge({ clientDir, bucket: work, merge }), 'merged')
  assert.notEqual(head(), start)
  assert.equal(merges, 1)
  assert.equal(await pullAndMerge({ clientDir, bucket: work, merge }), 'up-to-date')
  assert.equal(merges, 1)
})

// The paths merge-files writes, not only the bucket folder: a work folder can hold links and hard links into the live files

const read = file => fs.readFileSync(file, 'utf8')
const tempLeft = dir => fs.readdirSync(dir).filter(name => name.endsWith('.tmp'))

test('merge-files: refuses a work folder whose root, zip or a file or folder in its root links into the live files', () => {
  const live = liveCheckout('live-links')
  const exp = backendCopy(path.join(tmp, 'export-links'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'brand-new.html'), 'a new page')
  const liveRoot = path.join(live.bucket, 'root')
  const before = snapshot(live.bucket)

  // The root itself a link to the live root
  const rootLink = path.join(tmp, 'work-root-link')
  fs.mkdirSync(rootLink)
  fs.symlinkSync(liveRoot, path.join(rootLink, 'root'))
  // The zip a link to the live zip
  const zipLink = workFolder('work-zip-link')
  fs.symlinkSync(path.join(live.bucket, 'skymp-client.zip'), path.join(zipLink, 'skymp-client.zip'))
  // One folder of the root a link into the live root
  const folderLink = path.join(tmp, 'work-folder-link')
  fs.mkdirSync(path.join(folderLink, 'root', 'Data', 'Platform'), { recursive: true })
  fs.symlinkSync(path.join(liveRoot, 'Data', 'Platform', 'UI'), path.join(folderLink, 'root', 'Data', 'Platform', 'UI'))
  // A file of the root a link to a live file that does not exist yet: a copy through it would create it there
  const newLink = workFolder('work-new-file-link')
  fs.symlinkSync(path.join(liveRoot, 'Data', 'Platform', 'UI', 'brand-new.html'), path.join(newLink, 'root', 'Data', 'Platform', 'UI', 'brand-new.html'))

  for (const [work, named] of [[rootLink, 'root'], [zipLink, 'skymp-client.zip'], [folderLink, 'UI'], [newLink, 'brand-new.html']]) {
    const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })
    assert.equal(r.status, 1, `${work}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, new RegExp(`refusing to write into the live client files: \\S*${named.replace('.', '\\.')} is in the live client files bucket`))
    assert.deepEqual(snapshot(live.bucket), before, work)
  }
  assert.equal(read(live.manifest), '{"version":"live"}\n')
  assert.equal(fs.existsSync(path.join(exp, 'data', 'files-version.json')), false)
})

test('merge-files: a work folder hard-linked to the live files (cp -al) never rewrites them', () => {
  const live = liveCheckout('live-hardlinks')
  const exp = backendCopy(path.join(tmp, 'export-hardlinks'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  const liveZip = path.join(live.bucket, 'skymp-client.zip')
  const before = snapshot(live.bucket)
  const env = work => ({ CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })

  // The zip a hard link to the live zip, alone or in a cp -al copy of the whole live bucket: refused
  const zipLink = workFolder('work-zip-hardlink')
  fs.linkSync(liveZip, path.join(zipLink, 'skymp-client.zip'))
  const bucketCopy = path.join(tmp, 'work-cp-al-bucket')
  execFileSync('cp', ['-al', live.bucket, bucketCopy])
  for (const work of [zipLink, bucketCopy]) {
    const r = run(exp, 'merge-files.js', env(work))
    assert.equal(r.status, 1, `${work}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /skymp-client\.zip is a hard link to the live skymp-client\.zip/)
    assert.deepEqual(snapshot(live.bucket), before, work)
  }

  // The export's manifest a hard link to the live manifest: refused
  const work = workFolder('work-manifest-hardlink')
  fs.linkSync(live.manifest, path.join(exp, 'data', 'files-version.json'))
  const manifestLink = run(exp, 'merge-files.js', env(work))
  assert.equal(manifestLink.status, 1, manifestLink.stdout + manifestLink.stderr)
  assert.match(manifestLink.stderr, /files-version\.json is a hard link to the live files-version\.json/)
  assert.equal(read(live.manifest), '{"version":"live"}\n')
  fs.unlinkSync(path.join(exp, 'data', 'files-version.json'))

  // A cp -al copy of the live root: the copy writes a new file instead of through the hard link, and the live root stays as it was
  const rootCopy = path.join(tmp, 'work-cp-al-root')
  fs.mkdirSync(rootCopy)
  execFileSync('cp', ['-al', path.join(live.bucket, 'root'), path.join(rootCopy, 'root')])
  const merged = run(exp, 'merge-files.js', env(rootCopy))
  assert.equal(merged.status, 0, merged.stdout + merged.stderr)
  assert.equal(read(path.join(rootCopy, 'root', 'Data', 'Platform', 'UI', 'index.html')), 'the new ui')
  assert.deepEqual(zipNames(path.join(rootCopy, 'skymp-client.zip')), ['Data/Platform/UI/index.html'])
  assert.deepEqual(snapshot(live.bucket), before)
  assert.equal(read(live.manifest), '{"version":"live"}\n')
})

test('merge-files: replaces the zip, the manifest and each copied file with a new file, never writing through another name of it', () => {
  const exp = backendCopy(path.join(tmp, 'export-other-names'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  const work = workFolder('work-other-names')
  const others = {}
  for (const [name, target] of [['zip', path.join(work, 'skymp-client.zip')], ['manifest', path.join(exp, 'data', 'files-version.json')],
    ['ui', path.join(work, 'root', 'Data', 'Platform', 'UI', 'index.html')]]) {
    others[name] = path.join(tmp, `other-names-${name}`)
    write(others[name], `another ${name}`)
    fs.rmSync(target, { force: true })
    fs.linkSync(others[name], target)
  }
  const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: work })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const [name, file] of Object.entries(others)) assert.equal(read(file), `another ${name}`, `the ${name} was written through its other name`)
  assert.equal(read(path.join(work, 'root', 'Data', 'Platform', 'UI', 'index.html')), 'the new ui')
  assert.deepEqual(zipNames(path.join(work, 'skymp-client.zip')), Object.keys(WORK_FILES).sort())
  const manifest = JSON.parse(read(path.join(exp, 'data', 'files-version.json')))
  assert.deepEqual(manifest.files.map(f => f.path).sort(), Object.keys(WORK_FILES).sort())
  assert.deepEqual([...tempLeft(work), ...tempLeft(path.join(exp, 'data'))], [])
})

test('merge-files: the PC\'s Build Client (populate-files, then merge-files) packages its own default bucket with the opt-in, and is refused without it', () => {
  const checkout = path.join(tmp, 'pc-checkout')
  const backend = backendCopy(checkout)
  const bucket = path.join(checkout, 'build', 'client-files')
  // populate-files' default source, the CI client build
  const built = path.join(checkout, 'build', 'dist', 'client', 'Data')
  write(path.join(built, 'Platform', 'UI', 'index.html'), 'pc ui')
  write(path.join(built, 'Platform', 'Plugins', 'skymp5-client.js'), 'pc client')
  // CLIENT_FILES_DIR unset on the PC means this bucket; the runs here name it, which the guard treats the same
  const env = { CLIENT_FILES_DIR: bucket }
  assert.equal(fs.existsSync(path.join(backend, 'sources', 'client')), false)

  for (const script of ['populate-files.js', 'merge-files.js']) {
    const refused = run(backend, script, env)
    assert.equal(refused.status, 1, `${script}: ${refused.stdout}${refused.stderr}`)
    assert.match(refused.stderr, /is the default bucket/)
  }
  assert.equal(fs.existsSync(bucket), false)

  const optIn = { ...env, DBO_MERGE_LIVE_BUCKET: '1' }
  const populated = run(backend, 'populate-files.js', optIn)
  assert.equal(populated.status, 0, populated.stdout + populated.stderr)
  const merged = run(backend, 'merge-files.js', optIn)
  assert.equal(merged.status, 0, merged.stdout + merged.stderr)
  assert.match(merged.stderr, /DBO_MERGE_LIVE_BUCKET=1: writing into the live client files as asked/)
  const files = ['Data/Platform/Plugins/skymp5-client.js', 'Data/Platform/UI/index.html']
  assert.deepEqual(zipNames(path.join(bucket, 'skymp-client.zip')), files)
  assert.deepEqual(JSON.parse(read(path.join(backend, 'data', 'files-version.json'))).files.map(f => f.path).sort(), files)
})

test('populate-files: refuses a work folder whose root links into the live root, before it deletes anything', () => {
  const live = liveCheckout('live-populate-root-link')
  const exp = backendCopy(path.join(tmp, 'export-populate-root-link'))
  const src = path.join(tmp, 'build-populate-root-link', 'Data')
  write(path.join(src, 'Platform', 'UI', 'index.html'), 'the built ui')
  const work = path.join(tmp, 'work-populate-root-link')
  fs.mkdirSync(work)
  fs.symlinkSync(path.join(live.bucket, 'root'), path.join(work, 'root'))
  const before = snapshot(live.bucket)
  const r = run(exp, 'populate-files.js', { SKYMP_CLIENT_DATA: src, CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /refusing to write into the live client files: \S*root is in the live client files bucket/)
  assert.deepEqual(snapshot(live.bucket), before)
})

test('setup-client and the webhook: never pull the live checkout through a link, nor a checkout whose .git is another checkout\'s', { skip: !HAS_GIT && 'git is not installed' }, async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
  const { pullAndMerge } = require('../routes/webhook').internals
  const live = liveCheckout('live-git', { asCheckout: true })
  const liveStart = live.head()
  const releaseRepo = config.releaseRepo
  config.releaseRepo = live.repo
  t.after(() => { config.releaseRepo = releaseRepo })
  let merges = 0
  const merge = async () => { merges++ }
  const said = () => errors.mock.calls.map(c => c.arguments.join(' ')).join('\n')

  // sources/client a link to the live checkout's top level: its real path is that top level, so the top-level check alone let it pull
  const exp = backendCopy(path.join(tmp, 'export-client-link'))
  const clientLink = path.join(exp, 'sources', 'client')
  fs.symlinkSync(live.repo, clientLink)
  const work = workFolder('work-client-link')
  const setup = run(exp, 'setup-client.js', { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })
  assert.equal(live.head(), liveStart, 'setup-client pulled the live checkout')
  assert.equal(setup.status, 1, setup.stdout + setup.stderr)
  assert.match(setup.stderr, /\[setup\] refusing to clone or pull: .* is in the live checkout/)
  assert.equal(await pullAndMerge({ clientDir: clientLink, bucket: work, merge }), 'refused')
  assert.equal(live.head(), liveStart, 'the webhook pulled the live checkout')
  assert.match(said(), /\[webhook\] refusing to pull: .* is in the live checkout/)

  // A checkout of its own, but inside the live checkout, or holding it
  const inside = path.join(live.repo, 'vendor', 'client')
  const insideHead = behindCheckout(inside)
  const insideStart = insideHead()
  const holder = path.join(tmp, 'holder-git')
  const holderHead = behindCheckout(holder)
  const holderStart = holderHead()
  assert.equal(await pullAndMerge({ clientDir: inside, bucket: work, merge }), 'refused')
  config.releaseRepo = path.join(holder, 'live')
  assert.equal(await pullAndMerge({ clientDir: holder, bucket: work, merge }), 'refused')
  config.releaseRepo = live.repo
  assert.equal(insideHead(), insideStart)
  assert.equal(holderHead(), holderStart)
  assert.match(said(), /holds the live checkout .*holder-git.live/)

  // A .git file or a .git link that borrows another checkout's git folder: the pull would move that checkout's branch
  const other = path.join(tmp, 'other-git')
  const otherHead = behindCheckout(other)
  const otherStart = otherHead()
  for (const kind of ['file', 'link']) {
    const borrower = backendCopy(path.join(tmp, `export-git-${kind}`))
    const client = path.join(borrower, 'sources', 'client')
    write(path.join(client, 'Data', 'Platform', 'UI', 'index.html'), 'a client folder')
    if (kind === 'file') write(path.join(client, '.git'), `gitdir: ${path.join(other, '.git')}\n`)
    else fs.symlinkSync(path.join(other, '.git'), path.join(client, '.git'))
    const borrowed = run(borrower, 'setup-client.js', { CLIENT_FILES_DIR: workFolder(`work-git-${kind}`) })
    assert.equal(otherHead(), otherStart, `setup-client pulled through a .git ${kind}`)
    assert.equal(borrowed.status, 1, borrowed.stdout + borrowed.stderr)
    assert.match(borrowed.stderr, /\[setup\] refusing to pull: .* has no git folder of its own/)
    assert.equal(await pullAndMerge({ clientDir: client, bucket: work, merge }), 'refused')
    assert.equal(otherHead(), otherStart, `the webhook pulled through a .git ${kind}`)
  }
  assert.match(said(), /\[webhook\] refusing to pull: .* has no git folder of its own/)
  assert.equal(merges, 0)
  assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
})

test('the opt-in in a .env is no opt-in: merge-files and populate-files refuse and name the file', () => {
  const live = liveCheckout('live-dotenv')
  const exp = backendCopy(path.join(tmp, 'export-dotenv'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  const src = path.join(tmp, 'build-dotenv', 'Data')
  write(path.join(src, 'Platform', 'UI', 'index.html'), 'the built ui')
  const env = { CLIENT_FILES_DIR: live.bucket, DBO_RELEASE_REPO: live.repo, SKYMP_CLIENT_DATA: src }
  const before = snapshot(live.bucket)

  // A .env in the folder the script runs from, which config.js loads
  const cwd = path.join(tmp, 'cwd-dotenv')
  write(path.join(cwd, '.env'), 'DBO_MERGE_LIVE_BUCKET=1\n')
  for (const script of ['merge-files.js', 'populate-files.js']) {
    const r = run(exp, script, env, { cwd })
    assert.equal(r.status, 1, `${script}: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /DBO_MERGE_LIVE_BUCKET is set in \S*cwd-dotenv.\.env, which would turn this guard off/)
    assert.deepEqual(snapshot(live.bucket), before, script)
  }

  // The backend's own .env, which merge-files loads, even with the opt-in on the command line as well
  write(path.join(exp, '.env'), 'PORT=4000\nexport DBO_MERGE_LIVE_BUCKET = 1\n')
  const r = run(exp, 'merge-files.js', { ...env, DBO_MERGE_LIVE_BUCKET: '1' })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /DBO_MERGE_LIVE_BUCKET is set in \S*export-dotenv.skymp5-backend.\.env/)
  assert.deepEqual(snapshot(live.bucket), before)
  assert.equal(read(live.manifest), '{"version":"live"}\n')
})

test('merge-files: checks every folder and file the copy writes, so a link two levels down into the live root is refused before anything is written', () => {
  const live = liveCheckout('live-deep-link')
  const exp = backendCopy(path.join(tmp, 'export-deep-link'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  write(path.join(exp, 'sources', 'client', 'a.dll'), 'a new dll')
  // root/Data links to a folder outside the live files, and that folder's Platform links into the live root
  const stash = path.join(tmp, 'stash-deep-link', 'Data')
  fs.mkdirSync(stash, { recursive: true })
  fs.symlinkSync(path.join(live.bucket, 'root', 'Data', 'Platform'), path.join(stash, 'Platform'))
  const work = path.join(tmp, 'work-deep-link')
  fs.mkdirSync(path.join(work, 'root'), { recursive: true })
  fs.symlinkSync(stash, path.join(work, 'root', 'Data'))
  const before = snapshot(live.bucket)
  const r = run(exp, 'merge-files.js', { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo })
  assert.deepEqual(snapshot(live.bucket), before, r.stdout + r.stderr)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /refusing to write into the live client files: \S*root.Data.Platform is in the live client files bucket/)
  assert.deepEqual(fs.readdirSync(path.join(work, 'root')), ['Data'])
  assert.deepEqual(fs.readdirSync(stash), ['Platform'])
  assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
  assert.equal(fs.existsSync(path.join(exp, 'data', 'files-version.json')), false)
})

test('setup-client and the webhook: never pull a sources/client whose .git folder shares another checkout\'s (commondir, git-new-workdir, GIT_COMMON_DIR)', { skip: !HAS_GIT && 'git is not installed' }, async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
  const { pullAndMerge } = require('../routes/webhook').internals
  const live = liveCheckout('live-shared-git', { asCheckout: true })
  const other = path.join(tmp, 'other-shared-git')
  behindCheckout(other)
  const mains = () => [live.repo, other].map(repo => git(repo, 'rev-parse', 'refs/heads/main'))
  const start = mains()
  const releaseRepo = config.releaseRepo
  config.releaseRepo = live.repo
  t.after(() => { config.releaseRepo = releaseRepo; delete process.env.GIT_COMMON_DIR })
  let merges = 0
  const merge = async () => { merges++ }
  const said = () => errors.mock.calls.map(c => c.arguments.join(' ')).join('\n')
  const newWorkdir = '/usr/share/doc/git/contrib/workdir/git-new-workdir'

  // Each shape: how sources/client is made, the env of the pull, and why it is refused
  const shapes = [
    // A real .git folder with its own HEAD and index, whose commondir names the live checkout's .git
    ['commondir', client => {
      write(path.join(client, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      write(path.join(client, '.git', 'commondir'), `${path.join(live.repo, '.git')}\n`)
      git(client, 'reset', '-q', '--hard')
    }, {}, /holds a commondir file/],
    // git's own contrib script: a .git folder whose refs, objects and config are links into the live .git
    ...(fs.existsSync(newWorkdir) ? [['git-new-workdir', client => {
      execFileSync('sh', [newWorkdir, live.repo, client, 'main'], { stdio: 'ignore' })
    }, {}, /\.git.\S+ is a link to \S*live-shared-git/]] : []),
    // A .git folder of its own, but GIT_COMMON_DIR in the env sends the refs and objects to another checkout's .git
    ['GIT_COMMON_DIR live', client => {
      git(tmp, 'clone', '-q', `${live.repo}-upstream`, client)
      git(client, 'reset', '-q', '--hard', 'HEAD~1')
    }, { GIT_COMMON_DIR: path.join(live.repo, '.git') }, /git keeps its common folder at \S*live-shared-git.\.git, and .* is in the live checkout/],
    ['GIT_COMMON_DIR other', client => {
      git(tmp, 'clone', '-q', `${other}-upstream`, client)
      git(client, 'reset', '-q', '--hard', 'HEAD~1')
    }, { GIT_COMMON_DIR: path.join(other, '.git') }, /git keeps its common folder at \S*other-shared-git.\.git, outside /],
  ]
  for (const [shape, make, env, why] of shapes) {
    const exp = backendCopy(path.join(tmp, `export-shared-${shape.replace(' ', '-')}`))
    const client = path.join(exp, 'sources', 'client')
    make(client)
    const work = workFolder(`work-shared-${shape.replace(' ', '-')}`)
    const setup = run(exp, 'setup-client.js', { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo, ...env })
    assert.deepEqual(mains(), start, `setup-client moved a main branch through ${shape}`)
    assert.equal(setup.status, 1, `${shape}: ${setup.stdout}${setup.stderr}`)
    assert.match(setup.stderr, /\[setup\] refusing to pull: .* has no git folder of its own: /, shape)
    assert.match(setup.stderr, why, shape)
    Object.assign(process.env, env)
    const pulled = await pullAndMerge({ clientDir: client, bucket: work, merge })
    delete process.env.GIT_COMMON_DIR
    assert.deepEqual(mains(), start, `the webhook moved a main branch through ${shape}`)
    assert.equal(pulled, 'refused', shape)
    assert.match(said(), why, shape)
    assert.equal(fs.existsSync(path.join(work, 'skymp-client.zip')), false)
  }
  assert.equal(merges, 0)
})

test('merge-files and populate-files: a work root bind-mounted from the live root is refused, as the same folder by device and inode', (t) => {
  const live = liveCheckout('live-bind')
  const probe = [path.join(tmp, 'bind-probe-from'), path.join(tmp, 'bind-probe-onto')]
  probe.forEach(dir => fs.mkdirSync(dir))
  const [cmd, ...args] = [...BIND, ...probe, 'true']
  if (process.platform !== 'linux' || spawnSync(cmd, args).status !== 0) return t.skip('mount --bind in a private mount namespace is not permitted here')
  const exp = backendCopy(path.join(tmp, 'export-bind'))
  write(path.join(exp, 'sources', 'client', 'Data', 'Platform', 'UI', 'index.html'), 'the new ui')
  const src = path.join(tmp, 'build-bind', 'Data')
  write(path.join(src, 'Platform', 'UI', 'index.html'), 'the built ui')
  const liveRoot = path.join(live.bucket, 'root')
  const before = snapshot(live.bucket)

  for (const [script, from, onto] of [
    ['merge-files.js', liveRoot, 'root'],
    ['populate-files.js', liveRoot, 'root'],
    ['populate-files.js', path.join(liveRoot, 'Data'), path.join('root', 'Data')],
  ]) {
    const work = path.join(tmp, `work-bind-${script}-${onto.replace(path.sep, '-')}`)
    fs.mkdirSync(path.join(work, onto), { recursive: true })
    const r = run(exp, script, { CLIENT_FILES_DIR: work, DBO_RELEASE_REPO: live.repo, SKYMP_CLIENT_DATA: src }, { bind: [from, path.join(work, onto)] })
    assert.deepEqual(snapshot(live.bucket), before, `${script} with ${onto} bind-mounted: ${r.stdout}${r.stderr}`)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /refusing to write into the live client files: \S+ lands in the live folder \S+ under another name \(a bind mount\)/)
    assert.ok(!fs.readFileSync('/proc/self/mountinfo', 'utf8').includes(work), 'the bind mount outlived its run')
    assert.deepEqual(fs.readdirSync(path.join(work, onto)), [])
  }
  assert.equal(read(live.manifest), '{"version":"live"}\n')
})

test('the opt-in in a .env on Windows: a key in any case is found, since Windows env names ignore case', (t) => {
  const cwd = path.join(tmp, 'cwd-dotenv-case')
  write(path.join(cwd, '.env'), 'PORT=4000\ndbo_merge_live_bucket=1\n')
  const was = process.cwd()
  process.chdir(cwd)
  t.after(() => process.chdir(was))
  assert.equal(liveBucket.optInFile(), null, 'Linux env names keep their case')
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  t.after(() => Object.defineProperty(process, 'platform', platform))
  assert.equal(liveBucket.optInFile(), path.join(process.cwd(), '.env'))
  assert.equal(liveBucket.optedIn({ DBO_MERGE_LIVE_BUCKET: '1' }), false)
})
