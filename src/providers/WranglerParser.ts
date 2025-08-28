import * as fs from 'fs/promises';

let _toml: any | null = null;
async function loadToml(): Promise<any | null> {
  if (_toml) return _toml;
  try {
    _toml = await import('toml');
    return _toml;
  } catch (e) {
    console.warn('[cloudflare-kv-explorer] Optional dependency "toml" not found. Using fallback parser (limited).');
    return null; // Will trigger fallback parsing
  }
}

// Extremely small fallback parser that only extracts: name (string), [[kv_namespaces]] array with binding/id, and env.<name>.kv_namespaces
function fallbackParseToml(raw: string): any {
  const lines = raw.split(/\r?\n/);
  const result: any = { };
  let currentArray: string | null = null;
  let currentEnv: string | null = null;
  const kvNamespaces: any[] = [];
  const env: Record<string, any> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section headers
    const arrayMatch = trimmed.match(/^\[\[(.+)\]\]$/);
    if (arrayMatch) {
      currentArray = arrayMatch[1];
      if (currentArray === 'kv_namespaces') {
        kvNamespaces.push({});
      } else if (currentArray.startsWith('env.')) {
        const rest = currentArray.slice(4); // after env.
        const parts = rest.split('.');
        currentEnv = parts[0];
        if (!env[currentEnv]) env[currentEnv] = {};
        if (parts[1] === 'kv_namespaces') {
          if (!env[currentEnv].kv_namespaces) env[currentEnv].kv_namespaces = [];
          env[currentEnv].kv_namespaces.push({});
        }
      }
      continue;
    }

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentArray = null;
      const section = sectionMatch[1];
      if (section.startsWith('env.')) {
        const envName = section.slice(4);
        currentEnv = envName;
        if (!env[currentEnv]) env[currentEnv] = {};
      } else {
        currentEnv = null;
      }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_\.]+)\s*=\s*(.+)$/);
    if (kv) {
      let [, key, value] = kv;
      // Strip quotes
      value = value.replace(/^"|"$/g, '');
      if (key === 'name') {
        result.name = value;
      } else if (currentArray === 'kv_namespaces') {
        const current = kvNamespaces[kvNamespaces.length - 1];
        current[key] = value;
      } else if (currentEnv && key === 'binding' && currentArray?.startsWith('env.') && currentArray.endsWith('kv_namespaces')) {
        // Already handled in array logic
      } else if (currentEnv && currentArray === null) {
        // simple key within env.<name>
        env[currentEnv][key] = value;
      } else if (currentEnv && currentArray?.startsWith('env.') && currentArray.endsWith('kv_namespaces')) {
        const arr = env[currentEnv].kv_namespaces;
        const current = arr[arr.length - 1];
        current[key] = value;
      }
    }
  }

  result.kv_namespaces = kvNamespaces.filter(ns => ns.binding && ns.id);
  // Flatten env kv namespaces into env object
  if (Object.keys(env).length) {
    result.env = {};
    for (const k of Object.keys(env)) {
      result.env[k] = {};
      if (env[k].kv_namespaces) {
        result.env[k].kv_namespaces = env[k].kv_namespaces.filter((ns: any) => ns.binding && ns.id);
      }
    }
  }
  return result;
}

export interface WranglerConfig {
  name?: string;
  kv_namespaces?: Array<{
    binding: string;
    id: string;
  }>;
  vars?: Record<string, any>;
  env?: Record<string, any>;
}

export class WranglerParser {
  async parse(filePath: string): Promise<WranglerConfig> {
    try {
  const content = await fs.readFile(filePath, 'utf-8');
  const tomlLib = await loadToml();
  const parsed = tomlLib ? tomlLib.parse(content) : fallbackParseToml(content);
      
      // Extract KV namespaces
      const kvNamespaces: Array<{ binding: string; id: string }> = [];
      
      if (parsed.kv_namespaces && Array.isArray(parsed.kv_namespaces)) {
        for (const ns of parsed.kv_namespaces) {
          if (ns.binding && ns.id) {
            kvNamespaces.push({
              binding: ns.binding,
              id: ns.id
            });
          }
        }
      }

      // Also check environment-specific KV namespaces (e.g., env.development.kv_namespaces)
      if (parsed.env && typeof parsed.env === 'object') {
        for (const envName of Object.keys(parsed.env)) {
          const env = parsed.env[envName];
          if (env.kv_namespaces && Array.isArray(env.kv_namespaces)) {
            for (const ns of env.kv_namespaces) {
              if (ns.binding && ns.id) {
                // Check if this binding already exists
                const exists = kvNamespaces.some(existing => existing.binding === ns.binding);
                if (!exists) {
                  kvNamespaces.push({
                    binding: `${ns.binding} (${envName})`,
                    id: ns.id
                  });
                }
              }
            }
          }
        }
      }

      return {
        name: parsed.name as string | undefined,
        kv_namespaces: kvNamespaces,
        vars: parsed.vars as Record<string, any> | undefined,
        env: parsed.env as Record<string, any> | undefined
      };
    } catch (error) {
      console.error(`Error parsing wrangler.toml at ${filePath}:`, error);
      throw error;
    }
  }
}