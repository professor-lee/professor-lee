// svg.mjs —— 内容模型 + SVG 渲染
// 版面契约见 doc/终态画面设计.md 与 doc/启动日志设计.md：
//   48 列 × 0.6em = 516px 内容宽（框架 550 / padding 16 / border 1）
//   艺术字行步 1.0em；文本行步 1.2em；开场盲文行步 0.9905em；热力图 ■ @12px、节距 9px
// 播放：开场盲文 → 从上到下擦除 → boot 27 行 → 清屏 → 提示符+fastfetch → 终态（**不循环**，结束即静止）

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACHINE, LINKS, BUCKETS, bucketOf, ageYears, localParts } from './facts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------- 几何 ----------
export const GEO = {
  W: 550, PAD: 16, COLS: 48,
  get contentW() { return this.W - 2 * (this.PAD + 1) },
  get font() { return this.contentW / (this.COLS * 0.6) },   // 17.9167
  get artPitch() { return 1.0 * this.font },
  get linePitch() { return 1.2 * this.font },
  get logoPitch() { return 0.9905 * this.font },             // 六点盲文 3 × 0.3302em
  hmFont: 12, hmPitch: 9,                                    // 热力图 ■
}

// ---------- 时间线（秒；不循环）----------
const T = {
  logoInStep: 0.04, logoOutAt: 2.40, logoOutStep: 0.03,
  bootAt: 3.50, bootSteps: [0.10, 0.10, 0.18, 0.28, 0.75],   // 末段含 0.4s 停顿 + 2 行
  bootOutAt: 8.90,
  promptAt: 9.15, typeCps: 0.022,
  finalAt: 9.70, finalStep: 0.03,
  heatAt: 10.80, heatColStep: 0.012,
  barAt: 11.10, barCharStep: 0.02,
}

// ---------- 小工具 ----------
const padEnd = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const boxTopSegs = (title) => {
  const dash = GEO.COLS - 12 - title.length - 1
  return [S('┌' + '─'.repeat(9) + ' ', 'bd'), S(title, 'd'), S(' ' + '─'.repeat(dash) + '┐', 'bd')]
}
const boxBotSegs = () => [S('└' + '─'.repeat(GEO.COLS - 2) + '┘', 'bd')]
const boxBot = () => '└' + '─'.repeat(GEO.COLS - 2) + '┘'
function ruleSegs(label, tail = '') {
  const head = `── ${label} `
  const t = tail ? ` ${tail} ` : ''
  const dashes = '─'.repeat(Math.max(2, GEO.COLS - head.length - t.length))
  const segs = [S(head, 'd'), S(dashes, 'bd')]
  if (t) segs.push(S(t, 'd'))
  return segs
}
const NORD16 = ['#2E3440','#3B4252','#434C5E','#4C566A','#D8DEE9','#E5E9F0','#ECEFF4','#8FBCBB','#88C0D0','#81A1C1','#5E81AC','#BF616A','#D08770','#EBCB8B','#A3BE8C','#B48EAD']
function bar(n, max, width = 16) {
  const filled = max > 0 ? Math.round(width * n / max) : 0
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}
const S = (t, c = 't') => ({ t, c })

