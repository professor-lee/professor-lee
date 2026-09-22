// facts.mjs —— 数据层：真机事实（常量）+ 远端数据（GitHub / Open-Meteo），带缓存与失败回退
// 原则（见 doc/终态画面设计.md §9）：取不到就不显示该行，永不编造。

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = process.env.CACHE_FILE ?? join(ROOT, '.cache', 'data.json')   // 生产用 CACHE_FILE 指到代码目录之外，部署同步不会碰到数据

// ---------- 真机事实（脱敏：不含机型/CPU/GPU/内存/磁盘，也不含任何版本号）----------
// 见 doc/终态画面设计.md §4：只保留不具标识性的系统级事实。
export const MACHINE = {
  os: 'Manjaro x86_64',
  pkgs: '2239 (pacman)',
  shell: 'fish (login)',          // 登录 shell（不是 $SHELL 的 bash）
  wm: 'niri (Wayland)',
  term: 'kitty',
  editor: 'nvim / VS Code',
  theme: 'Nord',
  font: 'JetBrains Mono',
  identity: 'full-stack / UI-UX',
  host: 'Beijing, CN (UTC+8)',
  tz: 'Asia/Shanghai',
  build: '2005.11',               // 生日月 → 构建号（用户定）
  birthYM: [2005, 11],            // 用于 OS Age = 真实年龄
  profile: 'professor-lee',
  website: 'https://professorlee.work/',
}

export const LINKS = [
  'professorlee.work',
  'photo.professorlee.work',
  '404.professorlee.work',
  'status.professorlee.work',
  'nova-orbit.xyz',
  'stone.professorlee.work',
  'github.com/professor-lee',
]

// 时段词表（与提交分段同一套边界；见 doc/终态画面设计.md §5.4）
export const BUCKETS = [
  { key: 'late night', en: 'late night', from: 23, to: 2 },
  { key: 'pre-dawn',   en: 'pre-dawn',   from: 2,  to: 6 },
  { key: 'morning',    en: 'morning',    from: 6,  to: 12 },
  { key: 'afternoon',  en: 'afternoon',  from: 12, to: 18 },
  { key: 'evening',    en: 'evening',    from: 18, to: 23 },
]
export function bucketOf(hour) {
  const b = BUCKETS.find(b => (b.from < b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to))
  return b.key
}

// ---------- token ----------
function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() } catch { return null }
}

// ---------- 缓存 ----------
function loadCache() { try { return JSON.parse(readFileSync(CACHE, 'utf8')) } catch { return {} } }
function saveCache(c) {
  try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(c, null, 1)) } catch {}
}
const fresh = (entry, ttlSec) => entry && (Date.now() - entry.at) < ttlSec * 1000

async function cached(key, ttlSec, fn) {
  const c = loadCache()
  if (fresh(c[key], ttlSec)) return c[key].value
  try {
    const value = await fn()
    // 只更新本键（读-改-写）：四个抓取并行，若把内存里的整份快照写回会互相覆盖
    // （实测清空缓存后连跑，只剩最后写入的那个键 —— contributions 因此丢过）
    if (value != null) { const cur = loadCache(); cur[key] = { at: Date.now(), value }; saveCache(cur); return value }
    return c[key]?.value ?? null            // 取到 null → 退回旧值
  } catch (e) {
    console.error(`[facts] ${key} 失败：${e.message}`)
    return c[key]?.value ?? null            // 失败 → 旧值；无旧值 → null（调用方跳过该行）
  }
}

// ---------- GitHub ----------
const GH = 'https://api.github.com'
// 无 token 时不发 Authorization 头（`bearer null` 会被 GitHub 判 401，连公开数据也读不到）
const ghHeaders = (tok) => ({
  ...(tok ? { Authorization: `bearer ${tok}` } : {}),
  'User-Agent': 'profLee-readme',
  Accept: 'application/vnd.github+json',
})

