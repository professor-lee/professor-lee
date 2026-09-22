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
// 技术栈（用户 2026-09-22 指定，顺序照给；与 GitHub 语言占比块是两件事）
// 技术栈图标（Nerd Font Devicons，单宽 0.6em）：[字符, 亮色版, 暗色版]
// 品牌色为各技术官方色；亮/暗两套均按 WCAG 图形阈值 3:1 于对应面板底色上校验（见 doc/终态画面设计.md §4b）
const STACK = [
  ['\uE73C', '#3775AA', '#5F91BC'],
  ['\uE7A8', '#A67C63', '#DEA584'],
  ['\uE738', '#D56600', '#E76F00'],
  ['\uE81B', '#7E52FE', '#9975FF'],
  ['\uE8DC', '#36966B', '#42B883'],
  ['\uE719', '#339833', '#41A041'],
  ['\uE7CB', '#47838E', '#61959F'],
  ['\uE7B0', '#218ADA', '#2496ED'],
  ['\uE702', '#EC4F31', '#F15A3E'],
  ['\uE76E', '#336690', '#6C92B0'],
  ['\uE76D', '#DB382D', '#E4645B'],
  ['\uE8D6', '#646BFE', '#787FFF'],
  ['\uE84B', '#00995A', '#00DC82'],
  ['\uE7C4', '#003B57', '#7393A3'],
  ['\uE776', '#009539', '#1CA24F'],
  ['\uE73E', '#000000', '#8F8F8F'],
]

export const GEO = {
  W: 550, PAD: 16, COLS: 48,
  get contentW() { return this.W - 2 * (this.PAD + 1) },
  get font() { return this.contentW / (this.COLS * 0.6) },   // 17.9167
  get artPitch() { return 1.0 * this.font },
  get linePitch() { return 1.2 * this.font },
  get logoPitch() { return 1.323 * this.font },              // 16×7 档按显示点宽高比 1.47 预压：3 × 0.30em × 1.47
  hmFont: 12, hmPitch: 9,                                    // 热力图 ■
}

// ---------- 时间线（秒；不循环）----------
const T = {
  logoOutAt: 2.40, logoOutStep: 0.13,   // logo t=0 直接出现；7 行自上而下逐行擦除（2.40→3.31s）
  bootAt: 3.50, bootSteps: [0.10, 0.10, 0.18, 0.28, 0.75],   // 末段含 0.4s 停顿 + 2 行
  bootOutAt: 8.80, bootOutStep: 0.02,
  loginAt: 9.45, loginStep: 0.18, loginOutAt: 10.45, loginOutStep: 0.12,   // login 独占一屏
  promptAt: 10.70, promptLead: 0.30, typeCps: 0.055, enterPause: 0.35,   // 提示符逐字输入 → 停顿 → 回车
  // 终态**逐行串行**：任一行的动画结束后，下一行才开始（见 doc/终态画面设计.md §6）
  rowDwell: 0.06, artDwell: 0.09, blankDwell: 0.05,       // 纯文本行 / ASCII art 行 / 空行
  dotStep: 0.022,                                          // 16 色圆点：逐颗
  stackIconStep: 0.05,                                     // 技术栈图标：逐个（串行）
  heatCellStep: 0.0028,                                    // 热力图：逐格（行主序，像终端一行行打点）
  barCharStep: 0.016, barRowDwell: 0.05,                   // 进度条：逐格生长，条之间串行
}

