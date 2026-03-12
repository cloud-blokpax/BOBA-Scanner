name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: TypeScript check
        run: npm run check

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Check bundle size
        run: |
          MAX_SIZE=204800  # 200KB
          JS_SIZE=$(find .svelte-kit/output -name '*.js' -exec wc -c {} + 2>/dev/null | tail -1 | awk '{print $1}')
          if [ "${JS_SIZE:-0}" -gt "$MAX_SIZE" ]; then
            echo "Bundle size ${JS_SIZE} bytes exceeds ${MAX_SIZE} bytes limit"
            exit 1
          fi
          echo "Bundle size: ${JS_SIZE:-0} bytes (limit: ${MAX_SIZE})"
