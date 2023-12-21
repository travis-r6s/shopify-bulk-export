import { assert, it } from 'vitest'
import { foo } from '../src'

it('simple', () => {
  assert.equal(foo, 'foo')
})
