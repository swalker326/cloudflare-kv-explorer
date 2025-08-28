import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { WranglerParser } from './WranglerParser';
import { outputChannel, DEBUG } from '../extension';

export interface WorkerProject {
  name: string;
  path: string;
  wranglerPath: string;
  kvNamespaces: KVNamespace[];
}

export interface KVNamespace {
  binding: string;
  id: string;
}

export class WorkerDiscovery {
  private wranglerParser: WranglerParser;

  constructor() {
    this.wranglerParser = new WranglerParser();
  }

  async findWorkers(): Promise<WorkerProject[]> {
    if (DEBUG) outputChannel.appendLine('[WorkerDiscovery] findWorkers() called');
    
    if (!vscode.workspace.workspaceFolders) {
      if (DEBUG) outputChannel.appendLine('[WorkerDiscovery] No workspace folders found');
      return [];
    }
    
    if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Workspace folders: ${vscode.workspace.workspaceFolders.map(f => f.uri.fsPath).join(', ')}`);

    const workers: WorkerProject[] = [];
    
    // Find all wrangler.toml files
    if (DEBUG) outputChannel.appendLine('[WorkerDiscovery] Searching for wrangler.toml files...');
    const wranglerFiles = await vscode.workspace.findFiles(
      '**/wrangler.toml',
      '**/node_modules/**',
      100
    );

    if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Found ${wranglerFiles.length} wrangler.toml files`);

    for (const file of wranglerFiles) {
      try {
        if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Processing: ${file.fsPath}`);
        const workerPath = path.dirname(file.fsPath);
        const config = await this.wranglerParser.parse(file.fsPath);
        
        // Check if .wrangler directory exists
        const wranglerDir = path.join(workerPath, '.wrangler');
        if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Checking for .wrangler at: ${wranglerDir}`);
        
        if (fs.existsSync(wranglerDir)) {
          if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] ✅ Found .wrangler directory`);
          if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] KV namespaces: ${JSON.stringify(config.kv_namespaces)}`);
          
          workers.push({
            name: config.name || path.basename(workerPath),
            path: workerPath,
            wranglerPath: file.fsPath,
            kvNamespaces: config.kv_namespaces || []
          });
        } else {
          if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] ❌ No .wrangler directory found at ${wranglerDir}`);
        }
      } catch (error) {
        if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Error parsing ${file.fsPath}: ${error}`);
      }
    }

    if (DEBUG) outputChannel.appendLine(`[WorkerDiscovery] Total workers found: ${workers.length}`);
    return workers;
  }

  async watchWorkers(callback: (workers: WorkerProject[]) => void): Promise<vscode.Disposable> {
    const watcher = vscode.workspace.createFileSystemWatcher('**/wrangler.toml');
    
    const update = async () => {
      const workers = await this.findWorkers();
      callback(workers);
    };

    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(update);

    return watcher;
  }
}