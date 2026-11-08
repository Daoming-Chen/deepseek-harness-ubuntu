import assert from 'node:assert/strict'
import { test } from 'node:test'
import semver from 'semver'
import { desktopBuildVersion, assertPublicationAdvances, onlinePublication } from './release-policy.mjs'

test('both workflow entry points share ordered UTC versions independent of their run_number', () => {
  const version = (time, id, attempt = 1) => desktopBuildVersion('0.2.2-rc.1', new Date(time), id, attempt)
  const first = version('2026-11-08T00:00:01Z', 42451393336)
  const later = version('2026-11-08T00:00:02Z', 42451393337)
  assert.equal(first, '0.2.2-rc.1.20261108000001.42451393336.1')
  assert.ok(semver.gt(first, '0.2.2-rc.1.20261108.99999'))
  assert.ok(semver.gt(later, first))
  assert.ok(semver.gt(version('2026-11-08T00:00:01Z', 42451393337), first))
  assert.ok(semver.gt(version('2026-11-08T00:00:01Z', 42451393336, 2), first))
  assert.ok(semver.valid(desktopBuildVersion('0.2.2', new Date('2026-11-08T00:00:00Z'), 1, 1)))
  assert.match(desktopBuildVersion('0.2.2', new Date('2026-11-08T00:00:00Z'), 1, 1), /^0\.2\.2-test\./u)
})

test('publication rejects a queued old source even if its desktop build time is newer', () => {
  assert.throws(() => assertPublicationAdvances(
    { productVersion: '0.2.2-rc.1', desktopVersion: '0.2.2-rc.1.20261109120000.12.1' },
    { productVersion: '0.2.2', desktopVersion: '0.2.2-rc.1.20261108120000.11.1' }), /older official source/u)
})

test('publication requires a strictly newer desktop and permits same-source patch rebuilds', () => {
  const online = { productVersion: '0.2.2', desktopVersion: '0.2.2-test.20261108120000.11.1' }
  assert.throws(() => assertPublicationAdvances({ ...online }, online), /duplicate or older desktop/u)
  assert.throws(() => assertPublicationAdvances({ ...online, desktopVersion: '0.2.2-test.20261108.8' }, online), /duplicate or older desktop/u)
  assert.doesNotThrow(() => assertPublicationAdvances({ ...online, desktopVersion: '0.2.2-test.20261108120001.12.1' }, online))
  assert.doesNotThrow(() => assertPublicationAdvances(online, null))
  assert.throws(() => assertPublicationAdvances({ productVersion: 'broken', desktopVersion: online.desktopVersion }, null), /Invalid/u)
  assert.throws(() => assertPublicationAdvances(online, {}), /Missing online/u)
})

function mockOnline({ status = 200, omitFeed = false, feed = 'version: 0.2.2-test.20261108.7\nfiles: []\n', tag = 'ubuntu-v0.2.2-test.20261108.7' } = {}) {
  return async url => {
    if (url.includes('api.github.com')) return { status, ok: status === 200, json: async () => ({ tag_name: tag, assets: ['upstream.json', ...(omitFeed ? [] : ['stable-linux.yml'])].map(name => ({ name, browser_download_url: `https://github.com/owner/repo/releases/download/${tag}/${name}` })) }) }
    return { ok: true, text: async () => url.endsWith('upstream.json') ? JSON.stringify({ productVersion: '0.2.2' }) : feed }
  }
}

test('reads actual online source/feed metadata and fails closed on incomplete or unavailable releases', async () => {
  assert.deepEqual(await onlinePublication('owner/repo', mockOnline()), { productVersion: '0.2.2', desktopVersion: '0.2.2-test.20261108.7' })
  assert.equal((await onlinePublication('owner/repo', mockOnline({ feed: 'version: "0.2.2-test.20261108.7"\n' }))).desktopVersion, '0.2.2-test.20261108.7')
  assert.equal(await onlinePublication('owner/repo', mockOnline({ status: 404 })), null)
  await assert.rejects(onlinePublication('owner/repo', mockOnline({ status: 503 })), /HTTP 503/u)
  await assert.rejects(onlinePublication('owner/repo', mockOnline({ omitFeed: true })), /missing trusted/u)
  await assert.rejects(onlinePublication('owner/repo', mockOnline({ tag: 'ubuntu-vwrong' })), /disagree/u)
  await assert.rejects(onlinePublication('owner/repo', mockOnline({ feed: 'files: []\n' })), /Invalid update feed/u)
})
