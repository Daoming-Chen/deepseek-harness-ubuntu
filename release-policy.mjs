/** Shared publication rules for both direct and reusable workflow entry points. */
import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

function feedVersion(feed) {
  // Electron's feed uses a top-level YAML scalar; accept its plain and quoted forms.
  const version = /^version:\s*["']?([^\s"']+)["']?\s*$/mu.exec(feed)?.[1]
  if (!semver.valid(version)) throw new Error('Invalid update feed version')
  return version
}

export function desktopBuildVersion(product, now, runId, attempt) {
  if (!semver.valid(product)) throw new Error('Invalid official product version')
  for (const value of [runId, attempt]) {
    if (!/^[1-9][0-9]*$/u.test(String(value))) throw new Error('Invalid workflow run identity')
  }
  const timestamp = now.toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14)
  const base = product.includes('-') ? product : `${product}-test`
  const version = `${base}.${timestamp}.${runId}.${attempt}`
  if (!semver.valid(version)) throw new Error('Invalid desktop build version')
  return version
}

export function assertPublicationAdvances(candidate, online) {
  for (const value of [candidate.productVersion, candidate.desktopVersion, online?.productVersion, online?.desktopVersion].filter(value => value !== undefined)) {
    if (!semver.valid(value)) throw new Error('Invalid publication metadata version')
  }
  if (!candidate.productVersion || !candidate.desktopVersion) throw new Error('Missing candidate versions')
  if (online === null) return
  if (!online.productVersion || !online.desktopVersion) throw new Error('Missing online versions')
  if (semver.lt(candidate.productVersion, online.productVersion)) throw new Error('Refusing to publish an older official source version')
  if (!semver.gt(candidate.desktopVersion, online.desktopVersion)) throw new Error('Refusing to publish a duplicate or older desktop version')
}

export async function onlinePublication(repository, request = fetch, token = '') {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new Error('Invalid release repository')
  const headers = { 'User-Agent': 'deepseek-harness-ubuntu-publication', Accept: 'application/vnd.github+json',
    'Cache-Control': 'no-cache', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const latest = await request(`https://api.github.com/repos/${repository}/releases/latest`, { headers, signal: AbortSignal.timeout(30000) })
  if (latest.status === 404) return null
  if (!latest.ok) throw new Error(`Cannot read online release: HTTP ${latest.status}`)
  const release = await latest.json()
  const metadata = {}
  for (const name of ['upstream.json', 'stable-linux.yml']) {
    const asset = release.assets?.find(value => value.name === name)
    if (!asset?.browser_download_url?.startsWith(`https://github.com/${repository}/releases/download/`)) throw new Error(`Online release is missing trusted ${name}`)
    const response = await request(asset.browser_download_url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Cannot read online ${name}: HTTP ${response.status}`)
    metadata[name] = await response.text()
  }
  const productVersion = JSON.parse(metadata['upstream.json']).productVersion
  const desktopVersion = feedVersion(metadata['stable-linux.yml'])
  if (release.tag_name !== `ubuntu-v${desktopVersion}`) throw new Error('Online release tag and update feed disagree')
  return { productVersion, desktopVersion }
}

async function main() {
  if (process.argv[2] === 'version') {
    const { productVersion } = JSON.parse(await readFile('upstream.json', 'utf8'))
    const version = desktopBuildVersion(productVersion, new Date(), process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT)
    await appendFile(process.env.GITHUB_ENV, `DSH_DESKTOP_BUILD_VERSION=${version}\n`)
    console.log(`Selected desktop version ${version}`)
  } else if (process.argv[2] === 'check') {
    const { productVersion } = JSON.parse(await readFile('dist/upstream.json', 'utf8'))
    const desktopVersion = feedVersion(await readFile('dist/stable-linux.yml', 'utf8'))
    if (desktopVersion !== process.env.DSH_DESKTOP_BUILD_VERSION) throw new Error('Candidate update feed and intended release version disagree')
    const online = await onlinePublication(process.env.GITHUB_REPOSITORY, fetch, process.env.GH_TOKEN)
    assertPublicationAdvances({ productVersion, desktopVersion }, online)
    console.log('Publication advances the official source and desktop update versions')
  } else throw new Error('Expected version or check command')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
