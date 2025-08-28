# VSCode Extension: Cloudflare KV Explorer

## Extension Overview
Create a VSCode extension that provides a rich UI for exploring Cloudflare Worker KV stores in local development, supporting multiple worker projects in a monorepo.

## Requirements Summary

### UI/UX Requirements
- **Dedicated webview panel** for rich user experience
- **Split view**: List of keys on left, selected value content on right
- **Syntax highlighting** for JSON and text values
- **No editing capabilities** - read-only viewer
- **Comparison feature** to view two values side-by-side
- **Search and filter** functionality for keys and values

### Technical Requirements
- **Multi-project support**: Handle multiple workers in monorepo
- **Show binding names** (e.g., ze_envs, ze_snapshots) not raw IDs
- **Auto-refresh** with file watching + manual refresh button
- **Truncation** for large values with "Show More" option
- **No binary data support** initially

## Architecture Plan

### 1. Project Structure
```
cloudflare-kv-explorer/
├── src/
│   ├── extension.ts           # Main extension entry point
│   ├── providers/
│   │   ├── WorkerDiscovery.ts # Find worker projects
│   │   ├── KVDataProvider.ts  # Read KV data from SQLite/blobs
│   │   └── WranglerParser.ts  # Parse wrangler.toml files
│   ├── views/
│   │   └── webview/
│   │       ├── panel.ts       # Webview panel controller
│   │       └── app/           # React/Vue app for UI
│   │           ├── App.tsx
│   │           ├── components/
│   │           │   ├── WorkerSelector.tsx
│   │           │   ├── KVExplorer.tsx
│   │           │   ├── KeyList.tsx
│   │           │   ├── ValueViewer.tsx
│   │           │   └── ComparisonView.tsx
│   │           └── styles/
│   └── utils/
│       ├── sqlite.ts          # SQLite operations
│       └── fileWatcher.ts     # Watch .wrangler changes
├── media/                     # Icons and static assets
├── package.json
├── tsconfig.json
└── webpack.config.js          # Bundle webview assets
```

### 2. Core Features Implementation

#### A. Worker Discovery
- Scan workspace recursively for `wrangler.toml` files
- Parse each to extract:
  - Worker name
  - KV namespace bindings (name → ID mapping)
  - Environment configurations (development, staging, production)
- Handle nested worker projects in monorepo structure

#### B. KV Data Reading
For each worker's `.wrangler/state/v3/kv/`:
1. Locate SQLite databases in `miniflare-KVNamespaceObject/`
2. Map namespace IDs to binding names from wrangler.toml
3. Query `_mf_entries` table for keys and blob IDs
4. Read blob files from `[namespace-id]/blobs/` directories
5. Handle different content types (JSON, text, HTML)

#### C. UI Components (Webview Panel)

