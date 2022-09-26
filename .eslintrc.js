module.exports = {
    root: true,
    env: {
        node: true,
        mocha: true
    },
    parserOptions: {
        ecmaVersion: 2020
    },
    extends: [
        'airbnb-base'
    ],
    rules: {
        commonjs: 0,
        'linebreak-style': ['error', process.platform === 'win32' ? 'windows' : 'unix'],
        indent: ['error', 4],
        'no-plusplus': 'off',
        'comma-dangle': ['error', 'never'],
        radix: 0,
        'import/extensions': ['error', 'ignorePackages', { js: 'never', jsx: 'never' }],
        'max-len': [0, { code: 100 }],
        semi: ['error', 'never'],
        'no-continue': 0,
        'no-await-in-loop': 0,
        'no-console': 0,
        'no-underscore-dangle': 0,
        'consistent-return': 0,
        camelcase: 0,
        'prefer-destructuring': 0,
        'no-param-reassign': 0,
        'no-nested-ternary': 0,
        'no-restricted-globals': 0,
        'class-methods-use-this': 0,
        experimentalDecorators: 0,
        'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
        'no-undef': 0
    }
}
