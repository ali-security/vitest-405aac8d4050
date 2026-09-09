import type { ViteDevServer } from 'vite'
import type { InterceptorPluginOptions } from '../../../packages/mocker/src/node/interceptorPlugin'
import type { MockedModuleSerialized } from '../../../packages/mocker/src/registry'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
import { expect, it } from 'vitest'
import { interceptorPlugin } from '../../../packages/mocker/src/node/interceptorPlugin'
import { MockerRegistry } from '../../../packages/mocker/src/registry'

// `secret.txt` lives one directory above the vite root, so a redirect mock that
// escapes the root can have it served as a module
const outsideRoot = fileURLToPath(
  new URL('../fixtures/mocker/redirect-security', import.meta.url),
)
const root = fileURLToPath(
  new URL('../fixtures/mocker/redirect-security/root', import.meta.url),
)

interface InterceptorOptions {
  plugin?: InterceptorPluginOptions
  allow?: string[]
}

async function createInterceptor({ plugin: pluginOptions = {}, allow = [root] }: InterceptorOptions = {}) {
  // a real resolved config, so the file serving allowlist is the genuine one
  const config = await resolveConfig(
    {
      root,
      configFile: false,
      logLevel: 'silent',
      server: {
        fs: { allow },
      },
    },
    'serve',
  )

  const registry = new MockerRegistry()
  const plugin = interceptorPlugin({ registry, ...pluginOptions })

  const sent: string[] = []
  const handlers = new Map<string, (payload: any) => void>()
  const server = {
    config,
    ws: {
      on(event: string, handler: (payload: any) => void) {
        handlers.set(event, handler)
      },
      send(event: string) {
        sent.push(event)
      },
    },
  } as unknown as ViteDevServer

  const configureServer = plugin.configureServer as unknown as (
    server: ViteDevServer,
  ) => void | Promise<void>
  await configureServer(server)

  function register(redirect: string) {
    const handler = handlers.get('vitest:interceptor:register')
    expect(handler).toBeTypeOf('function')
    const event: MockedModuleSerialized = {
      type: 'redirect',
      raw: '',
      id: '/mock',
      url: '/mock',
      redirect,
    }
    handler!(event)
  }

  function load(id: string) {
    const hook = plugin.load as unknown as {
      handler: (this: unknown, id: string) => Promise<string | undefined>
    }
    return hook.handler.call({}, id)
  }

  return { config, registry, register, load, sent, handlers }
}

it.each([
  // an opaque URL scheme keeps the `..` segments, so join(root, pathname)
  // resolves outside the root
  'traversal:../secret.txt',
  'traversal:./../secret.txt',
  'traversal:../../redirect-security/secret.txt',
  'traversal:../../../../../../../../etc/passwd',
])('rejects a redirect mock whose target escapes the project root: %s', async (redirect) => {
  const { register, load, registry, sent } = await createInterceptor()

  register(redirect)

  // the mock is never registered, so the `load` hook has nothing to serve
  expect(registry.getById('/mock')).toBeUndefined()
  await expect(load('/mock')).resolves.toBeUndefined()
  // the client is still told the registration finished instead of hanging
  expect(sent).toContain('vitest:interceptor:register:result')
})

it('does not leak the out-of-root file contents through the load hook', async () => {
  const { register, load } = await createInterceptor()

  register('traversal:../secret.txt')

  // before the fix this resolved to the contents of `secret.txt`
  const code = await load('/mock')
  expect(code).toBeUndefined()
  expect(String(code)).not.toContain('should-never-be-served-as-a-module')
})

it('serves a redirect mock whose target stays inside the project root', async () => {
  const { register, load, registry } = await createInterceptor()

  register('traversal:inroot.js')

  const mock = registry.getById('/mock')
  expect(mock?.type).toBe('redirect')
  await expect(load('/mock')).resolves.toContain('in-root-redirect-ok')
})

it('honours a wider file serving allowlist', async () => {
  // the guard is the `server.fs` allowlist, not a blanket ban on `..`: when the
  // parent directory is explicitly allowed the redirect stays serveable
  const { register, load, registry } = await createInterceptor({
    allow: [root, outsideRoot],
  })

  register('traversal:../secret.txt')

  expect(registry.getById('/mock')?.type).toBe('redirect')
  await expect(load('/mock')).resolves.toContain('should-never-be-served-as-a-module')
})

it('does not register the WebSocket events when they are disabled', async () => {
  const { handlers } = await createInterceptor({
    plugin: { registerWebSocketEvents: false },
  })

  expect(handlers.size).toBe(0)
})
