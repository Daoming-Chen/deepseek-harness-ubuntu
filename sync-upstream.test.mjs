import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectUpstreamRelease, resolveReleaseCommit, detectUpstreamRelease } from './sync-upstream.mjs'

const before = 'a'.repeat(40)
const after = 'b'.repeat(40)
const release = (version, extra = {}) => ({ tag_name: `dsh-v${version}`, draft: false, ...extra })

test('follows newer RC/stable versions while preserving the current pin against alpha, drafts and older releases', () => {
  const values = [release('0.2.2-rc.1'), release('0.2.2-rc.2'), release('0.2.2'), release('0.3.0-alpha.1'), release('0.3.0', { draft: true }), { tag_name: 'vendor-v9.0.0' }]
  assert.equal(selectUpstreamRelease(values, '0.2.2-rc.1').version, '0.2.2')
  assert.equal(selectUpstreamRelease([release('0.2.2-rc.1'), release('0.2.1')], '0.2.2-rc.1'), null)
  assert.equal(selectUpstreamRelease([release('0.2.3-rc.1')], '0.2.2').version, '0.2.3-rc.1')
})

test('peels annotated tags and refuses invalid source identifiers', async () => {
  assert.equal(await resolveReleaseCommit('dsh-v0.2.2', async path => ({ object: path.includes('/git/ref/') ? { type: 'tag', sha: before } : { type: 'commit', sha: after } })), after)
  await assert.rejects(resolveReleaseCommit('dsh-v0.2.2', async () => ({ object: { type: 'commit', sha: 'not-a-commit' } })), /invalid object/u)
})

function officialMetadata(version = '0.2.2', history = 'ahead') {
  return async path => {
    if (path.startsWith('/releases?')) return [release('0.2.2')]
    if (path.startsWith('/git/ref/')) return { object: { type: 'commit', sha: after } }
    if (path.startsWith('/contents/')) return { encoding: 'base64', content: Buffer.from(JSON.stringify({ version })).toString('base64') }
    if (path.startsWith('/compare/')) return { status: history }
    throw new Error(`Unexpected request: ${path}`)
  }
}

test('accepts only an exact source version with forward history', async () => {
  const current = { commit: before, productVersion: '0.2.2-rc.1' }
  assert.deepEqual(await detectUpstreamRelease(current, officialMetadata()), { commit: after, productVersion: '0.2.2', releaseTag: 'dsh-v0.2.2' })
  await assert.rejects(detectUpstreamRelease(current, officialMetadata('0.2.1')), /disagree/u)
  await assert.rejects(detectUpstreamRelease(current, officialMetadata('0.2.2', 'behind')), /not ahead/u)
})
