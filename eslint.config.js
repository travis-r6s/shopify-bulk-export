import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    './dist',
  ],
  rules: {
    curly: ['error', 'multi-line'],
  },
})
