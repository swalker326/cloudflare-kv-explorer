import * as vscode from 'vscode';
import { WorkerDiscovery } from './WorkerDiscovery';
import { KVDataProvider } from './KVDataProvider';
import { createKVUri } from './KVDocumentProvider';
import * as path from 'path';
import { outputChannel, DEBUG } from '../extension';

interface WorkerProject {
  name: string;
  path: string;
  kvNamespaces: Array<{ binding: string; id: string; }>;
}

interface KVEntry {
  key: string;
  blobId: string;
  expiration?: number;
  metadata?: string;
}

type TreeItem = WorkerItem | NamespaceItem | KeyItem;

class WorkerItem extends vscode.TreeItem {
  constructor(
    public readonly worker: WorkerProject,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(worker.name, collapsibleState);
    this.contextValue = 'worker';
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.tooltip = `${this.worker.name}\n${this.worker.path}`;
    this.description = `${this.worker.kvNamespaces.length} namespaces`;
  }
}

class NamespaceItem extends vscode.TreeItem {
  constructor(
    public readonly worker: WorkerProject,
    public readonly namespace: { binding: string; id: string },
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly matchCount?: number
  ) {
    super(namespace.binding, collapsibleState);
    this.contextValue = 'namespace';
    this.iconPath = new vscode.ThemeIcon('database');
    this.tooltip = `Namespace: ${namespace.binding}\nID: ${namespace.id}`;
    
    // Show match count when searching
    if (matchCount !== undefined && matchCount > 0) {
      this.description = `${matchCount} matches`;
    }
  }
}

class KeyItem extends vscode.TreeItem {
  constructor(
    public readonly worker: WorkerProject,
    public readonly namespaceId: string,
    public readonly entry: KVEntry
  ) {
    super(entry.key, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'key';
    
    // Choose icon based on key pattern
    if (entry.key.endsWith('.json') || entry.key.includes('config')) {
      this.iconPath = new vscode.ThemeIcon('json');
    } else if (entry.key.includes('snapshot')) {
      this.iconPath = new vscode.ThemeIcon('history');
    } else {
      this.iconPath = new vscode.ThemeIcon('key');
    }

    // Set tooltip
    const tooltipLines = [`Key: ${entry.key}`];
    if (entry.metadata) {
      tooltipLines.push('Has metadata');
    }
    if (entry.expiration) {
      tooltipLines.push(`Expires: ${new Date(entry.expiration).toLocaleString()}`);
    }
    this.tooltip = tooltipLines.join('\n');

    // Add badges
    const badges = [];
    if (entry.metadata) badges.push('META');
    if (entry.expiration) badges.push('TTL');
    if (badges.length > 0) {
      this.description = badges.join(' ');
    }

    // Set command to open in editor
    this.command = {
      command: 'cloudflare-kv-explorer.openKey',
      title: 'Open KV Entry',
      arguments: [this.worker, this.namespaceId, this.entry.key]
    };
  }
}

export class KVTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = 
    new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private workers: WorkerProject[] = [];
  private kvEntries = new Map<string, KVEntry[]>();
  private searchTerm: string = '';
  private searchResults = new Map<string, Set<string>>(); // namespaceId -> matching keys

  // Getter for workers to ensure they're always available
  async getWorkers(): Promise<WorkerProject[]> {
    if (this.workers.length === 0) {
      this.workers = await this.workerDiscovery.findWorkers();
    }
    return this.workers;
  }

