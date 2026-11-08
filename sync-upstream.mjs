/** Follow published official RC and stable releases after validating their source identity. */
import { appendFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import semver from 'semver'

const repository = 'deepseek-ai/deepseek-harness'
const shaPattern = /^[a-f0-9]{40}$/u

/** Select the newest published RC/stable release newer than our current source version. */
export function selectUpstreamRelease(releases, currentVersion) {
  if (semver.valid(currentVersion) === null) throw new Error('Invalid pinned source version')
  return releases.filter(release => !release.draft && typeof release.tag_name === 'string' && release.tag_name.startsWith('dsh-v'))
    .map(release => ({ ...release, version: release.tag_name.slice(5) }))
    .filter(release => semver.valid(release.version) !== null)
    .filter(release => {
      const fields = semver.prerelease(release.version)
      return fields === null || fields[0] === 'rc'
    })
    .filter(release => semver.gt(release.version, currentVersion))
    .sort((left, right) => semver.rcompare(left.version, right.version))[0] ?? null
}

async function api(path) {
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: { 'User-Agent': 'deepseek-harness-ubuntu-upstream-sync', Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Official GitHub metadata request failed: HTTP ${response.status}`)
  return response.json()
}

/** Resolve lightweight and annotated official tags to an exact commit. */
export async function resolveReleaseCommit(tagName, request = api) {
  let object = (await request(`/git/ref/tags/${encodeURIComponent(tagName)}`)).object
  for (let depth = 0; depth < 5; depth++) {
    if (!object || !shaPattern.test(object.sha)) throw new Error('Official release tag returned an invalid object')
    if (object.type === 'commit') return object.sha
    if (object.type !== 'tag') throw new Error('Official release tag does not reference a commit')
    object = (await request(`/git/tags/${object.sha}`)).object
  }
  throw new Error('Official release tag nesting exceeds the supported depth')
}

/** Reject source-version mismatches and source history reversals before building a candidate. */
export async function detectUpstreamRelease(current, request = api) {
  if (!shaPattern.test(current.commit)) throw new Error('Pinned source commit is invalid')
  const release = selectUpstreamRelease(await request('/releases?per_page=100'), current.productVersion)
  if (release === null) return null
  const commit = await resolveReleaseCommit(release.tag_name, request)
  const file = await request(`/contents/package.json?ref=${commit}`)
  if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('Official package manifest is unavailable')
  const manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'))
  if (manifest.version !== release.version) throw new Error('Official release tag and source package version disagree')
  const comparison = await request(`/compare/${current.commit}...${commit}`)
  if (comparison.status !== 'ahead') throw new Error('Official release source is not ahead of our pin; manual compatibility review is required')
  return { commit, productVersion: release.version, releaseTag: release.tag_name }
}

/** Hold a failed candidate until its inputs change or a maintainer explicitly retries it. */
export function shouldHoldFailedCandidate(candidate, state, inputsHash, forceRetry = false) {
  const failed = state?.failedCandidate
  if (failed == null || forceRetry) return false
  if (!shaPattern.test(failed.commit) || !/^[a-f0-9]{64}$/u.test(failed.buildInputsHash)) throw new Error('Invalid failed-candidate state')
  return failed.commit === candidate.commit && failed.buildInputsHash === inputsHash
}

async function buildInputsHash() {
  const hash = createHash('sha256')
  for (const path of ['patches/ubuntu-desktop.patch', 'build.sh', 'verify-release.py', '.github/workflows/release.yml', 'release-policy.mjs', 'release-policy.test.mjs', 'package.json', 'package-lock.json', 'sync-upstream.mjs']) {
    hash.update(path).update(await readFile(new URL(path, import.meta.url)))
  }
  return hash.digest('hex')
}

async function main() {
  const current = JSON.parse(await readFile(new URL('./upstream.json', import.meta.url), 'utf8'))
  const candidate = await detectUpstreamRelease(current)
  const inputsHash = await buildInputsHash()
  let state = {}
  try { state = JSON.parse(await readFile(new URL('./sync-state.json', import.meta.url), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const held = candidate !== null && shouldHoldFailedCandidate(candidate, state, inputsHash, process.env.RETRY_FAILED_RELEASE === 'true')
  const outputs = candidate === null || held ? { changed: 'false' } : {
    changed: 'true', commit: candidate.commit, version: candidate.productVersion,
    tag: candidate.releaseTag, previous_commit: current.commit, build_inputs_hash: inputsHash,
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''))
  }
  console.log(held ? 'Keeping the previous Ubuntu release; this candidate needs a compatibility fix or an explicit retry' : candidate === null ? 'No newer official RC or stable release; keeping the current Ubuntu release' : JSON.stringify(candidate))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