**Layout Structure:**
```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [Worker Dropdown] [Search] [Filter] [Refresh]  │
├─────────────────────────────────────────────────────────┤
│         │                                                │
│ Left    │ Right Panel:                                   │
│ Panel:  │ ┌─────────────────────────────────────────┐   │
│         │ │ Key: selected-key-name                  │   │
│ Tree    │ │ Namespace: ze_snapshots                 │   │
│ View    │ │ Size: 2.3 KB                           │   │
│ with    │ ├─────────────────────────────────────────┤   │
│ Keys    │ │ {                                       │   │
│         │ │   "application_uid": "rspack-mf",      │   │
│         │ │   "version": "0.0.0",                  │   │
│         │ │   ...                                   │   │
│         │ │ }                                       │   │
│         │ └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Components:**
- **WorkerSelector**: Dropdown to select active worker project
- **KVExplorer**: Main container managing state
- **KeyList**: Searchable tree view of namespaces and keys
- **ValueViewer**: Monaco editor or Prism for syntax highlighting
- **ComparisonView**: Side-by-side diff viewer

#### D. Key Features

##### 1. Search & Filter
- Real-time key filtering as you type
- Support for:
  - Exact match
  - Contains
  - Regex patterns
- Search within values (optional toggle)
- Clear/reset filters

##### 2. Value Display
- Automatic JSON detection and formatting
- Syntax highlighting based on content type
- Line numbers for large values
- Truncation at 10KB with "Show More" button
- Copy to clipboard functionality
- Raw/formatted toggle for JSON

##### 3. Comparison Mode
- Select two keys via checkboxes
- Open comparison view
- Side-by-side diff with:
  - Added lines (green)
  - Removed lines (red)
  - Changed sections highlighted
- Synchronized scrolling

##### 4. Auto-refresh
- File system watcher on `.wrangler/state/v3/kv/` directories
- Debounced refresh (500ms) to avoid excessive updates
- Visual indicator when refreshing
- Manual refresh button always available
- Preserve selection and scroll position on refresh

### 3. Technical Implementation Details

#### Dependencies
```json
{
  "dependencies": {
    "sqlite3": "^5.0.0",      // Read KV metadata
    "toml": "^3.0.0",          // Parse wrangler.toml
    "chokidar": "^3.5.0",      // File watching
    "react": "^18.0.0",        // Webview UI
    "monaco-editor": "^0.30.0" // Code editor for values
  }
}
```

#### Extension Activation
Activate on:
- Command: `KV Explorer: Open Panel`
- Context menu on wrangler.toml: `Open KV Explorer`
- Activity bar icon (optional)
- Presence of `.wrangler` directory in workspace

#### Data Flow
```
1. Discovery → Scan for worker projects
2. Parse → Extract KV namespace configurations  
3. Load → Read SQLite databases and blob files
4. Transform → Format data for display
5. Cache → Store in memory for performance
6. Render → Display in webview with React
7. Watch → Monitor for file changes
8. Update → Refresh affected data only
```

#### Performance Optimizations
- Lazy load blob content (only when key selected)
- Virtual scrolling for large key lists
- Paginate results (show 100 keys at a time)
- Cache parsed wrangler.toml data
- Debounce search/filter operations
- Use Web Workers for heavy processing

### 4. Implementation Steps

#### Phase 1: Foundation (Day 1-2)
1. Create extension boilerplate with yo code
2. Set up TypeScript and build configuration
3. Implement basic webview panel
4. Add React and webpack configuration

#### Phase 2: Data Layer (Day 2-3)
5. Implement worker discovery system
6. Create wrangler.toml parser
7. Add SQLite integration
8. Build blob file reader

#### Phase 3: UI Development (Day 3-5)
9. Design and implement React components
10. Add Monaco editor for value display
11. Implement tree view for key navigation
12. Add search and filter functionality

#### Phase 4: Advanced Features (Day 5-6)
13. Implement comparison view
14. Add file watching and auto-refresh
15. Add clipboard operations
16. Implement truncation and pagination

#### Phase 5: Polish & Testing (Day 6-7)
17. Add error handling and edge cases
18. Implement loading states and progress indicators
19. Add VSCode theme integration
20. Write tests and documentation

### 5. Future Enhancements (Post-MVP)
- Export functionality (JSON, CSV)
- Binary data preview (images, PDFs)
- KV usage statistics and analytics
- Edit capability with safety warnings
- Multiple value selection for bulk operations
- History tracking (show previous values)
- Integration with remote Cloudflare KV
- Bookmark frequently accessed keys
- Custom value transformers/formatters

### 6. Testing Strategy
- Unit tests for data parsing logic
- Integration tests for SQLite operations
- E2E tests for UI interactions
- Manual testing with various KV store sizes
- Performance testing with large datasets

### 7. Documentation
- README with installation instructions
- User guide with screenshots
- API documentation for extensibility
- Contributing guidelines
- Changelog for version updates

## Success Criteria
- ✅ Can discover all worker projects in workspace
- ✅ Correctly maps KV namespace bindings to IDs
- ✅ Displays all keys in a searchable list
- ✅ Shows value content with syntax highlighting
- ✅ Supports comparison of two values
- ✅ Auto-refreshes when KV data changes
- ✅ Handles large values gracefully
- ✅ Provides smooth, responsive user experience

## Estimated Timeline
- **MVP Development**: 5-7 days
- **Testing & Polish**: 2-3 days
- **Documentation**: 1 day
- **Total**: ~10 days for production-ready extension