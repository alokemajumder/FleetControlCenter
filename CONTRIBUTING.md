# Contributing to ClawCC

Thank you for your interest in contributing to ClawCC. This document provides guidelines and instructions for contributing.

## Ground Rules

1. **Zero external dependencies.** All code must use the Node.js standard library only. No npm packages. This is non-negotiable.
2. **All new features require tests.** Use `node:test` and `node:assert/strict`.
3. **Security first.** Do not introduce vulnerabilities (injection, XSS, path traversal, etc.). If you find one, report it privately via [Security Advisories](https://github.com/alokemajumder/clawcc/security/advisories).

## Getting Started

```bash
# Clone and verify
git clone https://github.com/alokemajumder/clawcc.git
cd clawcc
node --version  # Must be >= 18.0.0

# Run tests
npm test                    # Unit tests (10 suites)
node test/e2e-smoke.js      # E2E smoke tests
npm run test:all            # Both

# Start the server
cp config/clawcc.config.example.json clawcc.config.json
npm start
```

No `npm install` is needed. There are no dependencies.

## Development Workflow

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally.
3. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes.** Keep commits focused and atomic.
5. **Add tests** for any new functionality.
6. **Run the full test suite** and ensure all tests pass:
   ```bash
   npm run test:all
   ```
7. **Push** your branch and open a Pull Request against `main`.

## What to Contribute

| Type | Description |
|------|-------------|
| Bug fixes | Fix confirmed issues with a failing test and a fix |
| Security improvements | Harden existing controls or add new defensive measures |
| Test coverage | Add tests for untested code paths |
| Documentation | Fix inaccuracies, improve clarity, add examples |
| Performance | Optimize hot paths with benchmarks showing improvement |
| New features | Open an issue first to discuss the design |

## Code Style

- Use `'use strict';` at the top of every file.
- Use `const` by default, `let` when reassignment is needed, never `var`.
- Use `node:` prefix for all stdlib imports (e.g., `require('node:fs')`).
- Use factory functions (e.g., `createEventStore()`) instead of classes.
- Keep functions small and focused. Prefer pure functions where possible.
- Error messages should be descriptive and actionable.
- No console.log in library code except for startup messages and error logging.

## Testing Guidelines

- Test files go in `test/<module-name>/<module-name>.test.js`.
- Use `describe()` and `it()` from `node:test`.
- Use `assert` from `node:assert/strict`.
- Tests must be deterministic -- no reliance on timing, network, or external state.
- Use temporary directories (`os.tmpdir()`) for filesystem tests and clean up after.
- Test both success and failure paths.

## Commit Messages

- Use imperative mood: "Add feature" not "Added feature".
- Keep the first line under 72 characters.
- Reference issue numbers where applicable: "Fix session leak (#42)".

## Pull Request Process

1. Ensure all tests pass (`npm run test:all`).
2. Update documentation if your change affects the API, configuration, or user-facing behavior.
3. Fill out the PR template with a description of what changed and why.
4. A maintainer will review your PR. Address any feedback promptly.
5. Once approved, a maintainer will merge your PR.

## Reporting Bugs

Open an issue on GitHub with:
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Node.js version and operating system
- Relevant log output

## Reporting Security Vulnerabilities

Do **not** open a public issue for security vulnerabilities. Instead, use [GitHub Security Advisories](https://github.com/alokemajumder/clawcc/security/advisories) to report them privately. See [SECURITY.md](SECURITY.md) for details.

## License

By contributing to ClawCC, you agree that your contributions will be licensed under the MIT License.
