# AGENTS.md

Tauri 2 + React 19 desktop client for NestJS TCP microservices, plus a Rust CLI (`tcp-kai-cli`) sharing the same core (`src-tauri/src/tcp.rs`, `app.db`). Package manager: **bun**.

## Commands
- Dev: `bun run tauri dev` (app) · `bun run dev` (frontend only, Vite).
- Build frontend: `bun run build` (`tsc && vite build`). Typecheck only: `bun run check` (`tsc --noEmit`).
- Rust: `cd src-tauri && cargo build`. CLI: `cargo build --release --features cli --bin tcp-kai-cli`.
- Tests (Rust only, no JS tests): `cd src-tauri && cargo test`. Single test: `cargo test <name>` (add `--features cli` for CLI tests in `src/bin/tcp-kai-cli/`).
- Release: `./release.sh` (see the `release` skill; bumps version, tags, GitHub release + Homebrew cask). Do not hand-edit versions in package.json/tauri.conf.json/Cargo.toml.

## Code style
- Formatting: Prettier config lives in `package.json` — 2-space indent, `printWidth: 90`, semicolons, double quotes, `trailingComma: all`, `arrowParens: always`. Rust: `cargo fmt`.
- TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters`; keep imports and params used. Use `import type` for type-only imports.
- Imports: external packages first, then local (`../lib/...`, `./ui`); grouped, alphabetical-ish.
- Naming: components/functions `PascalCase`/`camelCase`, named exports (no default exports). React components in `src/components/*.tsx`.
- State: zustand store split into slices under `src/lib/store/slices/`; select fields individually via `useApp((s) => s.x)`.
- Comments: explain *why* (intent, invariants, gotchas), in the codebase's mixed RU/EN style — not restating the code.
- Errors: surface user-facing failures via Toast/dialogs, not thrown to the void; in Rust return `Result` and propagate with `?`.
