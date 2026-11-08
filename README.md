# Psi

Multi-tenant, bilingual (es/en) psychological practice management SaaS by SyV Solutions.
First tenant: Daniela Ortega, Psicóloga (Colombia). Vision and scope: [PROJECT.md](PROJECT.md).

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10
- Docker + Supabase CLI (from the backend workstream onward)

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in values; never commit secrets
pnpm dev                     # http://localhost:3000
```

## Scripts

| Script                         | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| `pnpm dev` / `build` / `start` | Next.js development, production build/run |
| `pnpm lint`                    | ESLint (includes architecture boundaries) |
| `pnpm typecheck`               | `tsc --noEmit` (strict)                   |
| `pnpm format` / `format:check` | Prettier                                  |
| `pnpm test` / `test:watch`     | Vitest                                    |
| `pnpm e2e`                     | Playwright (chromium)                     |
| `pnpm i18n:check`              | es/en message key parity                  |

## Documentation

- [CLAUDE.md](CLAUDE.md) project rules and agent coordination
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md)
- [docs/DATABASE.md](docs/DATABASE.md), [docs/SECURITY.md](docs/SECURITY.md)
- [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md)
