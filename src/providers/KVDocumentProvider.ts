import * as vscode from 'vscode';
import { KVDataProvider } from './KVDataProvider';

export class KVDocumentProvider implements vscode.TextDocumentContentProvider {
  private kvDataProvider: KVDataProvider;
  private contentCache = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(kvDataProvider: KVDataProvider) {
    this.kvDataProvider = kvDataProvider;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // URI format: cloudflare-kv://worker-path/namespace-id/key
    // Authority contains the worker path, path contains namespace and key
    const workerPath = decodeURIComponent(uri.authority);
    const pathParts = uri.path.split('/').filter(p => p);
    
    if (pathParts.length < 2) {
      return '// Invalid KV URI';
    }

    const namespaceId = pathParts[0];
    const key = decodeURIComponent(pathParts.slice(1).join('/'));

    const cacheKey = uri.toString();
    
    // Check cache first
    if (this.contentCache.has(cacheKey)) {
      return this.contentCache.get(cacheKey)!;
    }

    try {
      const content = await this.kvDataProvider.getValue(workerPath, namespaceId, key);
      
      if (!content) {
        return '// KV entry not found';
      }

      // Try to format as JSON if possible
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        this.contentCache.set(cacheKey, formatted);
        return formatted;
      } catch {
        // Not JSON, return as-is
        this.contentCache.set(cacheKey, content);
        return content;
      }
    } catch (error) {
      console.error('Error fetching KV content:', error);
      return `// Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  refresh(uri: vscode.Uri) {
    this.contentCache.delete(uri.toString());
    this._onDidChange.fire(uri);
  }

  dispose() {
    this.contentCache.clear();
    this._onDidChange.dispose();
  }
}

export function createKVUri(workerPath: string, namespaceId: string, key: string): vscode.Uri {
  // Create URI with proper encoding - use authority component for better structure
  return vscode.Uri.from({
    scheme: 'cloudflare-kv',
    authority: encodeURIComponent(workerPath),
    path: `/${namespaceId}/${encodeURIComponent(key)}`
  });
}