// ---------- 小工具 ----------
const padEnd = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const boxTopSegs = (title) => {
  const dash = GEO.COLS - 3 - title.length          // ┌ + title + ' ' + dashes + ┐ = COLS
  return [S('┌', 'bd'), S(title, 'd'), S(' ' + '─'.repeat(dash) + '┐', 'bd')]
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
// 「用得最多的前四」（API 按字节降序）——boot 预览行与终态语言区**共用同一取数**，避免两处各写一遍
const topLangs = (data, n = 4) => data?.lang?.langs?.slice(0, n) ?? []

function bar(n, max, width = 16) {
  const filled = Math.max(0, Math.min(width, max > 0 ? Math.round(width * n / max) : 0))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}
const S = (t, c = 't') => ({ t, c })
const PROMPT = '[professorLee@github ~]$ '

// ---------- 内容：boot 27 行 ----------
export function bootLines({ data, now }) {
  const { date, time, hour, ymdhm } = localParts(now)
  const late = ['late night', 'pre-dawn'].includes(bucketOf(hour))
  const L = []
  const ok = (ts, msg) => ({ segs: [S(`[${ts}] `, 'f'), S(padEnd(msg, 20)), S('[  OK  ]', 'ok')] })
  const plain = (ts, msg) => ({ segs: [S(`[${ts}] `, 'f'), S(msg)] })

  L.push({ segs: [S(`professorLee.os 1.0.0 (build ${MACHINE.build})`, 'acc')] })
  L.push(plain('    0.000000', `Linux (${MACHINE.os.split(' ')[0]})`))
  L.push(plain('    0.000412', `Host: ${MACHINE.host}`))
  L.push(plain('    0.001204', `WM: ${MACHINE.wm}`))
  L.push(plain('    0.001806', `Term: ${MACHINE.term} / ${MACHINE.shell.split(' ')[0]}`))
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
  if (data.lang) L.push(plain('    0.047900', `Languages: ${topLangs(data).map(x => x.name).join(' ')}`))
  if (late) L.push({ segs: [S('[    0.050210] ', 'f'), S(padEnd(`Late-night build: ${ymdhm.slice(11)}`, 20)), S('[ WARN ]', 'warn')] })
  L.push(plain('    0.052100', `All 18 units started in 0.052s`))
  return L
}

// ---------- 内容：login 页（单独一页：boot 清屏后出现，进终态前再清屏）----------
export function loginLines({ now }) {
  const { date, time } = localParts(now)
  return [
    { segs: [S('professorLee login: professorLee (auto)', 'acc')] },
    { segs: [S(`Last login: ${date} ${time} CST`, 'd')] },
  ]
}

// ---------- 内容：终态 ----------
export function finalLines({ data, now }) {
  const { ymdhm, hour } = localParts(now)
  const art = read('assets/art.txt').split('\n').filter(l => l.trim().length)
  const c = data.contrib, l = data.lang, b = data.buckets, w = data.wx
  const langs = l ? topLangs(data) : []                            // 与 boot 预览行同源
  const langScale = Math.max(40, Math.ceil(Math.max(0, ...langs.map(x => x.pct)) / 5) * 5)   // 满格刻度自适应
  const other = l ? Math.max(0, 100 - langs.reduce((a, x) => a + x.pct, 0)) : 0

  const R = []
  const push = (...segs) => R.push({ segs, kind: 'text' })
  const pushKind = (kind, extra = {}) => R.push({ segs: [], kind, ...extra })

  pushKind('prompt')                                   // 第 1 行：提示符（打字机渲染）
  art.forEach(r => R.push({ segs: [S(r)], kind: 'art' }))

  push(...boxTopSegs('System'))
  // 列宽口径（见 doc/终态画面设计.md §4）：标签列 6 / 值列 14 / 列间固定 1 空格；第二组标签列 5
  push(S('│ ', 'bd'), S(padEnd('OS', 6), 'ka'), S(' '), S(padEnd(MACHINE.os, 14), 't'), S(' '), S(padEnd('WM', 5), 'ka'), S(' '), S(MACHINE.wm, 't'))
  push(S('│ ', 'bd'), S(padEnd('Shell', 6), 'ka'), S(' '), S(padEnd(MACHINE.shell, 14), 't'), S(' '), S(padEnd('Term', 5), 'ka'), S(' '), S(MACHINE.term, 't'))
  push(S('│ ', 'bd'), S(padEnd('Editor', 6), 'ka'), S(' '), S(padEnd(MACHINE.editor, 14), 't'), S(' '), S(padEnd('Pkgs', 5), 'ka'), S(' '), S(MACHINE.pkgs, 't'))
  push(S('│ ', 'bd'), S(padEnd('Theme', 6), 'ka'), S(' '), S(padEnd(MACHINE.theme, 14), 't'), S(' '), S(padEnd('Font', 5), 'ka'), S(' '), S(MACHINE.font, 't'))
  push(...boxBotSegs())

  push(...boxTopSegs('About / DateTime'))
  push(S('│ ', 'bd'), S(padEnd('OS Age', 6), 'kb'), S(' '), S(padEnd(`${ageYears(now)} years`, 14), 't'), S(' '), S(padEnd('Sky', 5), 'kb'), S(' '), S(w ? w.text : '--', 't'))
  push(S('│ ', 'bd'), S(padEnd('Host', 6), 'kb'), S(' '), S(padEnd('Beijing CN', 14), 't'), S(' '), S(padEnd('Repos', 5), 'kb'), S(' '), S(l ? `${l.repos}/${l.stars} stars` : '--', 't'))
  push(S('│ ', 'bd'), S(padEnd('Local', 6), 'kb'), S(' '), S(`${ymdhm.slice(11)} (${bucketOf(hour)})`, 't'))
  push(S('│ ', 'bd'), S(padEnd('Commit', 6), 'kb'), S(' '), S(c ? `${c.total} in last 12 months` : '--', 't'))
  pushKind('stack', { icons: STACK.map((x, i) => [x, i]).slice(0, 8), label: 'Stack' })   // 图标行 1（8 个）
  pushKind('stack', { icons: STACK.map((x, i) => [x, i]).slice(8) })                       // 图标行 2（7 个）
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
    const { filled, empty } = bar(lg.pct, langScale, 16)
    push({ __bar: 1, label: padEnd(lg.name, 13), filled, empty, value: `${lg.pct.toFixed(1)}%`.padStart(6) })
  }
  if (other > 0) {
    const b = bar(other, langScale, 16)   // 与语言行同一刻度（16 格宽）→ other 也有实心段
    push({ __bar: 1, label: padEnd('other', 13), filled: b.filled, empty: b.empty, value: `${other.toFixed(1)}%`.padStart(6) })
  }
  pushKind('blank')

  push(...ruleSegs('links'))
  for (const lk of LINKS) push(S('  ' + lk, 'acc'))
  return R
}

