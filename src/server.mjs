// server.mjs —— 本地开发服务器 + 一次性生成 CLI
//   node src/server.mjs --port 8731        # 起服务：GET /readme/terminal.svg、预览页 /
//   node src/server.mjs --once dist/terminal.svg
// 生产（lee-server-2）：同一份代码由 systemd timer 以 --once 调起写入静态目录，nginx 出图并带 Cache-Control: max-age=600

import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { collectAll } from './facts.mjs'
import { renderSvg, GEO } from './svg.mjs'

const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }

const svgCache = { at: 0, body: null, height: 0 }
async function build({ ttl = Number(process.env.SVG_TTL_SECONDS ?? 60) } = {}) {
  if (svgCache.body && Date.now() - svgCache.at < ttl * 1000) return svgCache
  const now = new Date()
  const data = await collectAll(now)
  const body = renderSvg({ data, now })
  svgCache.at = Date.now(); svgCache.body = body; svgCache.height = Number(body.match(/height="(\d+)"/)?.[1] ?? 0)
  return svgCache
}

// ---------- --once ----------
if (args.includes('--once')) {
  const dest = resolve(flag('--once', 'dist/terminal.svg'))
  const { body } = await build({ ttl: 0 })
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp`
  writeFileSync(tmp, body)          // 原子写：先写 .tmp 再 rename，避免 nginx/camo 读到半截
  const { renameSync, statSync } = await import('node:fs')
  renameSync(tmp, dest)
  console.log(`已生成 ${dest}（${(statSync(dest).size / 1024).toFixed(1)} KB）`)
  process.exit(0)
}

// ---------- 本地服务器 ----------
const PORT = Number(flag('--port', process.env.PORT ?? 8731))
const HOST = flag('--host', '127.0.0.1')

const PREVIEW = (h) => `<!doctype html><meta charset="utf-8"><title>professorLee terminal.svg 预览</title>
<style>
 body{margin:0;background:#ECEFF4;color:#2E3440;font:13px ui-monospace,monospace;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px}
 body.dark{background:#2E3440;color:#ECEFF4}
 img{box-shadow:0 0 0 1px #8884;image-rendering:auto}
 button{font:inherit;padding:4px 10px;cursor:pointer}
</style>
<div>
  <button onclick="document.body.classList.toggle('dark')">light / dark</button>
  <button onclick="document.getElementById('s').src='/readme/terminal.svg?t='+Date.now()">replay（刷新重播）</button>
  <span id="info">尺寸 ${GEO.W}×${h}</span>
</div>
<img id="s" src="/readme/terminal.svg" width="550">`

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (url.pathname === '/readme/terminal.svg') {
      const { body } = await build()
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // 本地开发：短缓存便于反复看；生产由 nginx 覆盖为 600s
        'Cache-Control': `public, max-age=${Number(process.env.SVG_TTL_SECONDS ?? 60)}`,
      })
      res.end(body); return
    }
    if (url.pathname === '/' ) {
      const { height } = await build()
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PREVIEW(height)); return
    }
    if (url.pathname === '/healthz') {
      const { height, at } = await build()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, height, generatedAt: new Date(at).toISOString(), ttl: Number(process.env.SVG_TTL_SECONDS ?? 60) })); return
    }
    res.writeHead(404).end('not found')
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(e.stack ?? e))
  }
}).listen(PORT, HOST, () => console.log(`[profLee] http://${HOST}:${PORT}/  (svg: /readme/terminal.svg)`))
