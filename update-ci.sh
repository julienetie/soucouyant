#!/usr/bin/env bash
# Adds the TypeScript tests to the CI workflow. Run once from the repo root, then delete this script.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'SOUCOUYANT_EOF'
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: Node ${{ matrix.node }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      # Builds ./dist, then runs the suite against the built and minified files
      - run: npm run test:dist
      - run: npm run test:min
      - run: npm run size
      # The declarations, against the build, with TypeScript 5.0, 5.9 and 7
      - run: npm run test:types
      - run: npm run test:natives
SOUCOUYANT_EOF
echo "Updated .github/workflows/ci.yml"
