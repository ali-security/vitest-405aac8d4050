import { expect, test } from 'vitest'
import { runVitestCli } from '../../test-utils'

const [nvMajor, nvMinor] = process.versions.node.split('.').map(Number)
// Node 22.18.0 enabled type stripping by default (backported from 23.6), so
// Node 22 runtimes newer than that load the TS config successfully too.
const isTypeStrippingSupported
  = (nvMajor === 22 && nvMinor >= 18) || (nvMajor === 23 && nvMinor >= 6) || nvMajor >= 24

test('configLoader default', async () => {
  const { vitest, exitCode } = await runVitestCli(
    'run',
    '--root',
    'fixtures/config-loader',
  )
  if (!isTypeStrippingSupported) {
    expect(vitest.stderr).toContain('failed to load config')
    expect(exitCode).not.toBe(0)
  }
  else {
    expect(exitCode).toBe(0)
  }
})

test('configLoader runner', async () => {
  const { vitest, exitCode } = await runVitestCli(
    'run',
    '--root',
    'fixtures/config-loader',
    '--configLoader',
    'runner',
  )
  expect(vitest.stderr).toBe('')
  expect(vitest.stdout).toContain('✓  node')
  expect(vitest.stdout).toContain('✓  browser (chromium)')
  expect(exitCode).toBe(0)
})
