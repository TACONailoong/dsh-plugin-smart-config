/**
 * Remote Synchronizer for dynamic rules fetching and caching.
 * Modeled after ZCodeBuiltinRemoteSynchronizer.
 */

import fs from 'fs';
import path from 'path';
import type { BuiltinRulesData } from './types.js';

export interface SyncOptions {
  endpointOrigin?: string;
  cacheDir?: string;
  refreshIntervalMs?: number;
  appVersion?: string;
  platform?: string;
}

export class RemoteSynchronizer {
  private endpointOrigin?: string;
  private cacheDir: string;
  private refreshIntervalMs: number;
  private appVersion: string;
  private platform: string;
  private timer: NodeJS.Timeout | null = null;
  private onUpdateCallback?: (rules: BuiltinRulesData) => void;

  constructor(options: SyncOptions = {}) {
    this.endpointOrigin = options.endpointOrigin;
    this.cacheDir = options.cacheDir || path.resolve(process.cwd(), '.cache', 'model-rules');
    this.refreshIntervalMs = options.refreshIntervalMs || 3600 * 1000;
    this.appVersion = options.appVersion || '1.0.0';
    this.platform = options.platform || process.platform;
  }

  public onUpdate(cb: (rules: BuiltinRulesData) => void): void {
    this.onUpdateCallback = cb;
  }

  public startPeriodicSync(): void {
    if (this.timer) return;
    this.sync().catch(() => {});
    this.timer = setInterval(() => {
      this.sync().catch(() => {});
    }, this.refreshIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async sync(): Promise<BuiltinRulesData | null> {
    if (!this.endpointOrigin) return null;

    try {
      const url = new URL('/api/v1/client/configs', this.endpointOrigin);
      url.searchParams.set('app_version', this.appVersion);
      url.searchParams.set('platform', this.platform);

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': `DSH-SmartConfig/${this.appVersion}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as any;
      const cdnUrl = body?.data?.configs?.builtin_provider_config_json;
      if (!cdnUrl) return null;

      const cdnRes = await fetch(cdnUrl);
      if (!cdnRes.ok) throw new Error(`CDN HTTP ${cdnRes.status}`);

      const rulesData = (await cdnRes.json()) as BuiltinRulesData;
      if (rulesData && rulesData.schemaVersion && rulesData.config) {
        this.saveCache(rulesData);
        if (this.onUpdateCallback) {
          this.onUpdateCallback(rulesData);
        }
        return rulesData;
      }
    } catch {
      // Remote sync is non-blocking; fallback to local cache/bundled rules
    }
    return null;
  }

  public loadCached(): BuiltinRulesData | null {
    const cacheFile = path.join(this.cacheDir, 'zcode-builtin.json');
    if (fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return null;
  }

  private saveCache(data: BuiltinRulesData): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const cacheFile = path.join(this.cacheDir, 'zcode-builtin.json');
      fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // ignore write errors
    }
  }
}