// ---------- 内容：boot 27 行 ----------
export function bootLines({ data, now }) {
  const { date, time, hour, ymdhm } = localParts(now)
  const late = ['late night', 'pre-dawn'].includes(bucketOf(hour))
  const L = []
  const ok = (ts, msg) => ({ segs: [S(`[${ts}] `, 'f'), S(padEnd(msg, 20)), S('[  OK  ]', 'ok')] })
  const plain = (ts, msg) => ({ segs: [S(`[${ts}] `, 'f'), S(msg)] })

  L.push({ segs: [S(`professorLee.os 1.0.0 (build ${MACHINE.build})`, 'acc')] })
  L.push(plain('    0.000000', `Linux version ${MACHINE.kernel}`))
  L.push(plain('    0.000412', `Host: ${MACHINE.pc.split(' ')[0]}, Beijing (UTC+8)`))
  L.push(plain('    0.001204', `WM: ${MACHINE.wm}`))
  L.push(plain('    0.001806', `Term: ${MACHINE.term} / ${MACHINE.shell}`))
  L.push(plain('    0.002410', `Identity: ${MACHINE.identity}`))
  L.push(ok('    0.002880', 'Mount /dev/creativity'))
  L.push(ok('    0.004120', 'Mount /photos (ro)'))
  L.push(ok('    0.006700', 'Module tui_player.ko'))
  L.push(ok('    0.008210', 'Module click_wheel.ko'))
  L.push(ok('    0.009940', 'Module stone_palette.ko'))
  L.push(ok('    0.011500', 'Module socratic_agent.ko'))
  L.push(ok('    0.013020', 'Module braille_render.ko'))
  L.push(ok('    0.021004', 'Start novaorbit.service'))
  L.push(ok('    0.023170', 'Start som.service'))
  L.push(ok('    0.025330', 'Start void.service'))
  L.push(ok('    0.027480', 'Start otho.service'))
  L.push(ok('    0.029610', 'Start stone.service'))
  L.push(ok('    0.031780', 'Start portfolio.service'))
  L.push(ok('    0.040120', 'Fetch api.github.com'))
  L.push(ok('    0.043300', 'Fetch open-meteo Beijing'))
  L.push(plain('    0.045600', `Contributions: ${data.contrib?.total ?? '--'} / 12 months`))
  if (data.lang) L.push(plain('    0.047900', `Languages: ${data.lang.langs.slice(0, 4).map(x => x.name).join(' ')}`))
  if (late) L.push({ segs: [S('[    0.050210] ', 'f'), S(padEnd(`Late-night build: ${ymdhm.slice(11)}`, 20)), S('[ WARN ]', 'warn')] })
  L.push(plain('    0.052100', `All 18 units started in 0.052s`))
  L.push({ segs: [S('professorLee login: professorLee (auto)', 'acc')] })
  L.push({ segs: [S(`Last login: ${date} ${time} CST`, 'd')] })
  return L
}

