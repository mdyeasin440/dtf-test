/**
 * Cloudflare Worker Handler for Spidey Jersey DTF Pro (spd-dtf)
 * Integrates:
 *  - Static Assets Delivery via env.ASSETS (Vite React dist/)
 *  - Cloudflare D1 database (Binding: env.MY_DB)
 *  - Cloudflare R2 bucket (Binding: env.MY_BUCKET) for asset uploads & storage
 */

export interface Env {
  MY_DB: D1Database;
  MY_BUCKET?: R2Bucket;
  ASSETS?: Fetcher;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: any;
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

// Utility: JSON Response with standard CORS
function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Safe JSON parser helper to prevent crashing GET /api/presets on malformed JSON
function safeJsonParse(val: any) {
  if (!val) return undefined;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Column definitions for auto-migration
const DESIGN_PRESET_COLUMNS: { name: string; type: string }[] = [
  { name: 'customFontDataUrl', type: 'TEXT' },
  { name: 'numberAssets', type: 'TEXT' },
  { name: 'letterAssets', type: 'TEXT' },
  { name: 'numberStyle', type: 'TEXT' },
  { name: 'hasInnerOutline', type: 'INTEGER DEFAULT 0' },
  { name: 'innerOutlineColor', type: 'TEXT' },
  { name: 'textEffect', type: "TEXT DEFAULT 'none'" },
  { name: 'arcAmount', type: 'INTEGER DEFAULT 0' },
  { name: 'letterSpacing', type: 'REAL DEFAULT 3' },
  { name: 'defaultNameWidthInches', type: 'REAL DEFAULT 12.0' },
  { name: 'defaultNameHeightInches', type: 'REAL DEFAULT 2.2' },
  { name: 'defaultNumberHeightInches', type: 'REAL DEFAULT 9.5' },
  { name: 'hasSmallChestNumber', type: 'INTEGER DEFAULT 0' },
  { name: 'smallChestNumberHeightInches', type: 'REAL DEFAULT 3.0' },
  { name: 'notes', type: 'TEXT' },
];

// Auto-initialize SQLite tables and migrate columns in D1 if they do not exist
async function ensureD1Tables(env: Env): Promise<{ success: boolean; migrated: string[]; errors: string[] }> {
  const migrated: string[] = [];
  const errors: string[] = [];

  if (!env || !env.MY_DB) {
    throw new Error('Cloudflare D1 binding "MY_DB" is not configured or available in environment.');
  }

  try {
    // 1. Core tables
    await env.MY_DB.exec(`
      CREATE TABLE IF NOT EXISTS design_presets (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        teamName TEXT NOT NULL,
        league TEXT,
        season TEXT,
        fontFamily TEXT NOT NULL DEFAULT 'Oswald',
        customFontDataUrl TEXT,
        textColor TEXT NOT NULL DEFAULT '#FFFFFF',
        strokeColor TEXT NOT NULL DEFAULT '#000000',
        strokeWidth REAL NOT NULL DEFAULT 4,
        hasInnerOutline INTEGER DEFAULT 0,
        innerOutlineColor TEXT,
        textEffect TEXT NOT NULL DEFAULT 'none',
        arcAmount INTEGER DEFAULT 0,
        letterSpacing REAL DEFAULT 3,
        numberStyle TEXT,
        numberAssets TEXT,
        letterAssets TEXT,
        defaultNameWidthInches REAL DEFAULT 12.0,
        defaultNameHeightInches REAL DEFAULT 2.2,
        defaultNumberHeightInches REAL DEFAULT 9.5,
        hasSmallChestNumber INTEGER DEFAULT 0,
        smallChestNumberHeightInches REAL DEFAULT 3.0,
        notes TEXT,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deleted_presets (
        code TEXT PRIMARY KEY,
        deletedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        orderNumber TEXT,
        customerName TEXT NOT NULL,
        jerseyName TEXT,
        jerseyNumber TEXT,
        garmentSize TEXT DEFAULT 'Adult',
        designCode TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        nameWidthInches REAL DEFAULT 12.0,
        nameHeightInches REAL DEFAULT 2.2,
        numberHeightInches REAL DEFAULT 9.5,
        numberWidthInches REAL,
        status TEXT DEFAULT 'pending',
        createdAt TEXT NOT NULL
      );
    `);
    migrated.push('Core tables verified');
  } catch (err: any) {
    errors.push(`Table creation error: ${err.message}`);
  }

  // 2. Ensure unique index on code to make ON CONFLICT(code) 100% reliable
  try {
    await env.MY_DB.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_presets_code_unique ON design_presets (code);`);
    migrated.push('Unique index idx_presets_code_unique verified');
  } catch (err: any) {
    // Already exists or duplicate codes present
    errors.push(`Index notice: ${err.message}`);
  }

  // 3. Inspect existing columns via PRAGMA table_info and add missing ones
  try {
    const colInfo = await env.MY_DB.prepare(`PRAGMA table_info(design_presets)`).all<any>();
    const existingCols = new Set((colInfo.results || []).map((c: any) => c.name));

    for (const col of DESIGN_PRESET_COLUMNS) {
      if (!existingCols.has(col.name)) {
        try {
          await env.MY_DB.exec(`ALTER TABLE design_presets ADD COLUMN ${col.name} ${col.type};`);
          migrated.push(`Added missing column ${col.name}`);
        } catch (alterErr: any) {
          errors.push(`Column ${col.name} notice: ${alterErr.message}`);
        }
      }
    }
  } catch (pragmaErr: any) {
    errors.push(`PRAGMA inspect error: ${pragmaErr.message}`);
  }

  return { success: errors.length === 0, migrated, errors };
}

function buildUpsertStatement(env: Env, body: any) {
  const id = body.id || `preset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const code = (body.code || '').trim().toUpperCase();
  const teamName = body.teamName || 'Custom Team';
  const league = body.league || 'Custom';
  const season = body.season || '2024-25';
  const fontFamily = body.fontFamily || 'Oswald';
  const customFontDataUrl = body.customFontDataUrl || null;
  const textColor = body.textColor || '#FFFFFF';
  const strokeColor = body.strokeColor || '#000000';
  const strokeWidth = Number(body.strokeWidth ?? 4);
  const hasInnerOutline = body.hasInnerOutline ? 1 : 0;
  const innerOutlineColor = body.innerOutlineColor || null;
  const textEffect = body.textEffect || 'none';
  const arcAmount = Number(body.arcAmount ?? 0);
  const letterSpacing = Number(body.letterSpacing ?? 3);
  const numberStyle = body.numberStyle ? JSON.stringify(body.numberStyle) : null;
  const numberAssets = body.numberAssets ? JSON.stringify(body.numberAssets) : null;
  const letterAssets = body.letterAssets ? JSON.stringify(body.letterAssets) : null;
  const defaultNameWidthInches = Number(body.defaultNameWidthInches ?? 12.0);
  const defaultNameHeightInches = Number(body.defaultNameHeightInches ?? 2.2);
  const defaultNumberHeightInches = Number(body.defaultNumberHeightInches ?? 9.5);
  const hasSmallChestNumber = body.hasSmallChestNumber ? 1 : 0;
  const smallChestNumberHeightInches = Number(body.smallChestNumberHeightInches ?? 3.0);
  const notes = body.notes || '';
  const updatedAt = new Date().toISOString();

  return env.MY_DB.prepare(
    `INSERT INTO design_presets (
      id, code, teamName, league, season, fontFamily, customFontDataUrl,
      textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
      textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
      defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
      hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      teamName=excluded.teamName,
      league=excluded.league,
      season=excluded.season,
      fontFamily=excluded.fontFamily,
      customFontDataUrl=excluded.customFontDataUrl,
      textColor=excluded.textColor,
      strokeColor=excluded.strokeColor,
      strokeWidth=excluded.strokeWidth,
      hasInnerOutline=excluded.hasInnerOutline,
      innerOutlineColor=excluded.innerOutlineColor,
      textEffect=excluded.textEffect,
      arcAmount=excluded.arcAmount,
      letterSpacing=excluded.letterSpacing,
      numberStyle=excluded.numberStyle,
      numberAssets=excluded.numberAssets,
      letterAssets=excluded.letterAssets,
      defaultNameWidthInches=excluded.defaultNameWidthInches,
      defaultNameHeightInches=excluded.defaultNameHeightInches,
      defaultNumberHeightInches=excluded.defaultNumberHeightInches,
      hasSmallChestNumber=excluded.hasSmallChestNumber,
      smallChestNumberHeightInches=excluded.smallChestNumberHeightInches,
      notes=excluded.notes,
      updatedAt=excluded.updatedAt`
  ).bind(
    id, code, teamName, league, season, fontFamily, customFontDataUrl,
    textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
    textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
    defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
    hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt
  );
}

// Multi-tier foolproof saver: attempts fast ON CONFLICT upsert,
// falls back to SELECT + UPDATE/INSERT, and finally falls back to dynamic column matching.
async function saveOrUpdatePreset(env: Env, body: any): Promise<any> {
  const id = body.id || `preset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const code = (body.code || '').trim().toUpperCase();
  const teamName = body.teamName || 'Custom Team';
  const league = body.league || 'Custom';
  const season = body.season || '2024-25';
  const fontFamily = body.fontFamily || 'Oswald';
  const customFontDataUrl = body.customFontDataUrl || null;
  const textColor = body.textColor || '#FFFFFF';
  const strokeColor = body.strokeColor || '#000000';
  const strokeWidth = Number(body.strokeWidth ?? 4);
  const hasInnerOutline = body.hasInnerOutline ? 1 : 0;
  const innerOutlineColor = body.innerOutlineColor || null;
  const textEffect = body.textEffect || 'none';
  const arcAmount = Number(body.arcAmount ?? 0);
  const letterSpacing = Number(body.letterSpacing ?? 3);
  const numberStyle = body.numberStyle ? JSON.stringify(body.numberStyle) : null;
  const numberAssets = body.numberAssets ? JSON.stringify(body.numberAssets) : null;
  const letterAssets = body.letterAssets ? JSON.stringify(body.letterAssets) : null;
  const defaultNameWidthInches = Number(body.defaultNameWidthInches ?? 12.0);
  const defaultNameHeightInches = Number(body.defaultNameHeightInches ?? 2.2);
  const defaultNumberHeightInches = Number(body.defaultNumberHeightInches ?? 9.5);
  const hasSmallChestNumber = body.hasSmallChestNumber ? 1 : 0;
  const smallChestNumberHeightInches = Number(body.smallChestNumberHeightInches ?? 3.0);
  const notes = body.notes || '';
  const updatedAt = new Date().toISOString();

  // Tier 1: Try standard ON CONFLICT
  try {
    const stmt = buildUpsertStatement(env, body);
    await stmt.run();
    return;
  } catch (tier1Err: any) {
    console.warn('Tier 1 upsert failed, executing Tier 2 check-and-update/insert:', tier1Err.message);
  }

  // Tier 2: Check if row exists by code
  const existing = await env.MY_DB.prepare(
    `SELECT id FROM design_presets WHERE UPPER(code) = ?`
  ).bind(code).first<any>();

  if (existing) {
    try {
      await env.MY_DB.prepare(
        `UPDATE design_presets SET
          teamName=?, league=?, season=?, fontFamily=?, customFontDataUrl=?,
          textColor=?, strokeColor=?, strokeWidth=?, hasInnerOutline=?, innerOutlineColor=?,
          textEffect=?, arcAmount=?, letterSpacing=?, numberStyle=?, numberAssets=?, letterAssets=?,
          defaultNameWidthInches=?, defaultNameHeightInches=?, defaultNumberHeightInches=?,
          hasSmallChestNumber=?, smallChestNumberHeightInches=?, notes=?, updatedAt=?
        WHERE UPPER(code) = ?`
      ).bind(
        teamName, league, season, fontFamily, customFontDataUrl,
        textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
        textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
        defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
        hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt, code
      ).run();
      return;
    } catch (tier2Err: any) {
      console.warn('Tier 2 update failed, trying Tier 3 dynamic column matching:', tier2Err.message);
    }
  } else {
    try {
      await env.MY_DB.prepare(
        `INSERT INTO design_presets (
          id, code, teamName, league, season, fontFamily, customFontDataUrl,
          textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
          textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
          defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
          hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, code, teamName, league, season, fontFamily, customFontDataUrl,
        textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
        textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
        defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
        hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt
      ).run();
      return;
    } catch (tier2InsertErr: any) {
      console.warn('Tier 2 insert failed, trying Tier 3 dynamic column matching:', tier2InsertErr.message);
    }
  }

  // Tier 3: Query PRAGMA table_info to only touch columns that truly exist in SQLite table
  const colInfo = await env.MY_DB.prepare(`PRAGMA table_info(design_presets)`).all<any>();
  const validCols = new Set((colInfo.results || []).map((c: any) => c.name));

  const allValues: Record<string, any> = {
    id, code, teamName, league, season, fontFamily, customFontDataUrl,
    textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
    textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
    defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches,
    hasSmallChestNumber, smallChestNumberHeightInches, notes, updatedAt
  };

  if (existing) {
    const updateCols = Object.keys(allValues).filter((k) => k !== 'id' && k !== 'code' && validCols.has(k));
    const setClause = updateCols.map((k) => `${k}=?`).join(', ');
    const vals = updateCols.map((k) => allValues[k]);
    vals.push(code);
    await env.MY_DB.prepare(
      `UPDATE design_presets SET ${setClause} WHERE UPPER(code) = ?`
    ).bind(...vals).run();
  } else {
    const insertCols = Object.keys(allValues).filter((k) => validCols.has(k));
    const placeholders = insertCols.map(() => '?').join(', ');
    const vals = insertCols.map((k) => allValues[k]);
    await env.MY_DB.prepare(
      `INSERT INTO design_presets (${insertCols.join(', ')}) VALUES (${placeholders})`
    ).bind(...vals).run();
  }
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS Preflight for all API calls
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 1. If this is an API call, route through Worker backend logic
    if (path.startsWith('/api/')) {
      try {
        // Health & Diagnostics Check
        if (path === '/api/health' && method === 'GET') {
          return jsonResponse({
            status: 'ok',
            service: 'Spidey Jersey DTF API (Cloudflare D1 & R2)',
            database: 'spd-dtf (MY_DB)',
            storageBucket: env.MY_BUCKET ? 'spidery-assets (MY_BUCKET)' : 'unbound',
            timestamp: new Date().toISOString(),
          });
        }

        // GET /api/database/diagnostics - Comprehensive Cloudflare D1 & R2 Health & Schema Inspector
        if (path === '/api/database/diagnostics' && method === 'GET') {
          let d1Connected = false;
          let d1Error: string | undefined;
          let tables: string[] = [];
          let columns: string[] = [];
          let presetCount = 0;
          let deletedCount = 0;

          if (env.MY_DB) {
            try {
              // 1. Check tables
              const tableRes = await env.MY_DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all<any>();
              tables = (tableRes.results || []).map((r) => r.name);
              d1Connected = true;

              // 2. Check columns in design_presets
              if (tables.includes('design_presets')) {
                const colRes = await env.MY_DB.prepare(`PRAGMA table_info(design_presets)`).all<any>();
                columns = (colRes.results || []).map((c) => c.name);

                const countRes = await env.MY_DB.prepare(`SELECT COUNT(*) as cnt FROM design_presets`).first<any>();
                presetCount = countRes ? Number(countRes.cnt) : 0;
              }

              if (tables.includes('deleted_presets')) {
                const delRes = await env.MY_DB.prepare(`SELECT COUNT(*) as cnt FROM deleted_presets`).first<any>();
                deletedCount = delRes ? Number(delRes.cnt) : 0;
              }
            } catch (e: any) {
              d1Connected = false;
              d1Error = e.message;
            }
          }

          const hasSmallChestNumber = columns.includes('hasSmallChestNumber');
          const hasSmallChestNumberHeightInches = columns.includes('smallChestNumberHeightInches');
          const r2BucketBound = Boolean(env.MY_BUCKET);

          return jsonResponse({
            success: true,
            d1Connected,
            d1DatabaseName: 'spideyjerseydtf (env.MY_DB)',
            d1Error,
            tables,
            columns,
            hasSmallChestNumber,
            hasSmallChestNumberHeightInches,
            migrationNeeded: d1Connected && (!hasSmallChestNumber || !hasSmallChestNumberHeightInches),
            presetCount,
            deletedCount,
            r2BucketBound,
            r2BucketName: r2BucketBound ? 'spidery-assets' : 'unbound (env.MY_BUCKET missing)',
            timestamp: new Date().toISOString(),
          });
        }

        // POST /api/database/migrate - One-click schema repair and auto-migration
        if (path === '/api/database/migrate' && method === 'POST') {
          if (!env.MY_DB) {
            return jsonResponse({ success: false, error: 'Cloudflare D1 database binding MY_DB is not configured' }, 500);
          }
          const migrationResult = await ensureD1Tables(env);
          return jsonResponse({
            success: migrationResult.success,
            message: 'Database schema migration executed on Cloudflare D1',
            migrated: migrationResult.migrated,
            errors: migrationResult.errors,
          });
        }


        // ==========================================
        // CLOUDFLARE R2 ASSET STORAGE ENDPOINTS
        // ==========================================

        // GET /api/assets/list - List assets in R2 bucket
        if (path === '/api/assets/list' && method === 'GET') {
          if (!env.MY_BUCKET) {
            return jsonResponse({ success: false, error: 'R2 bucket MY_BUCKET is not bound' }, 500);
          }
          const prefix = url.searchParams.get('prefix') || '';
          const limit = Number(url.searchParams.get('limit') || 100);
          const listed = await env.MY_BUCKET.list({ prefix, limit });

          const items = listed.objects.map((obj) => ({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded,
            url: `/api/assets/file/${encodeURIComponent(obj.key)}`,
          }));

          return jsonResponse({ success: true, count: items.length, assets: items });
        }

        // GET /api/assets/file/:key - Stream file directly from R2 bucket
        if (path.startsWith('/api/assets/file/') && method === 'GET') {
          if (!env.MY_BUCKET) {
            return jsonResponse({ success: false, error: 'R2 bucket MY_BUCKET is not bound' }, 500);
          }
          const key = decodeURIComponent(path.replace('/api/assets/file/', ''));
          if (!key) {
            return jsonResponse({ success: false, error: 'File key is required' }, 400);
          }

          const object = await env.MY_BUCKET.get(key);
          if (!object) {
            return jsonResponse({ success: false, error: 'Asset not found in R2' }, 404);
          }

          const headers = new Headers();
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('etag', object.httpEtag);
          headers.set('Cache-Control', 'public, max-age=31536000');
          if (object.httpMetadata?.contentType) {
            headers.set('Content-Type', object.httpMetadata.contentType);
          } else if (key.endsWith('.svg')) {
            headers.set('Content-Type', 'image/svg+xml');
          } else if (key.endsWith('.png')) {
            headers.set('Content-Type', 'image/png');
          } else if (key.endsWith('.ttf')) {
            headers.set('Content-Type', 'font/ttf');
          } else if (key.endsWith('.otf')) {
            headers.set('Content-Type', 'font/otf');
          } else if (key.endsWith('.woff2')) {
            headers.set('Content-Type', 'font/woff2');
          } else {
            headers.set('Content-Type', 'application/octet-stream');
          }

          return new Response(object.body, { headers });
        }

        // POST /api/assets/upload - Upload file to R2 bucket
        if (path === '/api/assets/upload' && method === 'POST') {
          if (!env.MY_BUCKET) {
            return jsonResponse({ success: false, error: 'R2 bucket MY_BUCKET is not bound' }, 500);
          }

          const contentType = request.headers.get('content-type') || '';
          let key = url.searchParams.get('key') || '';
          let fileData: ArrayBuffer | null = null;
          let mimeType = 'application/octet-stream';

          if (contentType.includes('application/json')) {
            const body: any = await request.json();
            key = key || body.key || `asset-${Date.now()}-${body.filename || 'file'}`;
            mimeType = body.contentType || 'application/octet-stream';

            if (body.dataUrl) {
              const base64Data = body.dataUrl.split(',')[1] || body.dataUrl;
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              fileData = bytes.buffer;
            } else if (body.content) {
              fileData = new TextEncoder().encode(body.content).buffer;
            }
          } else {
            key = key || `asset-${Date.now()}`;
            fileData = await request.arrayBuffer();
            mimeType = contentType;
          }

          if (!fileData) {
            return jsonResponse({ success: false, error: 'No file data received' }, 400);
          }

          await env.MY_BUCKET.put(key, fileData, {
            httpMetadata: { contentType: mimeType },
          });

          return jsonResponse({
            success: true,
            message: 'Asset uploaded to Cloudflare R2',
            key,
            url: `/api/assets/file/${encodeURIComponent(key)}`,
          });
        }

        // DELETE /api/assets/file/:key - Delete file from R2
        if (path.startsWith('/api/assets/file/') && method === 'DELETE') {
          if (!env.MY_BUCKET) {
            return jsonResponse({ success: false, error: 'R2 bucket MY_BUCKET is not bound' }, 500);
          }
          const key = decodeURIComponent(path.replace('/api/assets/file/', ''));
          if (!key) {
            return jsonResponse({ success: false, error: 'File key is required' }, 400);
          }

          await env.MY_BUCKET.delete(key);
          return jsonResponse({ success: true, message: `Asset ${key} deleted from R2` });
        }

        // ==========================================
        // CLOUDFLARE D1 DATABASE ENDPOINTS
        // ==========================================

        // GET /api/presets - Fetch all presets from D1
        if (path === '/api/presets' && method === 'GET') {
          if (!env.MY_DB) {
            return jsonResponse({
              success: false,
              error: 'Cloudflare D1 database binding (MY_DB) is not connected in Cloudflare Settings.',
              presets: [],
              deletedCodes: [],
            }, 500);
          }
          await ensureD1Tables(env);
          const { results } = await env.MY_DB.prepare(
            `SELECT * FROM design_presets ORDER BY updatedAt DESC`
          ).all<any>();

          let deletedCodes: string[] = [];
          try {
            const delRes = await env.MY_DB.prepare(`SELECT code FROM deleted_presets`).all<any>();
            if (delRes && delRes.results) {
              deletedCodes = delRes.results.map((r: any) => String(r.code || '').toUpperCase()).filter(Boolean);
            }
          } catch (_) {}

          const formatted = (results || []).map((row) => ({
            ...row,
            hasInnerOutline: Boolean(row.hasInnerOutline),
            hasSmallChestNumber: Boolean(row.hasSmallChestNumber),
            smallChestNumberHeightInches: row.smallChestNumberHeightInches != null ? Number(row.smallChestNumberHeightInches) : 3.0,
            numberStyle: safeJsonParse(row.numberStyle),
            numberAssets: safeJsonParse(row.numberAssets),
            letterAssets: safeJsonParse(row.letterAssets),
          }));

          return jsonResponse({ success: true, presets: formatted, deletedCodes, count: formatted.length });
        }

        // POST /api/presets - Save single or array of presets with resilient schema tolerance
        if (path === '/api/presets' && method === 'POST') {
          if (!env.MY_DB) {
            return jsonResponse({
              success: false,
              error: 'Cloudflare D1 database binding (MY_DB) is not connected in Cloudflare Settings.',
            }, 500);
          }
          await ensureD1Tables(env);
          const body: any = await request.json();
          if (!body) {
            return jsonResponse({ success: false, error: 'Request body is required' }, 400);
          }

          if (Array.isArray(body)) {
            if (body.length === 0) {
              return jsonResponse({ success: true, count: 0, presets: [] });
            }

            for (const item of body) {
              if (item && item.code) {
                await saveOrUpdatePreset(env, item);
                // Unmark from deleted_presets
                try {
                  await env.MY_DB.prepare(`DELETE FROM deleted_presets WHERE UPPER(code) = ?`).bind(String(item.code).toUpperCase()).run();
                } catch (_) {}
              }
            }

            return jsonResponse({
              success: true,
              message: `${body.length} design presets saved to Cloudflare D1`,
              count: body.length,
            });
          }

          if (!body.code) {
            return jsonResponse({ success: false, error: 'Preset code is required' }, 400);
          }

          await saveOrUpdatePreset(env, body);

          // Unmark from deleted_presets
          try {
            await env.MY_DB.prepare(`DELETE FROM deleted_presets WHERE UPPER(code) = ?`).bind(String(body.code).toUpperCase()).run();
          } catch (_) {}

          return jsonResponse({
            success: true,
            message: 'Design preset saved permanently to Cloudflare D1',
            preset: {
              ...body,
              id: body.id || `preset-${Date.now()}`,
              code: (body.code || '').trim().toUpperCase(),
              hasSmallChestNumber: Boolean(body.hasSmallChestNumber),
              smallChestNumberHeightInches: body.smallChestNumberHeightInches != null ? Number(body.smallChestNumberHeightInches) : 3.0,
              updatedAt: new Date().toISOString(),
            },
          });
        }

        // DELETE /api/presets/:id (or /api/presets/:code)
        if (path.startsWith('/api/presets/') && method === 'DELETE') {
          if (!env.MY_DB) {
            return jsonResponse({ success: false, error: 'Cloudflare D1 database binding (MY_DB) is not connected' }, 500);
          }
          await ensureD1Tables(env);

          const rawParam = path.replace('/api/presets/', '').split('?')[0];
          const param = decodeURIComponent(rawParam || '').trim();
          const queryCode = url.searchParams.get('code') ? decodeURIComponent(url.searchParams.get('code')!).trim() : '';
          const queryId = url.searchParams.get('id') ? decodeURIComponent(url.searchParams.get('id')!).trim() : '';

          const searchTerms = Array.from(new Set([param, queryCode, queryId].filter(Boolean)));

          if (searchTerms.length === 0) {
            return jsonResponse({ success: false, error: 'Preset ID or Code is required' }, 400);
          }

          // Delete all matching entries by id or code (case-insensitive)
          for (const term of searchTerms) {
            await env.MY_DB.prepare(
              `DELETE FROM design_presets WHERE id = ? OR code = ? OR UPPER(code) = ? OR UPPER(id) = ?`
            ).bind(term, term, term.toUpperCase(), term.toUpperCase()).run();

            // Record tombstone in deleted_presets table for cross-device sync
            const upper = term.toUpperCase();
            try {
              await env.MY_DB.prepare(
                `INSERT INTO deleted_presets (code, deletedAt) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET deletedAt=excluded.deletedAt`
              ).bind(upper, new Date().toISOString()).run();
            } catch (_) {}
          }

          return jsonResponse({
            success: true,
            message: 'Preset permanently deleted from Cloudflare D1 and tombstone recorded',
            deletedIdentifiers: searchTerms,
          });
        }

        // POST /api/orders/bulk - Save parsed orders
        if (path === '/api/orders/bulk' && method === 'POST') {
          const { orders } = (await request.json()) as { orders: any[] };
          if (!Array.isArray(orders) || orders.length === 0) {
            return jsonResponse({ success: false, error: 'No orders provided' }, 400);
          }

          const statements = orders.map((ord) => {
            const id = ord.id || `ord-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            const orderNumber = ord.orderNumber || '';
            const customerName = ord.customerName || '';
            const jerseyName = ord.jerseyName || customerName;
            const jerseyNumber = ord.number || ord.jerseyNumber || '';
            const garmentSize = ord.garmentSize || 'Adult';
            const designCode = ord.designCode || '';
            const quantity = Number(ord.quantity || 1);
            const nameWidthInches = Number(ord.nameWidthInches || 12);
            const nameHeightInches = Number(ord.nameHeightInches || 2.2);
            const numberHeightInches = Number(ord.numberHeightInches || 9.5);
            const numberWidthInches = Number(ord.numberWidthInches || 6);
            const status = ord.status || 'pending';
            const createdAt = new Date().toISOString();

            return env.MY_DB.prepare(
              `INSERT OR REPLACE INTO orders (
                id, orderNumber, customerName, jerseyName, jerseyNumber, garmentSize,
                designCode, quantity, nameWidthInches, nameHeightInches, numberHeightInches,
                numberWidthInches, status, createdAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              id, orderNumber, customerName, jerseyName, jerseyNumber, garmentSize,
              designCode, quantity, nameWidthInches, nameHeightInches, numberHeightInches,
              numberWidthInches, status, createdAt
            );
          });

          await env.MY_DB.batch(statements);
          return jsonResponse({ success: true, message: `${orders.length} orders saved to Cloudflare D1` });
        }

        return jsonResponse({ error: 'API endpoint not found' }, 404);
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message || 'Internal Server Error' }, 500);
      }
    }

    // 2. Serve static frontend assets via env.ASSETS binding
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
