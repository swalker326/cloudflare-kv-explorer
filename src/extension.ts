import * as vscode from 'vscode';
import { WorkerDiscovery } from './providers/WorkerDiscovery';
import { KVDataProvider } from './providers/KVDataProvider';
import { KVDocumentProvider, createKVUri } from './providers/KVDocumentProvider';
import { registerKVTreeView } from './providers/KVTreeProvider';

// Create a global output channel for logging
export const outputChannel = vscode.window.createOutputChannel('Cloudflare KV Explorer');

// Debug flag - set to true to enable verbose logging
export const DEBUG = false;

export function activate(context: vscode.ExtensionContext) {
  outputChannel.appendLine('Cloudflare KV Explorer is now active!');
  if (DEBUG) {
    outputChannel.show(true); // Show the output channel on activation when debugging
  }
  console.log('Cloudflare KV Explorer is now active!');

  // Initialize providers
  const workerDiscovery = new WorkerDiscovery();
  const kvDataProvider = new KVDataProvider();
  const documentProvider = new KVDocumentProvider(kvDataProvider);

  // Register the virtual document provider for cloudflare-kv:// scheme
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('cloudflare-kv', documentProvider)
  );

  // Register tree view in explorer
  registerKVTreeView(context, workerDiscovery, kvDataProvider);

  // Add command to show output logs
  context.subscriptions.push(
    vscode.commands.registerCommand('cloudflare-kv-explorer.showLogs', () => {
      outputChannel.show();
    })
  );

  // Register command to open KV entry in editor
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cloudflare-kv-explorer.openKey',
      async (worker: any, namespaceId: string, key: string) => {
        const uri = createKVUri(worker.path, namespaceId, key);
        
        // Open the document
        const doc = await vscode.workspace.openTextDocument(uri);
        
        // Show the document in editor
        const editor = await vscode.window.showTextDocument(doc, {
          preview: false,
          preserveFocus: false
        });

        // Try to set the language mode based on content
        let languageId = 'plaintext';
        
        // Check if it's JSON
        try {
          JSON.parse(doc.getText());
          languageId = 'json';
        } catch {
          // Check for other patterns
          const text = doc.getText();
          if (text.trim().startsWith('<') && text.trim().endsWith('>')) {
            languageId = 'html';
          } else if (text.includes('function') || text.includes('const') || text.includes('let')) {
            languageId = 'javascript';
          } else if (text.includes('body') || text.includes('color:') || text.includes('margin:')) {
            languageId = 'css';
          }
        }

        // Set the language mode
        vscode.languages.setTextDocumentLanguage(doc, languageId);

        // If it's JSON, format it
        if (languageId === 'json') {
          await vscode.commands.executeCommand('editor.action.formatDocument');
        }
      }
    )
  );

  // Register command to copy value
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cloudflare-kv-explorer.copyValue',
      async (worker: any, namespaceId: string, key: string) => {
        const value = await kvDataProvider.getValue(worker.path, namespaceId, key);
        if (value) {
          await vscode.env.clipboard.writeText(value);
          vscode.window.showInformationMessage(`Copied ${key} to clipboard`);
        }
      }
    )
  );

  // Register command to refresh a specific entry
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cloudflare-kv-explorer.refreshEntry',
      (uri: vscode.Uri) => {
        documentProvider.refresh(uri);
        vscode.window.showInformationMessage('KV entry refreshed');
      }
    )
  );

  // Register command to compare two entries
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cloudflare-kv-explorer.compareEntries',
      async () => {
        // Get currently open KV documents
        const kvDocs = vscode.workspace.textDocuments.filter(doc => 
          doc.uri.scheme === 'cloudflare-kv'
        );

        if (kvDocs.length < 2) {
          vscode.window.showWarningMessage('Open at least 2 KV entries to compare');
          return;
        }

        // Show quick pick to select documents
        const items = kvDocs.map(doc => ({
          label: doc.uri.path.split('/').pop() || 'Unknown',
          uri: doc.uri
        }));

        const first = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select first document to compare'
        });

        if (!first) return;

        const second = await vscode.window.showQuickPick(
          items.filter(item => item.uri !== first.uri),
          { placeHolder: 'Select second document to compare' }
        );

        if (!second) return;

        // Open diff editor
        await vscode.commands.executeCommand(
          'vscode.diff',
          first.uri,
          second.uri,
          `Compare: ${first.label} ↔ ${second.label}`
        );
      }
    )
  );

  // Auto-detect workers on startup
  if (vscode.workspace.workspaceFolders) {
    vscode.workspace.findFiles('**/wrangler.toml', '**/node_modules/**', 10).then(files => {
      if (files.length > 0) {
        // Show the tree view
        vscode.commands.executeCommand('cloudflareKVExplorer.focus');
        
        vscode.window.showInformationMessage(
          `Found ${files.length} Cloudflare Worker${files.length > 1 ? 's' : ''} with KV namespaces`
        );
      }
    });
  }

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      kvDataProvider.dispose();
    }
  });
}

export function deactivate() {
  // Clean up resources
}