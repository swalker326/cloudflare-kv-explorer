import * as path from 'path';
import * as fs from 'fs/promises';
import * as sqlite3 from '@vscode/sqlite3';

export interface KVEntry {
  key: string;
  blobId: string;
  expiration?: number;
  metadata?: string;
}

export interface KVData {
  namespace: string;
  entries: KVEntry[];
}

export class KVDataProvider {
  private dbCache: Map<string, sqlite3.Database> = new Map();
  private namespaceDbMapping: Map<string, string> = new Map(); // namespace ID -> database path

  async getKVData(workerPath: string, namespaceId: string): Promise<KVData> {
    console.log(`[KVDataProvider] Getting KV data for worker: ${workerPath}, namespace: ${namespaceId}`);
    const kvPath = path.join(workerPath, '.wrangler', 'state', 'v3', 'kv');
    console.log(`[KVDataProvider] KV path: ${kvPath}`);
    
    const dbPath = await this.findDatabaseForNamespace(kvPath, namespaceId);
    
    if (!dbPath) {
      console.warn(`[KVDataProvider] No database found for namespace: ${namespaceId}`);
      return { namespace: namespaceId, entries: [] };
    }

    console.log(`[KVDataProvider] Found database: ${dbPath}`);
    const entries = await this.queryEntries(dbPath);
    console.log(`[KVDataProvider] Found ${entries.length} entries in namespace ${namespaceId}`);

    return {
      namespace: namespaceId,
      entries: entries
    };
  }

  async getValue(workerPath: string, namespaceId: string, key: string): Promise<string | null> {
    console.log(`[KVDataProvider] Getting value for key: ${key} in namespace: ${namespaceId}`);
    const kvPath = path.join(workerPath, '.wrangler', 'state', 'v3', 'kv');
    const dbPath = await this.findDatabaseForNamespace(kvPath, namespaceId);
    
    if (!dbPath) {
      console.warn(`[KVDataProvider] No database found for getValue`);
      return null;
    }

    const blobId = await this.getBlobId(dbPath, key);
    
    if (!blobId) {
      console.warn(`[KVDataProvider] No blob ID found for key: ${key}`);
      return null;
    }

    console.log(`[KVDataProvider] Found blob ID: ${blobId} for key: ${key}`);
    // Read the blob file
    const blobPath = path.join(kvPath, namespaceId, 'blobs', blobId);
    console.log(`[KVDataProvider] Reading blob from: ${blobPath}`);
    
    try {
      const content = await fs.readFile(blobPath, 'utf-8');
      console.log(`[KVDataProvider] ✅ Successfully read ${content.length} characters from blob`);
      return content;
    } catch (error) {
      console.error(`[KVDataProvider] ❌ Error reading blob file ${blobPath}:`, error);
      return null;
    }
  }

