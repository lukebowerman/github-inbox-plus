import js from '@eslint/js';

export default [
  js.configs.recommended,
  { languageOptions: { globals: {
    chrome: 'readonly', document: 'readonly', window: 'readonly', location: 'readonly',
    requestAnimationFrame: 'readonly', MutationObserver: 'readonly', URL: 'readonly',
    setTimeout: 'readonly', setInterval: 'readonly', IntersectionObserver: 'readonly',
    Response: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', crypto: 'readonly',
  } } },
];