  constructor(
    private workerDiscovery: WorkerDiscovery,
    private kvDataProvider: KVDataProvider
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async fullRefresh(): Promise<void> {
    // Clear all caches and reset state
    this.workers = [];
    this.kvEntries.clear();
    this.searchTerm = '';
    this.searchResults.clear();
    vscode.commands.executeCommand('setContext', 'cloudflareKVExplorer.searching', false);
    
    // Force re-discovery of workers
    this.workers = await this.workerDiscovery.findWorkers();
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(element: TreeItem): Promise<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // Root level - show workers
      // Only re-fetch if we don't have workers cached
      if (this.workers.length === 0) {
        this.workers = await this.workerDiscovery.findWorkers();
      }
      
      // If searching AND we have search results, filter by them
      if (this.searchTerm && this.searchResults.size > 0) {
        return this.workers
          .filter(worker => 
            worker.kvNamespaces.some(ns => {
              const key = `${worker.path}:${ns.id}`;
              return this.searchResults.has(key) && this.searchResults.get(key)!.size > 0;
            })
          )
          .map(worker => 
            new WorkerItem(
              worker, 
              vscode.TreeItemCollapsibleState.Expanded // Auto-expand when searching
            )
          );
      }
      
      // Show all workers if not searching or no results
      return this.workers.map(worker => 
        new WorkerItem(
          worker, 
          worker.kvNamespaces.length > 0 
            ? vscode.TreeItemCollapsibleState.Collapsed 
            : vscode.TreeItemCollapsibleState.None
        )
      );
    }

    if (element instanceof WorkerItem) {
      // Show namespaces for this worker
      if (this.searchTerm && this.searchResults.size > 0) {
        // Only show namespaces with search results
        return element.worker.kvNamespaces
          .filter(ns => {
            const key = `${element.worker.path}:${ns.id}`;
            return this.searchResults.has(key) && this.searchResults.get(key)!.size > 0;
          })
          .map(ns => {
            const key = `${element.worker.path}:${ns.id}`;
            const matchCount = this.searchResults.get(key)?.size || 0;
            return new NamespaceItem(
              element.worker,
              ns,
              vscode.TreeItemCollapsibleState.Expanded, // Auto-expand when searching
              matchCount
            );
          });
      }
      
      return element.worker.kvNamespaces.map(ns => 
        new NamespaceItem(
          element.worker,
          ns,
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    }

    if (element instanceof NamespaceItem) {
      // Show keys for this namespace
      const cacheKey = `${element.worker.path}:${element.namespace.id}`;
      
      // Check cache first
      if (!this.kvEntries.has(cacheKey)) {
        try {
          const data = await this.kvDataProvider.getKVData(
            element.worker.path,
            element.namespace.id
          );
          this.kvEntries.set(cacheKey, data.entries);
        } catch (error) {
          console.error('Error fetching KV data:', error);
          this.kvEntries.set(cacheKey, []);
        }
      }

      const entries = this.kvEntries.get(cacheKey) || [];
      
      // Filter by search results if actively searching with results
      if (this.searchTerm && this.searchResults.size > 0 && this.searchResults.has(cacheKey)) {
        const matchingKeys = this.searchResults.get(cacheKey)!;
        return entries
          .filter(entry => matchingKeys.has(entry.key))
          .map(entry => 
            new KeyItem(element.worker, element.namespace.id, entry)
          );
      }
      
      return entries.map(entry => 
        new KeyItem(element.worker, element.namespace.id, entry)
      );
    }

    return [];
  }

  async performSearch(searchTerm: string, showNotification: boolean = true): Promise<number | undefined> {
    this.searchTerm = searchTerm.toLowerCase();
    this.searchResults.clear();
    
    if (!searchTerm) {
      vscode.commands.executeCommand('setContext', 'cloudflareKVExplorer.searching', false);
      this.refresh();
      return;
    }
    
    vscode.commands.executeCommand('setContext', 'cloudflareKVExplorer.searching', true);

    // Search through all workers and namespaces
    const workers = await this.workerDiscovery.findWorkers();
    let totalMatches = 0;
    
    for (const worker of workers) {
      for (const namespace of worker.kvNamespaces) {
        const cacheKey = `${worker.path}:${namespace.id}`;
        const matchingKeys = new Set<string>();
        
        try {
          // Get all entries for this namespace
          let entries: KVEntry[];
          if (this.kvEntries.has(cacheKey)) {
            entries = this.kvEntries.get(cacheKey)!;
          } else {
            const data = await this.kvDataProvider.getKVData(worker.path, namespace.id);
            this.kvEntries.set(cacheKey, data.entries);
            entries = data.entries;
          }
          
          // Search in keys and optionally in values
          for (const entry of entries) {
            // Fuzzy match on key
            if (this.fuzzyMatch(entry.key.toLowerCase(), this.searchTerm)) {
              matchingKeys.add(entry.key);
              totalMatches++;
            } else {
              // Also check value content if key doesn't match
              try {
                const value = await this.kvDataProvider.getValue(worker.path, namespace.id, entry.key);
                if (value && value.toLowerCase().includes(this.searchTerm)) {
                  matchingKeys.add(entry.key);
                  totalMatches++;
                }
              } catch {
                // Ignore errors when searching values
              }
            }
          }
        } catch (error) {
          console.error(`Error searching namespace ${namespace.id}:`, error);
        }
        
        if (matchingKeys.size > 0) {
          this.searchResults.set(cacheKey, matchingKeys);
        }
      }
    }
    
    this.refresh();
    
    if (showNotification) {
      if (totalMatches > 0) {
        vscode.window.showInformationMessage(`Found ${totalMatches} matching entries`);
      } else {
        vscode.window.showWarningMessage(`No matches found for "${searchTerm}"`);
      }
    }
    
    return totalMatches;
  }

  fuzzyMatch(text: string, search: string): boolean {
    // Simple fuzzy matching - all search characters must appear in order
    let searchIndex = 0;
    for (let i = 0; i < text.length && searchIndex < search.length; i++) {
      if (text[i] === search[searchIndex]) {
        searchIndex++;
      }
    }
    return searchIndex === search.length;
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.searchResults.clear();
    vscode.commands.executeCommand('setContext', 'cloudflareKVExplorer.searching', false);
    // Don't clear workers cache when clearing search
    this.refresh();
  }

  dispose() {
    this._onDidChangeTreeData.dispose();
  }
}

export function registerKVTreeView(
  context: vscode.ExtensionContext,
  workerDiscovery: WorkerDiscovery,
  kvDataProvider: KVDataProvider
): KVTreeProvider {
  const treeProvider = new KVTreeProvider(workerDiscovery, kvDataProvider);
  
  const treeView = vscode.window.createTreeView('cloudflareKVExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(treeView);

  // Register refresh command with full refresh to clear caches
  context.subscriptions.push(
    vscode.commands.registerCommand('cloudflare-kv-explorer.refreshTree', async () => {
      await treeProvider.fullRefresh();
    })
  );

  // Register search command with live quick pick
  context.subscriptions.push(
    vscode.commands.registerCommand('cloudflare-kv-explorer.searchKeys', async () => {
      if (DEBUG) outputChannel.appendLine('[Search] Command triggered');
      
      // Create quick pick for live search
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = 'Type to search keys and values...';
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;
      
      let searchTimeout: NodeJS.Timeout | undefined;
      
      // Handle text changes for live search
      quickPick.onDidChangeValue(async (value) => {
        if (DEBUG) outputChannel.appendLine('[Search] Value changed: ' + value);
        
        // Clear previous timeout
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        
        // Debounce the search
        searchTimeout = setTimeout(async () => {
          if (DEBUG) outputChannel.appendLine('[Search] Starting search after debounce for: ' + value);
          quickPick.busy = true;
          
          if (!value) {
            if (DEBUG) outputChannel.appendLine('[Search] Clearing search - empty value');
            quickPick.items = [];
            treeProvider.clearSearch();
            quickPick.busy = false;
            return;
          }
          
          // Perform search and collect results
          const searchResults: vscode.QuickPickItem[] = [];
          if (DEBUG) outputChannel.appendLine('[Search] Getting workers from tree provider...');
          const workers = await treeProvider.getWorkers();
          if (DEBUG) outputChannel.appendLine('[Search] Found workers: ' + workers.length);
          if (workers.length === 0) {
            if (DEBUG) outputChannel.appendLine('[Search] No workers found! Attempting direct discovery...');
            // Try direct discovery as fallback
            const directWorkers = await workerDiscovery.findWorkers();
            if (DEBUG) outputChannel.appendLine('[Search] Direct discovery found: ' + directWorkers.length + ' workers');
          }
          
          for (const worker of workers) {
            if (DEBUG) outputChannel.appendLine(`[Search] Searching worker: ${worker.name} with ${worker.kvNamespaces.length} namespaces`);
            
            for (const namespace of worker.kvNamespaces) {
              try {
                if (DEBUG) outputChannel.appendLine(`[Search] Getting data for namespace: ${namespace.binding} (${namespace.id})`);
                const data = await kvDataProvider.getKVData(worker.path, namespace.id);
                if (DEBUG) outputChannel.appendLine(`[Search] Found ${data.entries.length} entries in namespace`);
                
                for (const entry of data.entries) {
                  // Fuzzy match on key
                  if (DEBUG) outputChannel.appendLine(`[Search] Testing entry: ${entry.key}`);
                  if (DEBUG) outputChannel.appendLine(`[Search] treeProvider exists: ${!!treeProvider}`);
                  if (DEBUG) outputChannel.appendLine(`[Search] treeProvider.fuzzyMatch exists: ${!!treeProvider.fuzzyMatch}`);
                  
                  let keyMatch = false;
                  try {
                    keyMatch = treeProvider.fuzzyMatch(entry.key.toLowerCase(), value.toLowerCase());
                    if (DEBUG) outputChannel.appendLine(`[Search] Fuzzy match result for "${entry.key}": ${keyMatch}`);
                  } catch (err) {
                    if (DEBUG) outputChannel.appendLine('[Search] ERROR calling fuzzyMatch: ' + err);
                  }
                  
                  let valueMatch = false;
                  let valuePreview = '';
                  
                  // Also search in value
                  try {
                    const content = await kvDataProvider.getValue(worker.path, namespace.id, entry.key);
                    if (content) {
                      valueMatch = content.toLowerCase().includes(value.toLowerCase());
                      // Get preview of matching content
                      if (valueMatch) {
                        const index = content.toLowerCase().indexOf(value.toLowerCase());
                        const start = Math.max(0, index - 20);
                        const end = Math.min(content.length, index + value.length + 20);
                        valuePreview = content.substring(start, end).replace(/\\n/g, ' ');
                        if (start > 0) valuePreview = '...' + valuePreview;
                        if (end < content.length) valuePreview = valuePreview + '...';
                      }
                    }
                  } catch (err) {
                    if (DEBUG) outputChannel.appendLine('[Search] Error searching value: ' + err);
                  }
                  
                  if (keyMatch || valueMatch) {
                    if (DEBUG) outputChannel.appendLine(`[Search] Match found for ${entry.key} - keyMatch: ${keyMatch}, valueMatch: ${valueMatch}`);
                    searchResults.push({
                      label: `$(key) ${entry.key}`,
                      description: `${worker.name} / ${namespace.binding}`,
                      detail: valueMatch ? `Value: ${valuePreview}` : undefined,
                      alwaysShow: true,
                      // Store metadata for selection
                      // @ts-ignore - storing custom data
                      _worker: worker,
                      _namespaceId: namespace.id,
                      _key: entry.key
                    });
                  }
                }
              } catch (error) {
                if (DEBUG) outputChannel.appendLine(`[Search] ERROR searching namespace ${namespace.id}: ${error}`);
              }
            }
          }
          
          if (DEBUG) outputChannel.appendLine(`[Search] Total results found: ${searchResults.length}`);
          quickPick.items = searchResults;
          quickPick.busy = false;
          
          // Update tree view with filtered results (don't show notification since quick pick shows results)
          if (value) {
            await treeProvider.performSearch(value, false);
          }
        }, 500); // 500ms debounce
      });
      
      // Handle selection
      quickPick.onDidAccept(() => {
        const selection = quickPick.selectedItems[0];
        if (selection) {
          // @ts-ignore - accessing custom data
          const { _worker, _namespaceId, _key } = selection;
          if (_worker && _namespaceId && _key) {
            vscode.commands.executeCommand(
              'cloudflare-kv-explorer.openKey',
              _worker,
              _namespaceId,
              _key
            );
          }
        }
        quickPick.hide();
      });
      
      // Handle close
      quickPick.onDidHide(() => {
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        quickPick.dispose();
      });
      
      quickPick.show();
    })
  );
  
  // Add clear search command
  context.subscriptions.push(
    vscode.commands.registerCommand('cloudflare-kv-explorer.clearSearch', () => {
      treeProvider.clearSearch();
    })
  );

  return treeProvider;
}