export function contributions() {
  return cached('contributions', 3600, async () => {
    const tok = ghToken(); if (!tok) return null
    const q = `{ user(login:"${MACHINE.profile}"){ contributionsCollection{ contributionCalendar{
      totalContributions weeks{ contributionDays{ date contributionCount weekday } } } } } }`
    const r = await fetch(`${GH}/graphql`, { method: 'POST', headers: { ...ghHeaders(tok), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
    if (!r.ok) throw new Error(`graphql ${r.status}`)
    const j = await r.json()
    const cal = j?.data?.user?.contributionsCollection?.contributionCalendar
    if (!cal) throw new Error('graphql 结构异常')
    const days = cal.weeks.flatMap(w => w.contributionDays)
    const weeks = cal.weeks.map(w => w.contributionDays.map(d => d.contributionCount))
    return { total: cal.totalContributions, days, weeks, activeDays: days.filter(d => d.contributionCount > 0).length, max: Math.max(...days.map(d => d.contributionCount)) }
  })
}

export function commitBuckets() {
  return cached('commitBuckets', 3600, async () => {
    const tok = ghToken()          // 公开 Search 端点未认证也可用（额度低，失败会回退缓存）
    const counts = Object.fromEntries(BUCKETS.map(b => [b.key, 0]))
    let total = 0
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(`${GH}/search/commits?q=author:${MACHINE.profile}&per_page=100&page=${page}&sort=author-date&order=desc`,
        { headers: { ...ghHeaders(tok), Accept: 'application/vnd.github.cloak-preview+json' } })
      if (!r.ok) throw new Error(`search ${r.status}`)
      const j = await r.json()
      const items = j.items ?? []
      for (const it of items) {
        const iso = it.commit?.author?.date
        if (!iso) continue
        // 用提交自带的原始偏移取"提交当时的小时"（不做时区平移）
        const h = Number(iso.slice(11, 13))
        counts[bucketOf(h)]++; total++
      }
      if (items.length < 100) break
    }
    return total ? { counts, total } : null
  })
}

export function languages() {
  return cached('languages', 86400, async () => {
    const tok = ghToken()          // 公开 REST 端点未认证也可用
    const r = await fetch(`${GH}/users/${MACHINE.profile}/repos?per_page=100`, { headers: ghHeaders(tok) })
    if (!r.ok) throw new Error(`repos ${r.status}`)
    const repos = (await r.json()).filter(x => !x.fork)
    const agg = {}
    for (const x of repos) {
      const lr = await fetch(`${GH}/repos/${MACHINE.profile}/${x.name}/languages`, { headers: ghHeaders(tok) })
      if (!lr.ok) continue
      for (const [k, v] of Object.entries(await lr.json())) agg[k] = (agg[k] ?? 0) + v
    }
    const total = Object.values(agg).reduce((a, b) => a + b, 0)
    if (!total) return null
    const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name, pct: bytes / total * 100 }))
    return { repos: repos.length, stars: repos.reduce((a, b) => a + (b.stargazers_count ?? 0), 0), langs: sorted }
  })
}

// ---------- 天气 ----------
export function weather() {
  return cached('weather', 1800, async () => {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074&daily=temperature_2m_max,weather_code&temperature_unit=celsius&timezone=auto&forecast_days=1')
    if (!r.ok) throw new Error(`open-meteo ${r.status}`)
    const j = await r.json()
    const t = Math.round(j.daily.temperature_2m_max[0]), code = j.daily.weather_code[0]
    const word = code === 0 ? 'clear' : code <= 3 ? 'cloudy' : code <= 48 ? 'fog' : code <= 67 ? 'rain' : code <= 77 ? 'snow' : code <= 82 ? 'showers' : 'storm'
    return { text: `${t}C ${word}` }
  })
}

// ---------- 派生量 ----------
export function ageYears(now = new Date()) {
  const [y, m] = MACHINE.birthYM
  let a = now.getFullYear() - y
  if (now.getMonth() + 1 < m) a -= 1
  return a
}
export function localParts(now = new Date()) {
  // 服务器本地时间（Asia/Shanghai）；生成器与 VPS 同时区
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: MACHINE.tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now)
  const g = k => p.find(x => x.type === k).value
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}:${g('second')}`, hour: Number(g('hour')), ymdhm: `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}` }
}

export async function collectAll(now = new Date()) {
  const [contrib, buckets, lang, wx] = await Promise.all([contributions(), commitBuckets(), languages(), weather()])
  return { contrib, buckets, lang, wx, machine: MACHINE, now }
}
