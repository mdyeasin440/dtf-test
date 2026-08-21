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

// Auto-initialize SQLite tables in D1 if they do not exist
async function ensureD1Tables(env: Env) {
  if (!env || !env.MY_DB) {
    throw new Error('Cloudflare D1 binding "MY_DB" is not configured or available in environment.');
  }
  try {
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
        notes TEXT,
        updatedAt TEXT NOT NULL
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

    // Auto-migrate schema in case table was created with an earlier version
    const alterCols = [
      'customFontDataUrl TEXT',
      'numberAssets TEXT',
      'letterAssets TEXT',
      'numberStyle TEXT',
      'hasInnerOutline INTEGER DEFAULT 0',
      'innerOutlineColor TEXT',
      'textEffect TEXT DEFAULT "none"',
      'arcAmount INTEGER DEFAULT 0',
      'letterSpacing REAL DEFAULT 3',
      'defaultNameWidthInches REAL DEFAULT 12.0',
      'defaultNameHeightInches REAL DEFAULT 2.2',
      'defaultNumberHeightInches REAL DEFAULT 9.5',
      'notes TEXT',
    ];
    for (const col of alterCols) {
      try {
        await env.MY_DB.exec(`ALTER TABLE design_presets ADD COLUMN ${col};`);
      } catch (_) {
        // column already exists
      }
    }
  } catch (e: any) {
    console.warn('ensureD1Tables warning:', e);
  }
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
  const notes = body.notes || '';
  const updatedAt = new Date().toISOString();

  return env.MY_DB.prepare(
    `INSERT INTO design_presets (
      id, code, teamName, league, season, fontFamily, customFontDataUrl,
      textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
      textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
      defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches, notes, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      notes=excluded.notes,
      updatedAt=excluded.updatedAt`
  ).bind(
    id, code, teamName, league, season, fontFamily, customFontDataUrl,
    textColor, strokeColor, strokeWidth, hasInnerOutline, innerOutlineColor,
    textEffect, arcAmount, letterSpacing, numberStyle, numberAssets, letterAssets,
    defaultNameWidthInches, defaultNameHeightInches, defaultNumberHeightInches, notes, updatedAt
  );
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
        // Health Check
        if (path === '/api/health' && method === 'GET') {
          return jsonResponse({
            status: 'ok',
            service: 'Spidey Jersey DTF API (Cloudflare D1 & R2)',
            database: 'spd-dtf (MY_DB)',
            storageBucket: env.MY_BUCKET ? 'spidery-assets (MY_BUCKET)' : 'unbound',
            timestamp: new Date().toISOString(),
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
            }, 500);
          }
          await ensureD1Tables(env);
          const { results } = await env.MY_DB.prepare(
            `SELECT * FROM design_presets ORDER BY updatedAt DESC`
          ).all<any>();

          const formatted = (results || []).map((row) => ({
            ...row,
            hasInnerOutline: Boolean(row.hasInnerOutline),
            numberStyle: safeJsonParse(row.numberStyle),
            numberAssets: safeJsonParse(row.numberAssets),
            letterAssets: safeJsonParse(row.letterAssets),
          }));

          return jsonResponse({ success: true, presets: formatted, count: formatted.length });
        }

        // POST /api/presets - Save single or array of presets
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
            const statements = body.map((item) => buildUpsertStatement(env, item));
            await env.MY_DB.batch(statements);
            return jsonResponse({
              success: true,
              message: `${body.length} design presets saved to Cloudflare D1`,
              count: body.length,
            });
          }

          if (!body.code) {
            return jsonResponse({ success: false, error: 'Preset code is required' }, 400);
          }

          const stmt = buildUpsertStatement(env, body);
          await stmt.run();

          return jsonResponse({
            success: true,
            message: 'Design preset saved to Cloudflare D1',
            preset: {
              ...body,
              id: body.id || `preset-${Date.now()}`,
              code: (body.code || '').trim().toUpperCase(),
              updatedAt: new Date().toISOString(),
            },
          });
        }

        // DELETE /api/presets/:id
        if (path.startsWith('/api/presets/') && method === 'DELETE') {
          const id = path.split('/')[3];
          if (!id) {
            return jsonResponse({ success: false, error: 'Preset ID is required' }, 400);
          }

          await env.MY_DB.prepare(`DELETE FROM design_presets WHERE id = ?`).bind(id).run();
          return jsonResponse({ success: true, message: 'Preset deleted from Cloudflare D1' });
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
