/**
 * git push 失败后的自救。
 *
 * 本机最常见的失败不是业务问题，而是「网络被掐」：curl 35 SSL_ERROR_SYSCALL、
 * RPC failed、Connection reset 之类 —— 系统代理开着，但 git 不读系统代理，
 * 于是它自己解析域名撞到 fake-IP 的黑洞里。这种情况用代理再试一次通常就好，
 * 所以这里在网络类失败后自动重试一次（顺手把 http.version 降到 HTTP/1.1，
 * 大 pack 在 HTTP/2 下更容易 RPC failed），仍然不行就把能直接复制的命令打出来。
 *
 * 认证失败、非快进等业务失败不重试 —— 重试也不会变好。
 */
import { execFileSync } from 'node:child_process'
import net from 'node:net'

/** 网络层失败的典型字样 */
const NETWORK_FAILURE =
  /SSL_ERROR_SYSCALL|RPC failed|unexpected disconnect|Could not resolve host|Connection (was )?reset|Failed to connect|Connection timed out|Recv failure|Remote end hung up|TLS|handshake/i

/** 这段输出是不是网络层失败（而不是认证 / 非快进这类业务失败） */
export function isNetworkFailure(output) {
  return NETWORK_FAILURE.test(String(output ?? ''))
}

/** Windows 系统代理（Internet 设置里那份），拿不到返回 null */
function systemProxy() {
  if (process.platform !== 'win32') return null
  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/.test(output)) return null
    // 值可能是 "127.0.0.1:7890"，也可能是 "http=host:port;https=host:port"
    const value = output.match(/ProxyServer\s+REG_SZ\s+(.+)/)?.[1]?.trim()
    if (!value) return null
    const entry = value.includes('=') ? value.match(/https?=([^;]+)/)?.[1]?.trim() : value
    if (!entry) return null
    return /^https?:\/\//.test(entry) ? entry : `http://${entry}`
  } catch {
    return null
  }
}

/** 端口通不通：短超时 TCP 探测，比拿代理去试错便宜 */
function reachable(url) {
  return new Promise((resolve) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return resolve(false)
    }
    const socket = net.connect({
      host: parsed.hostname,
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
    })
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(600)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * 找一个可用的本机代理：环境变量 → Windows 系统代理 → Clash 默认端口。
 * 环境变量是显式设置，直接用不再探测；其余都先探测再返回。
 */
export async function resolveProxy() {
  const explicit = [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy].find(Boolean)
  if (explicit) return explicit

  for (const candidate of [systemProxy(), 'http://127.0.0.1:7890'].filter(Boolean)) {
    if (await reachable(candidate)) return candidate
  }
  return null
}

/**
 * push，网络类失败后用代理重试一次。
 * @param {{ run: (extraArgs: string[]) => { ok: boolean, output?: string }, resolve?: () => Promise<string | null> }} options
 *   run 收一组要插在子命令前面的 `-c` 参数，返回是否成功与失败输出
 * @returns {Promise<{ ok: boolean, network: boolean, proxy: string | null, output: string }>}
 */
export async function pushWithRetry({ run, resolve = resolveProxy }) {
  const first = await run([])
  if (first.ok) return { ok: true, network: false, proxy: null, output: '' }

  const output = first.output ?? ''
  if (!isNetworkFailure(output)) return { ok: false, network: false, proxy: null, output }

  const proxy = await resolve()
  if (!proxy) return { ok: false, network: true, proxy: null, output }

  const retry = await run(['-c', `http.proxy=${proxy}`, '-c', 'http.version=HTTP/1.1'])
  return retry.ok
    ? { ok: true, network: true, proxy, output: '' }
    : { ok: false, network: true, proxy, output: retry.output ?? output }
}

/** 失败后给用户看的话：把可复制的命令带上 */
export function pushHint({ network, proxy }) {
  if (!network) return ''
  const proxyLine = proxy
    ? `已用 ${proxy} 重试一次仍失败。`
    : `没找到可用的本机代理（环境变量 HTTPS_PROXY、Windows 系统代理、127.0.0.1:7890 都试过了）。`
  return `${proxyLine}通常是本机代理没起来或没走代理，代理恢复后重推即可：

  git push
  git -c http.proxy=http://127.0.0.1:7890 -c http.version=HTTP/1.1 push`
}
