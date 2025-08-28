# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VSCode extension called "Cloudflare KV Explorer" that provides a read-only UI for exploring Cloudflare Worker KV stores in local development. It supports multiple worker projects in a monorepo setup.

## Development Commands

### Build and Compile
```bash
# Install dependencies
pnpm install

# Production build (uses Rspack bundler)
pnpm run build

# Development build with watch mode
pnpm run dev

# Clean build artifacts
pnpm run clean
```

### Quality Checks
```bash
# Run ESLint
pnpm run lint

# Package extension for distribution
pnpm run package
```

### Testing the Extension
Press `F5` in VSCode to launch the extension in a new Extension Development Host window.

## Architecture

### Build System
The project uses **Rspack** (Rust-based bundler) configured in `rspack.config.ts`:
- Entry: `src/extension.ts` 
- Output: `dist/extension.js` (CommonJS format)
- Uses SWC for fast TypeScript compilation
- Source maps enabled in development mode

### Core Components

#### Extension Layer (`src/`)
- **extension.ts**: Entry point, registers commands and providers, handles activation lifecycle
- **providers/WorkerDiscovery.ts**: Discovers Cloudflare Worker projects by finding wrangler.toml files
- **providers/KVDataProvider.ts**: Core data access - reads SQLite databases and blob files in `.wrangler/state/v3/kv/`
- **providers/KVTreeProvider.ts**: Implements VSCode tree view with Workers → Namespaces → Keys hierarchy
- **providers/KVDocumentProvider.ts**: Virtual document provider for `cloudflare-kv://` scheme
- **providers/WranglerParser.ts**: Parses wrangler.toml files to extract KV namespace bindings

### Data Flow
1. Extension discovers worker projects via wrangler.toml files
2. Parses KV namespace configurations from wrangler.toml
3. Reads SQLite databases in `.wrangler/state/v3/kv/miniflare-KVNamespaceObject/`
4. Maps namespace IDs to binding names
5. Reads blob content from `.wrangler/state/v3/kv/[namespace-id]/blobs/`
6. Displays data in VSCode tree view with syntax highlighting

### Key Technologies
- **SQLite**: Used by Cloudflare's local KV storage for metadata (`@vscode/sqlite3`)
- **Rspack**: Modern bundler for fast builds
- **Chokidar**: File system watcher for auto-refresh functionality
- **TOML**: Parser for wrangler.toml configuration files