// ---------- 内容：终态 ----------
export function finalLines({ data, now }) {
  const { ymdhm, hour } = localParts(now)
  const art = read('assets/art.txt').split('\n').filter(l => l.trim().length)
  const c = data.contrib, l = data.lang, b = data.buckets, w = data.wx
  const langs = l ? l.langs.slice(0, 4) : []
  const other = l ? Math.max(0, 100 - langs.reduce((a, x) => a + x.pct, 0)) : 0

  const R = []
  const push = (...segs) => R.push({ segs, kind: 'text' })
  const pushKind = (kind, extra = {}) => R.push({ segs: [], kind, ...extra })

  pushKind('prompt')                                   // 第 1 行：提示符（打字机渲染）
  art.forEach(r => R.push({ segs: [S(r)], kind: 'art' }))

  push(...boxTopSegs('System'))
  push(S('│ ', 'bd'), S(padEnd('PC', 9), 'ka'), S(padEnd('MACHD-WXX9', 14), 't'), S(padEnd('OS', 9), 'ka'), S('Manjaro x86_64', 't'))
  push(S('│ ', 'bd'), S(padEnd('CPU', 9), 'ka'), S(padEnd('i7-1165G7', 14), 't'), S(padEnd('Kernel', 9), 'ka'), S('6.12.108', 't'))
  push(S('│ ', 'bd'), S(padEnd('GPU', 9), 'ka'), S(padEnd('Iris Xe', 14), 't'), S(padEnd('Pkgs', 9), 'ka'), S('2239 pacman', 't'))
  push(S('│ ', 'bd'), S(padEnd('RAM', 9), 'ka'), S(padEnd('15.42 GiB', 14), 't'), S(padEnd('Shell', 9), 'ka'), S('fish 4.9.1', 't'))
  push(S('│ ', 'bd'), S(padEnd('Disk', 9), 'ka'), S(padEnd('476 GiB', 14), 't'), S(padEnd('WM', 9), 'ka'), S('niri 26.04', 't'))
  push(S('│ ', 'bd'), S(padEnd('Term', 9), 'ka'), S(padEnd('kitty 0.48.2', 14), 't'), S(padEnd('Editor', 9), 'ka'), S('nvim / VS Code', 't'))
  push(...boxBotSegs())

  push(...boxTopSegs('About / DateTime'))
  push(S('│ ', 'bd'), S(padEnd('OS Age', 9), 'kb'), S(padEnd(`${ageYears(now)} years`, 14), 't'), S(padEnd('Weather', 9), 'kb'), S(w ? w.text : '--', 't'))
  push(S('│ ', 'bd'), S(padEnd('Host', 9), 'kb'), S(padEnd('Beijing CN', 14), 't'), S(padEnd('Repos', 9), 'kb'), S(l ? `${l.repos}/${l.stars} stars` : '--', 't'))
  push(S('│ ', 'bd'), S(padEnd('Local', 9), 'kb'), S(`${ymdhm.slice(11)} (${bucketOf(hour)})`, 't'))
  push(S('│ ', 'bd'), S(padEnd('Commits', 9), 'kb'), S(c ? `${c.total} in last 12 months` : '--', 't'))
  push(...boxBotSegs())

  pushKind('dots')                                     // 16 色圆点
  pushKind('blank')

  push(...ruleSegs('contributions', c ? `${c.days.length} d` : ''))
  pushKind('heat', { weeks: c?.weeks ?? [] })
  pushKind('blank')

  const maxB = b ? Math.max(...Object.values(b.counts)) : 0
  push(...ruleSegs('commit time', 'count'))
  for (const bk of BUCKETS) {
    const n = b?.counts?.[bk.key] ?? null
    const { filled, empty } = bar(n ?? 0, maxB)
    push({ __bar: 1, label: padEnd(bk.en, 13), filled, empty, value: String(n ?? '--').padStart(3) })
  }
  pushKind('blank')

  push(...ruleSegs('languages', 'share'))
  for (const lg of langs) {
    const { filled, empty } = bar(lg.pct, 40, 16)
    push({ __bar: 1, label: padEnd(lg.name, 13), filled, empty, value: `${lg.pct.toFixed(1)}%`.padStart(6) })
  }
  if (other > 0) push(S('  '), S(padEnd('other', 13), 'd'), S('░'.repeat(16), 'be'), S(` ${other.toFixed(1)}%`.padStart(7), 'd'))
  pushKind('blank')

  push(...ruleSegs('links'))
  for (const lk of LINKS) push(S('  ' + lk, 'acc'))
  return R
}

