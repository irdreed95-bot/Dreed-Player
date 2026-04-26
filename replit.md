# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.
Also includes a standalone **LuxPlayer** served by an Express server at the root.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (api-server artifact) / Express 4 (root LuxPlayer server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## LuxPlayer

A premium, ad-free custom video player with HLS streaming support.

### Files
- `index.js` — Express static server (serves `/player` folder on port 3000)
- `player/index.html` — Player HTML shell; change `data-src` on `#lux-player` to point at any MP4 or HLS (.m3u8) URL
- `player/player.css` — All styles; change `--lux-accent` at the top to rebrand
- `player/player.js` — All interactivity (HLS, controls, subtitles, keyboard shortcuts)

### Features
- HLS (.m3u8) streaming via hls.js + native fallback for Safari
- MP4 / WebM / Ogg direct playback
- Play/Pause, Volume, Seek bar, Time display, Fullscreen, PiP, Playback Speed, CC (WebVTT)
- Keyboard shortcuts: Space/K play, ←/→ seek ±5s, ↑/↓ volume, M mute, F fullscreen, P PiP, C captions
- Auto-hiding controls, buffering spinner, glassmorphism control bar
- Fully responsive (mobile + desktop)

### Run
```
node index.js          # starts on port 3000
```

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