// ---------- 渲染 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function renderSvg({ data, now = new Date() }) {
  const fontB64 = readFileSync(join(ROOT, 'assets/fonts/profLee-mono.woff2')).toString('base64')
  const logo = read('assets/logo/logo-16x7.txt').split('\n').filter(l => l.length)
  const boot = bootLines({ data, now })
  const fin = finalLines({ data, now })

  const F = GEO.font, LP = GEO.linePitch, AP = GEO.artPitch, LOGOP = GEO.logoPitch
  const x0 = GEO.PAD + 1

  // 终态各行 y（含特殊行高）
  let y = GEO.PAD + LP
  const rows = []
  for (const l of fin) {
    const h = l.kind === 'art' ? AP : l.kind === 'heat' ? 7 * GEO.hmPitch : l.kind === 'stack' ? 1.8 * F : LP
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
.pn{fill:#E5E9F0}.bd{fill:#D8DEE9}/* light：值=nord0 / 次要=nord3；下面 acc/ok/warn/ka/kb 按色相分工（镜像 dark 的角色），
   取「Nord 色相压暗到 ≥4.5:1」——亮色原始 Frost/Aurora 在浅底上不达标（nord10 仅 3.3:1） */
.t{fill:#2E3440}.d{fill:#4C566A}.f{fill:#4C566A}
.acc{fill:#2E6B78}.ok{fill:#47703A}.warn{fill:#7A5F14}.ka{fill:#47703A}.kb{fill:#7E527E}
.bar{fill:#5E81AC}.be{fill:#4C566A;fill-opacity:.32}.sw{stroke:#4C566A;stroke-opacity:.55;stroke-width:.9}
${STACK.map(([, c1], i) => `.s${i + 1}{fill:${c1}}`).join('')}
.h0{fill:#4C566A;fill-opacity:.20}.h1{fill:#5E81AC;fill-opacity:.42}.h2{fill:#5E81AC;fill-opacity:.55}.h3{fill:#5E81AC;fill-opacity:.78}.h4{fill:#5E81AC}
@keyframes fin{from{opacity:0}to{opacity:1}}
@keyframes fout{from{opacity:1}to{opacity:0}}
@keyframes blk{0%,49%{opacity:1}50%,100%{opacity:0}}
.an{animation:fin 1ms step-start both}
.bo{animation:fin 1ms step-start both,fout 1ms step-start forwards}
.lgo{animation:fout 1ms step-start forwards}
/* 注意：所有出现/消失均为 1ms step-start（真实 TTY 跳变，不做渐隐）
   注意：必须 step-start 而非 step-end —— step-end 下动画 fill 取的是区间起始值，
   表现是 fout 跑到 finished 后元素仍然可见（实测）；
   fout 必须是 forwards 而非 both —— both 会在其延迟开始前就回填 from(opacity:1)，
   把入场动画整个盖掉（实测表现：boot 行从 t=0 就可见、压在开场 logo 上） */
@media (prefers-color-scheme: dark){
.pn{fill:#3B4252}.bd{fill:#434C5E}.t{fill:#ECEFF4}.d{fill:#D8DEE9}.f{fill:#81A1C1}
.acc{fill:#88C0D0}.ok{fill:#A3BE8C}.warn{fill:#EBCB8B}.ka{fill:#A3BE8C}.kb{fill:#B48EAD}
.bar{fill:#88C0D0}.be{fill:#434C5E}.sw{stroke:#2E3440;stroke-opacity:.9;stroke-width:.9}
${STACK.map(([, , c2], i) => `.s${i + 1}{fill:${c2}}`).join('')}
.h0{fill:#4C566A;fill-opacity:.55}.h1{fill:#88C0D0;fill-opacity:.22}.h2{fill:#88C0D0;fill-opacity:.38}.h3{fill:#88C0D0;fill-opacity:.65}.h4{fill:#88C0D0}
}
</style>`)
  // 单层背景：终端面板铺满整张画布（原「页面底色 + 内嵌面板」两层已合并）
  out.push(`<rect class="pn" width="${GEO.W}" height="${H}"/>`)

  // 1) 开场：盲文 logo（逐行淡入 → 自上而下逐行擦除）
  // 开场 logo：t=0 直接出现（TTY 式），随后自上而下逐行"跳变"擦除
  const logoX = x0 + (GEO.COLS - (logo[0]?.length ?? 0)) / 2 * 0.6 * F     // 顶部水平居中（按内容列数）
  logo.forEach((row, i) => {
    out.push(`<text class="lgo acc" x="${logoX.toFixed(1)}" y="${(GEO.PAD + (i + 1) * LOGOP).toFixed(2)}" style="animation-delay:${(T.logoOutAt + i * T.logoOutStep).toFixed(2)}s" xml:space="preserve">${esc(row)}</text>`)
  })

  // 2) boot 25 行（结束后整屏清掉；login 另起一页）
  let at = T.bootAt
  boot.forEach((l, i) => {
    at += i < 6 ? T.bootSteps[0] : i < 13 ? T.bootSteps[1] : i < 19 ? T.bootSteps[2] : i < 24 ? T.bootSteps[3] : T.bootSteps[4]
    const spans = l.segs.map(s => `<tspan class="${s.c}">${esc(s.t)}</tspan>`).join('')
    out.push(`<text class="bo" x="${x0}" y="${(GEO.PAD + (i + 1) * LP).toFixed(2)}" style="animation-delay:${at.toFixed(2)}s,${(T.bootOutAt + i * T.bootOutStep).toFixed(2)}s" xml:space="preserve">${spans}</text>`)
  })

  // 2b) login 页：清屏后只在顶部显示两行（新会话的"新一屏"）
  loginLines({ now }).forEach((l, i) => {
    const spans = l.segs.map(s => `<tspan class="${s.c}">${esc(s.t)}</tspan>`).join('')
    out.push(`<text class="bo" x="${x0}" y="${(GEO.PAD + (i + 1) * LP).toFixed(2)}" style="animation-delay:${(T.loginAt + i * T.loginStep).toFixed(2)}s,${(T.loginOutAt + i * T.loginOutStep).toFixed(2)}s" xml:space="preserve">${spans}</text>`)
  })

  // 3) 终态：提示符输入完（回车）之后**逐行串行**输出
  const TYPED = 'fastfetch'                               // 仅这段有打字效果（提示符立即出现）
  const typeStart = T.promptAt + T.promptLead
  const enterAt = typeStart + TYPED.length * T.typeCps + T.enterPause
  const tFinalAt = enterAt + 0.10
  let tc = tFinalAt                                   // 串行游标：下一行的起始时刻 = 上一行动画结束时刻
  for (const r of rows) {
    const bar = r.segs[0]?.__bar ? r.segs[0] : null
    const delay = tc
    tc += r.kind === 'prompt' ? 0                        // 提示符在 tFinalAt 之前就打完了
        : r.kind === 'dots' ? 16 * T.dotStep
        : r.kind === 'stack' ? r.icons.length * T.stackIconStep
        : r.kind === 'heat' ? r.weeks.length * 7 * T.heatCellStep
        : bar ? bar.filled.length * T.barCharStep + T.barRowDwell
        : r.kind === 'art' ? T.artDwell
        : r.kind === 'blank' ? T.blankDwell
        : T.rowDwell
    const at = (t) => (delay + t).toFixed(2)

    if (r.kind === 'prompt') {
      // 提示符**立即出现**（不打字），只有 fastfetch 逐字输入
      // 提示符与底部那一行同色（.acc）：真实终端的"彩色提示符 + 正文色命令"分工
      out.push(`<text class="an acc" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${T.promptAt.toFixed(2)}s" xml:space="preserve">${esc(PROMPT)}</text>`)
      const base = x0 + PROMPT.length * 0.6 * F          // 打字起点：紧接提示符之后
      const spans = [...TYPED].map((ch, i) => `<tspan class="an t" style="animation-delay:${(typeStart + i * T.typeCps).toFixed(3)}s">${esc(ch)}</tspan>`).join('')
      out.push(`<text x="${base.toFixed(1)}" y="${r.y.toFixed(2)}" xml:space="preserve">${spans}</text>`)
      // 打字光标：实心方块停在"下一格"逐字推进；回车瞬间消失（不闪烁——保持全图唯一无限动画）
      const cw = (0.6 * F).toFixed(1), chh = (F * 0.92).toFixed(1), cyy = (r.y - F * 0.8).toFixed(1)
      let cur = ''
      for (let k = 0; k <= TYPED.length; k++) {
        const from = k === 0 ? T.promptAt : typeStart + (k - 1) * T.typeCps
        const to = k === TYPED.length ? enterAt : typeStart + k * T.typeCps
        cur += `<rect class="acc" x="${(base + k * 0.6 * F).toFixed(1)}" y="${cyy}" width="${cw}" height="${chh}" style="animation:fin 1ms step-start ${from.toFixed(3)}s both,fout 1ms step-start ${to.toFixed(3)}s forwards"/>`
      }
      out.push(cur)
      continue
    }
    if (r.kind === 'stack') {
      const size = (1.4 * F).toFixed(2)
      const head = `<tspan class="bd an" style="animation-delay:${at(0)}s">│ </tspan>`
        + `<tspan class="kb an" style="animation-delay:${at(0)}s">${esc(padEnd(r.label ?? '', 7))}</tspan>`
      const icons = r.icons.map(([it, idx], k) =>
        `<tspan class="s${idx + 1} an" style="font-size:${size}px;animation-delay:${at(k * T.stackIconStep)}s">${esc(it[0])}</tspan>`
      )
      let iconsHtml = ''
      r.icons.forEach(([it, idx], k) => {
        const d = at(k * T.stackIconStep)
        if (k) iconsHtml += `<tspan class="an" style="animation-delay:${d}s">  </tspan>`
        iconsHtml += `<tspan class="s${idx + 1} an" style="font-size:${size}px;animation-delay:${d}s">${esc(it[0])}</tspan>`
      })
      out.push(`<text x="${x0}" y="${(r.y + 0.22 * F).toFixed(2)}" xml:space="preserve">${head}${iconsHtml}</text>`)
      continue
    }
    if (r.kind === 'blank') continue
    if (r.kind === 'art') {
      out.push(`<text class="an t" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${at(0)}s" xml:space="preserve">${esc(r.segs[0].t)}</text>`)
      continue
    }
    if (r.kind === 'dots') {
      const n = 16, rad = 4, gap = 6, bx = x0 + 3 + 0.6 * F   // 起始位置：+3px 视觉补偿，再右移一个字符
      let s = ''
      for (let k = 0; k < n; k++) {
        s += `<circle class="sw an" cx="${bx + k * (2 * rad + gap)}" cy="${(r.y - 5).toFixed(0)}" r="${rad}" fill="${NORD16[k]}" style="animation-delay:${at(k * T.dotStep)}s"/>`
      }
      out.push(s); continue
    }
    if (r.kind === 'heat') {
      const lv = levels(r.weeks.flat())
      const nw = r.weeks.length
      const gw = (nw - 1) * GEO.hmPitch + 0.6 * GEO.hmFont        // 网格实际宽度（末列按字宽计）
      const gx = x0 + (GEO.contentW - gw) / 2                     // 在内容宽度内水平居中
      let s = ''
      for (let wk = 0; wk < nw; wk++) {
        for (let dy = 0; dy < 7; dy++) {
          const v = r.weeks[wk][dy] ?? 0
          const k = v === 0 ? 0 : Math.max(1, lv(v))
          s += `<text class="h${k} an" x="${(gx + wk * GEO.hmPitch).toFixed(1)}" y="${(r.y + dy * GEO.hmPitch).toFixed(1)}" style="animation-delay:${at((dy * nw + wk) * T.heatCellStep)}s;font-size:${GEO.hmFont}px" xml:space="preserve">■</text>`
        }
      }
      out.push(s); continue
    }
    if (bar) {                        // 字符进度条（逐格生长；条与条之间串行）
      let s = `<text class="an" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${at(0)}s" xml:space="preserve"><tspan class="d">  ${esc(bar.label)}</tspan>`
      ;[...bar.filled].forEach((_, k) => {
        s += `<tspan class="bar an" style="font-size:${(F*0.82).toFixed(2)}px;animation-delay:${at(k * T.barCharStep)}s">█</tspan>`
      })
      s += `<tspan class="be" style="font-size:${(F*0.82).toFixed(2)}px">${esc(bar.empty)}</tspan><tspan class="t"> ${esc(bar.value)}</tspan></text>`
      out.push(s); continue
    }
    const spans = r.segs.map(s => `<tspan class="${s.c}">${esc(s.t)}</tspan>`).join('')
    out.push(`<text class="an" x="${x0}" y="${r.y.toFixed(2)}" style="animation-delay:${at(0)}s" xml:space="preserve">${spans}</text>`)
  }

  // 4) 结束后静止的提示符 + 闪烁光标（唯一保留的无限动画）；时间取串行游标终点
  const last = rows[rows.length - 1]
  const cy = last.y + LP
  const cx = x0 + PROMPT.length * 0.6 * F        // 提示符实际列数（勿硬编码：写错会与 $ 重叠）
  out.push(`<text class="an acc" x="${x0}" y="${cy.toFixed(2)}" style="animation-delay:${(tc + 0.25).toFixed(2)}s" xml:space="preserve">${esc(PROMPT)}</text>`)
  out.push(`<g class="an" style="animation-delay:${(tc + 0.4).toFixed(2)}s"><rect class="acc" x="${cx.toFixed(1)}" y="${(cy - F * 0.8).toFixed(1)}" width="${(0.6 * F).toFixed(1)}" height="${(F * 0.92).toFixed(1)}" style="animation:blk .8s step-end 0s infinite"/></g>`)
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