// ---------- 渲染 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderSvg({ data, now = new Date() }) {
  const fontB64 = readFileSync(join(ROOT, 'assets/fonts/profLee-mono.woff2')).toString('base64')
  const logo = read('assets/logo/logo-48x31.txt').split('\n').filter(l => l.length)
  const boot = bootLines({ data, now })
  const fin = finalLines({ data, now })

  const F = GEO.font, LP = GEO.linePitch, AP = GEO.artPitch, LOGOP = GEO.logoPitch
  const x0 = GEO.PAD + 1

  // 终态各行 y（含特殊行高）
  let y = GEO.PAD + LP
  const rows = []
  for (const l of fin) {
    const h = l.kind === 'art' ? AP : l.kind === 'heat' ? 7 * GEO.hmPitch : LP
    rows.push({ ...l, y, h })
    y += h
  }
  const lastRowBottom = rows[rows.length - 1].y + 2 * LP + 0.35 * F   // 末行 + 底部提示符行
  const H = Math.ceil(Math.max(lastRowBottom + GEO.PAD, GEO.PAD + boot.length * LP + GEO.PAD, GEO.PAD + logo.length * LOGOP + GEO.PAD))

  const out = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${GEO.W}" height="${H}" viewBox="0 0 ${GEO.W} ${H}">`)
  out.push(`<style>
@font-face{font-family:'profLee-Mono';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${fontB64}) format('woff2')}
text{font-family:'profLee-Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:${F.toFixed(4)}px}
.bg{fill:#ECEFF4}.pn{fill:#E5E9F0}.bd{fill:#D8DEE9}.t{fill:#2E3440}.d{fill:#4C566A}.f{fill:#4C566A}
.acc{fill:#3B4252}.ok{fill:#3B4252}.warn{fill:#D08770}.ka{fill:#3B4252}.kb{fill:#3B4252}
.bar{fill:#5E81AC}.be{fill:#D8DEE9}.sw{stroke:#4C566A;stroke-opacity:.55;stroke-width:.9}
.h0{fill:#D8DEE9}.h1{fill:#5E81AC;fill-opacity:.30}.h2{fill:#5E81AC;fill-opacity:.55}.h3{fill:#5E81AC;fill-opacity:.78}.h4{fill:#5E81AC}
@keyframes fin{from{opacity:0}to{opacity:1}}
@keyframes fout{from{opacity:1}to{opacity:0}}
@keyframes blk{0%,49%{opacity:1}50%,100%{opacity:0}}
.an{animation:fin .22s linear both}
.lg{animation:fin .20s linear both,fout .18s linear both}
@media (prefers-color-scheme: dark){
.bg{fill:#2E3440}.pn{fill:#3B4252}.bd{fill:#434C5E}.t{fill:#ECEFF4}.d{fill:#D8DEE9}.f{fill:#81A1C1}
.acc{fill:#88C0D0}.ok{fill:#A3BE8C}.warn{fill:#EBCB8B}.ka{fill:#A3BE8C}.kb{fill:#B48EAD}
.bar{fill:#88C0D0}.be{fill:#434C5E}.sw{stroke:#2E3440;stroke-opacity:.9;stroke-width:.9}
.h0{fill:#3B4252}.h1{fill:#88C0D0;fill-opacity:.14}.h2{fill:#88C0D0;fill-opacity:.38}.h3{fill:#88C0D0;fill-opacity:.65}.h4{fill:#88C0D0}
}
</style>`)
  out.push(`<rect class="bg" width="${GEO.W}" height="${H}"/>`)
  out.push(`<rect class="pn" x="${GEO.PAD}" y="${GEO.PAD}" width="${GEO.contentW + 2}" height="${H - 2 * GEO.PAD}"/>`)

  // 1) 开场：盲文 logo（逐行淡入 → 自上而下逐行擦除）
  logo.forEach((row, i) => {
    out.push(`<text class="lg acc" x="${x0}" y="${(GEO.PAD + (i + 1) * LOGOP).toFixed(2)}" style="animation-delay:${(i * T.logoInStep).toFixed(2)}s,${(T.logoOutAt + i * T.logoOutStep).toFixed(2)}s" xml:space="preserve">${esc(row)}</text>`)
  })

  // 2) boot 27 行（结束后整块淡出）
  let at = T.bootAt
  boot.forEach((l, i) => {
    at += i < 6 ? T.bootSteps[0] : i < 13 ? T.bootSteps[1] : i < 19 ? T.bootSteps[2] : i < 25 ? T.bootSteps[3] : T.bootSteps[4]
    const spans = l.segs.map(s => `<tspan class="${s.c}">${esc(s.t)}</tspan>`).join('')
    out.push(`<text class="lg" x="${x0}" y="${(GEO.PAD + (i + 1) * LP).toFixed(2)}" style="animation-delay:${at.toFixed(2)}s,${T.bootOutAt.toFixed(2)}s" xml:space="preserve">${spans}</text>`)
  })

  // 3) 终态
  for (const r of rows) {
    const delay = (T.finalAt + rows.indexOf(r) * T.finalStep).toFixed(2)
    if (r.kind === 'prompt') {
      const prompt = '[professorLee@github ~]$ fastfetch'
      const spans = [...prompt].map((ch, i) => `<tspan class="an t" style="animation-delay:${(T.promptAt + i * T.typeCps).toFixed(3)}s">${esc(ch)}</tspan>`).join('')
      out.push(`<text x="${x0}" y="${r.y.toFixed(2)}" xml:space="preserve">${spans}</text>`)
      continue
    }
    if (r.kind === 'blank') continue
    if (r.kind === 'art') {
      out.push(`<text class="an t" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${delay}s" xml:space="preserve">${esc(r.segs[0].t)}</text>`)
      continue
    }
    if (r.kind === 'dots') {
      const n = 16, rad = 4, gap = 6, bx = x0 + 3
      let s = ''
      for (let k = 0; k < n; k++) {
        s += `<circle class="sw an" cx="${bx + k * (2 * rad + gap)}" cy="${(r.y - 5).toFixed(0)}" r="${rad}" fill="${NORD16[k]}" style="animation-delay:${(T.finalAt + k * 0.02).toFixed(2)}s"/>`
      }
      out.push(s); continue
    }
    if (r.kind === 'heat') {
      const lv = levels(r.weeks.flat())
      let s = ''
      for (let wk = 0; wk < r.weeks.length; wk++) {
        for (let dy = 0; dy < 7; dy++) {
          const v = r.weeks[wk][dy] ?? 0
          const k = v === 0 ? 0 : Math.max(1, lv(v))
          s += `<text class="h${k} an" x="${(x0 + 2 + wk * GEO.hmPitch).toFixed(1)}" y="${(r.y + dy * GEO.hmPitch).toFixed(1)}" style="animation-delay:${(T.heatAt + wk * T.heatColStep).toFixed(2)}s;font-size:${GEO.hmFont}px" xml:space="preserve">■</text>`
        }
      }
      out.push(s); continue
    }
    if (r.segs[0]?.__bar) {           // 字符进度条（逐格生长）
      const b = r.segs[0]
      let s = `<text x="${x0}" y="${r.y.toFixed(2)}" xml:space="preserve"><tspan class="d">  ${esc(b.label)}</tspan>`
      ;[...b.filled].forEach((_, k) => {
        s += `<tspan class="bar an" style="animation-delay:${(T.barAt + k * T.barCharStep).toFixed(2)}s">█</tspan>`
      })
      s += `<tspan class="be">${esc(b.empty)}</tspan><tspan class="t"> ${esc(b.value)}</tspan></text>`
      out.push(s); continue
    }
    const spans = r.segs.map(s => `<tspan class="${s.c}">${esc(s.t)}</tspan>`).join('')
    out.push(`<text class="an" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${delay}s" xml:space="preserve">${spans}</text>`)
  }

  // 4) 结束后静止的提示符 + 闪烁光标（唯一保留的无限动画）
  const last = rows[rows.length - 1]
  const cy = last.y + LP
  const cx = x0 + 23 * 0.6 * F
  out.push(`<text class="an acc" x="${x0}" y="${cy.toFixed(2)}" style="animation-delay:${(T.finalAt + rows.length * T.finalStep + 0.25).toFixed(2)}s" xml:space="preserve">[professorLee@github ~]$ </text>`)
  out.push(`<rect class="acc" x="${cx.toFixed(1)}" y="${(cy - F * 0.8).toFixed(1)}" width="${(0.6 * F).toFixed(1)}" height="${(F * 0.92).toFixed(1)}" style="animation:blk .8s step-end ${(T.finalAt + rows.length * T.finalStep + 0.4).toFixed(2)}s infinite"/>`)
  out.push(`</svg>`)
  return out.join('\n')
}

// 分位数分档（5 档，见 doc/终态画面设计.md §5.1）
function levels(values) {
  const nz = values.filter(v => v > 0).sort((a, b) => a - b)
  if (!nz.length) return () => 0
  const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))]
  const [a, b, c] = [q(0.25), q(0.5), q(0.8)]
  return (v) => (v <= a ? 1 : v <= b ? 2 : v <= c ? 3 : 4)
}