  private async findDatabaseForNamespace(kvPath: string, namespaceId: string): Promise<string | null> {
    // Check cache first
    if (this.namespaceDbMapping.has(namespaceId)) {
      const cachedPath = this.namespaceDbMapping.get(namespaceId)!;
      // Verify cached database still exists
      try {
        await fs.access(cachedPath);
        console.log(`[KVDataProvider] Using cached database for namespace ${namespaceId}: ${cachedPath}`);
        return cachedPath;
      } catch {
        console.log(`[KVDataProvider] Cached database no longer exists, clearing cache for ${namespaceId}`);
        this.namespaceDbMapping.delete(namespaceId);
        // Also close and remove from db cache if present
        if (this.dbCache.has(cachedPath)) {
          try {
            this.dbCache.get(cachedPath)!.close();
          } catch {}
          this.dbCache.delete(cachedPath);
        }
      }
    }

    const miniflareDir = path.join(kvPath, 'miniflare-KVNamespaceObject');
    console.log(`[KVDataProvider] Looking for database in: ${miniflareDir}`);
    
    // First check if the miniflare directory exists
    try {
      await fs.access(miniflareDir);
      console.log(`[KVDataProvider] Miniflare directory exists`);
    } catch (error) {
      console.error(`[KVDataProvider] ❌ Miniflare directory doesn't exist: ${miniflareDir}`);
      
      // List what's actually in the KV directory
      try {
        const kvContents = await fs.readdir(kvPath);
        console.log(`[KVDataProvider] Contents of KV directory (${kvPath}):`, kvContents);
      } catch (e) {
        console.error(`[KVDataProvider] ❌ Can't read KV directory: ${kvPath}`);
      }
      
      return null;
    }

    // Check if the namespace directory exists
    const nsPath = path.join(kvPath, namespaceId);
    const nsBlobsPath = path.join(nsPath, 'blobs');
    
    try {
      await fs.access(nsBlobsPath);
      console.log(`[KVDataProvider] Namespace blobs directory exists: ${nsBlobsPath}`);
    } catch {
      console.error(`[KVDataProvider] ❌ Namespace blobs directory doesn't exist: ${nsBlobsPath}`);
      return null;
    }
    
    try {
      const files = await fs.readdir(miniflareDir);
      const sqliteFiles = files.filter(f => f.endsWith('.sqlite') && !f.endsWith('-wal') && !f.endsWith('-shm'));
      console.log(`[KVDataProvider] Found ${sqliteFiles.length} SQLite files to check`);
      
      // Try each database to find which one matches this namespace
      for (const file of sqliteFiles) {
        const dbPath = path.join(miniflareDir, file);
        console.log(`[KVDataProvider] Checking database: ${file}`);
        
        try {
          // Get the count of entries
          const count = await this.getEntryCount(dbPath);
          if (count === 0) {
            console.log(`[KVDataProvider] Database has no entries, skipping`);
            continue;
          }
          
          console.log(`[KVDataProvider] Database has ${count} entries, checking blob compatibility`);
          
          // Get up to 3 sample blob IDs to test
          const sampleBlobs = await this.getSampleBlobIds(dbPath, 3);
          let matchCount = 0;
          let checkedCount = 0;
          
          for (const blobId of sampleBlobs) {
            checkedCount++;
            const blobPath = path.join(nsBlobsPath, blobId);
            
            try {
              await fs.access(blobPath);
              matchCount++;
              console.log(`[KVDataProvider] ✅ Blob ${blobId.substring(0, 8)}... exists in namespace`);
            } catch {
              console.log(`[KVDataProvider] ❌ Blob ${blobId.substring(0, 8)}... NOT found in namespace`);
              // If any blob doesn't exist, this is not the right database
              break;
            }
          }
          
          // If all checked blobs exist, this is our database
          if (matchCount === checkedCount && matchCount > 0) {
            console.log(`[KVDataProvider] ✅ Found matching database for namespace ${namespaceId}: ${file}`);
            // Cache the mapping
            this.namespaceDbMapping.set(namespaceId, dbPath);
            return dbPath;
          }
        } catch (error) {
          console.error(`[KVDataProvider] Error checking database ${dbPath}:`, error);
        }
      }
    } catch (error) {
      console.error(`[KVDataProvider] Error finding database for namespace ${namespaceId}:`, error);
    }
    
    console.log(`[KVDataProvider] ❌ No matching database found for namespace ${namespaceId}`);
    return null;
  }

  private getDatabase(dbPath: string): sqlite3.Database {
    if (this.dbCache.has(dbPath)) {
      return this.dbCache.get(dbPath)!;
    }
    
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    this.dbCache.set(dbPath, db);
    return db;
  }

  private queryEntries(dbPath: string): Promise<KVEntry[]> {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase(dbPath);
      db.all('SELECT key, blob_id as blobId, expiration, metadata FROM _mf_entries ORDER BY key', 
        (err: Error | null, rows: KVEntry[]) => {
          if (err) {
            console.error(`[KVDataProvider] Error querying entries:`, err);
            resolve([]);
          } else {
            resolve(rows);
          }
        });
    });
  }

  private getBlobId(dbPath: string, key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase(dbPath);
      db.get('SELECT blob_id as blobId FROM _mf_entries WHERE key = ?', [key],
        (err: Error | null, row: { blobId: string } | undefined) => {
          if (err) {
            console.error(`[KVDataProvider] Error getting blob ID for key ${key}:`, err);
            resolve(null);
          } else {
            resolve(row?.blobId || null);
          }
        });
    });
  }

  private getEntryCount(dbPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase(dbPath);
      db.get('SELECT COUNT(*) as count FROM _mf_entries',
        (err: Error | null, row: { count: number } | undefined) => {
          if (err) {
            console.error(`[KVDataProvider] Error getting entry count:`, err);
            resolve(0);
          } else {
            resolve(row?.count || 0);
          }
        });
    });
  }

  private getSampleBlobIds(dbPath: string, limit: number = 3): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const db = this.getDatabase(dbPath);
      db.all(`SELECT blob_id as blobId FROM _mf_entries LIMIT ${limit}`,
        (err: Error | null, rows: { blobId: string }[]) => {
          if (err) {
            console.error(`[KVDataProvider] Error getting sample blob IDs:`, err);
            resolve([]);
          } else {
            resolve(rows.map(row => row.blobId));
          }
        });
    });
  }

  dispose() {
    // Close all database connections
    for (const db of this.dbCache.values()) {
      try {
        db.close();
      } catch (error) {
        console.error('[KVDataProvider] Error closing database:', error);
      }
    }
    this.dbCache.clear();
    this.namespaceDbMapping.clear();
  }
}