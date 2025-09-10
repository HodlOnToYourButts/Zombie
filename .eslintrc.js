module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
    browser: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'commonjs'
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'no-undef': 'off',
    'no-useless-escape': 'warn',
    'no-control-regex': 'warn',
    'no-prototype-builtins': 'warn',
    'no-cond-assign': 'warn'
  }
};