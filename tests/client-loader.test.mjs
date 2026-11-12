import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('lib/client.js registers the package factory with the module loader', () => {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(!/^export /m.test(code), 'loader file must not contain ESM export syntax')
  let registered
  const window = {
    __ModuleLoader__: {
      load: (entry) => { registered = entry },
    },
  }
  vm.runInNewContext(code, { window, document: undefined, console, setInterval, clearInterval, setTimeout, clearTimeout })
  assert.ok(registered, 'expected a __ModuleLoader__.load call')
  assert.equal(registered.id, 'dsh-better-chat')
  const plugin = registered.factory()
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject) && plugin.inject.length === 0, 'inject must be an empty array')
})
