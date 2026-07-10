export default [
  {
    ignores: [
      "libs/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.min.js"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        AbortController: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextDecoder: "readonly",
        DOMParser: "readonly",
        Node: "readonly",
        DataTransfer: "readonly",
        createImageBitmap: "readonly",
        OffscreenCanvas: "readonly",
        DragEvent: "readonly",
        ClipboardEvent: "readonly",
        Event: "readonly",
        MouseEvent: "readonly",
        PointerEvent: "readonly",
        KeyboardEvent: "readonly",
        CustomEvent: "readonly",
        MutationObserver: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        atob: "readonly",
        btoa: "readonly",
        marked: "readonly",
        alert: "readonly",
        confirm: "readonly",
        getComputedStyle: "readonly"
      }
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^(_|err)$", "varsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  }
];
