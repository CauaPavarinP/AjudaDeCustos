// Verificador de código: `npm run lint`. Aponta variável não usada, nome digitado errado, etc.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    // Servidor e testes (Node)
    files: ['*.js', 'services/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: globals.node },
  },
  {
    // Telas (navegador). Cada .js é carregado por <script> e usa o que os anteriores deixaram em window.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Regras: 'readonly', avisar: 'readonly', confirmar: 'readonly', dialogoAberto: 'readonly',
        comprimirFoto: 'readonly', baixarXlsx: 'readonly', novoPdf: 'readonly',
      },
    },
  },
  {
    // foto.js é quem cria comprimirFoto (as outras telas só usam)
    files: ['public/foto.js'],
    languageOptions: { globals: { comprimirFoto: 'off' } },
  },
  {
    // regras.js também roda no Node (require)
    files: ['public/regras.js'],
    languageOptions: { globals: { module: 'writable' } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
