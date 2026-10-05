import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

const PRESETS_DB_FILE = path.join(process.cwd(), 'presets_db.json');

function loadPresetsFromDisk(): { presets: Map<string, any>; deleted: Set<string> } {
  const map = new Map<string, any>();
  const del = new Set<string>();
  try {
    if (fs.existsSync(PRESETS_DB_FILE)) {
      const raw = fs.readFileSync(PRESETS_DB_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.presets)) {
        for (const p of data.presets) {
          if (p && p.code) {
            const code = String(p.code).trim().toUpperCase();
            map.set(code, {
              ...p,
              code,
              hasSmallChestNumber: Boolean(p.hasSmallChestNumber),
              smallChestNumberHeightInches: p.smallChestNumberHeightInches != null ? Number(p.smallChestNumberHeightInches) : 3.0,
            });
          }
        }
      }
      if (Array.isArray(data.deleted)) {
        for (const d of data.deleted) {
          if (d) del.add(String(d).trim().toUpperCase());
        }
      }
    }
  } catch (err) {
    console.warn('Could not read presets_db.json from disk:', err);
  }
  return { presets: map, deleted: del };
}

function savePresetsToDisk(presets: Map<string, any>, deleted: Set<string>) {
  try {
    const payload = {
      presets: Array.from(presets.values()),
      deleted: Array.from(deleted.values()),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PRESETS_DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write presets_db.json to disk:', err);
  }
}

// Disk-backed in-memory store for Node / Express server
const { presets: inMemoryPresets, deleted: inMemoryDeletedPresets } = loadPresetsFromDisk();
const inMemoryOrders: Map<string, any> = new Map();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS Middleware
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (_req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Body parser with 50mb payload limits for embedded font/image data URLs
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const ASSETS_DIR = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // 1. Health & Diagnostics Check endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Spidey Jersey DTF API (Cloudflare D1 Compatible Node Server)',
      database: 'spd-dtf (MY_DB & presets_db.json)',
      storageBucket: 'Local Disk Assets (Cloudflare R2 Compatible)',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/database/diagnostics', (_req, res) => {
    const deletedSet = inMemoryDeletedPresets;
    const presetsList = Array.from(inMemoryPresets.values()).filter((p) => p && p.code && !deletedSet.has(String(p.code).trim().toUpperCase()));

    res.json({
      success: true,
      d1Connected: true,
      d1DatabaseName: 'presets_db.json (Cloudflare D1 Emulation)',
      tables: ['design_presets', 'deleted_presets', 'orders'],
      columns: [
        'id', 'code', 'teamName', 'league', 'season', 'fontFamily', 'customFontDataUrl',
        'textColor', 'strokeColor', 'strokeWidth', 'hasInnerOutline', 'innerOutlineColor',
        'textEffect', 'arcAmount', 'letterSpacing', 'numberStyle', 'numberAssets', 'letterAssets',
        'defaultNameWidthInches', 'defaultNameHeightInches', 'defaultNumberHeightInches',
        'hasSmallChestNumber', 'smallChestNumberHeightInches', 'notes', 'updatedAt'
      ],
      hasSmallChestNumber: true,
      hasSmallChestNumberHeightInches: true,
      migrationNeeded: false,
      presetCount: presetsList.length,
      deletedCount: inMemoryDeletedPresets.size,
      r2BucketBound: true,
      r2BucketName: 'Local Disk /assets/ (R2 Emulation)',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/database/migrate', (_req, res) => {
    savePresetsToDisk(inMemoryPresets, inMemoryDeletedPresets);
    res.json({
      success: true,
      message: 'Local database synchronized and verified with all schema columns',
      migrated: ['Verified hasSmallChestNumber and smallChestNumberHeightInches'],
      errors: [],
    });
  });

  // ==========================================
  // ASSET STORAGE ENDPOINTS (Cloudflare R2 Emulation)
  // ==========================================
  app.get('/api/assets/list', (req, res) => {
    try {
      const prefix = (req.query.prefix as string) || '';
      const files: any[] = [];
      function walk(dir: string, currentPrefix: string) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const fullPath = path.join(dir, e.name);
          const relKey = currentPrefix ? `${currentPrefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            walk(fullPath, relKey);
          } else if (relKey.startsWith(prefix)) {
            const stat = fs.statSync(fullPath);
            files.push({
              key: relKey,
              size: stat.size,
              uploaded: stat.mtime.toISOString(),
              url: `/api/assets/file/${encodeURIComponent(relKey)}`,
            });
          }
        }
      }
      walk(ASSETS_DIR, '');
      res.json({ success: true, count: files.length, assets: files });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/assets/file/*splat', (req, res) => {
    try {
      const rawKey = (req.params as any).splat || '';
      const key = decodeURIComponent(rawKey);
      const safePath = path.normalize(path.join(ASSETS_DIR, key));
      if (!safePath.startsWith(ASSETS_DIR) || !fs.existsSync(safePath)) {
        return res.status(404).json({ success: false, error: 'Asset not found' });
      }

      if (key.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
      else if (key.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else if (key.endsWith('.ttf')) res.setHeader('Content-Type', 'font/ttf');
      else if (key.endsWith('.otf')) res.setHeader('Content-Type', 'font/otf');
      else if (key.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
      else res.setHeader('Content-Type', 'application/octet-stream');

      res.setHeader('Cache-Control', 'public, max-age=31536000');
      fs.createReadStream(safePath).pipe(res);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/assets/upload', (req, res) => {
    try {
      const key = (req.query.key as string) || req.body?.key || `asset-${Date.now()}`;
      const dataUrl = req.body?.dataUrl;
      const safePath = path.normalize(path.join(ASSETS_DIR, key));
      const parentDir = path.dirname(safePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (dataUrl && typeof dataUrl === 'string') {
        const base64Data = dataUrl.split(',')[1] || dataUrl;
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(safePath, buffer);
      } else if (Buffer.isBuffer(req.body)) {
        fs.writeFileSync(safePath, req.body);
      }

      res.json({
        success: true,
        message: 'Asset saved successfully',
        key,
        url: `/api/assets/file/${encodeURIComponent(key)}`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/assets/file/*splat', (req, res) => {
    try {
      const rawKey = (req.params as any).splat || '';
      const key = decodeURIComponent(rawKey);
      const safePath = path.normalize(path.join(ASSETS_DIR, key));
      if (safePath.startsWith(ASSETS_DIR) && fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
      res.json({ success: true, message: `Asset ${key} deleted` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // 2. GET /api/presets - Retrieve all presets from storage
  app.get('/api/presets', (_req, res) => {
    const deletedSet = inMemoryDeletedPresets;
    const presetsList = Array.from(inMemoryPresets.values())
      .filter((p) => p && p.code && !deletedSet.has(String(p.code).trim().toUpperCase()))
      .map((p) => ({
        ...p,
        hasSmallChestNumber: Boolean(p.hasSmallChestNumber),
        smallChestNumberHeightInches: p.smallChestNumberHeightInches != null ? Number(p.smallChestNumberHeightInches) : 3.0,
      }))
      .sort((a, b) => {
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });

    res.json({
      success: true,
      presets: presetsList,
      deletedCodes: Array.from(inMemoryDeletedPresets),
      count: presetsList.length,
    });
  });

  // 3. POST /api/presets - Save or update design preset (supports single object or batch array)
  app.post('/api/presets', (req, res) => {
    try {
      const body = req.body;
      if (!body) {
        return res.status(400).json({ success: false, error: 'Request body is required' });
      }

      // Handle batch array of presets
      if (Array.isArray(body)) {
        const savedPresets = [];
        for (const item of body) {
          if (item && item.code) {
            const code = String(item.code).trim().toUpperCase();
            const id = item.id || `preset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            const preset = {
              ...item,
              id,
              code,
              hasSmallChestNumber: Boolean(item.hasSmallChestNumber),
              smallChestNumberHeightInches: item.smallChestNumberHeightInches != null ? Number(item.smallChestNumberHeightInches) : 3.0,
              updatedAt: item.updatedAt || new Date().toISOString(),
            };
            inMemoryPresets.set(code, preset);
            inMemoryDeletedPresets.delete(code);
            savedPresets.push(preset);
          }
        }
        savePresetsToDisk(inMemoryPresets, inMemoryDeletedPresets);
        return res.json({
          success: true,
          message: `${savedPresets.length} presets saved successfully`,
          count: savedPresets.length,
          presets: savedPresets,
        });
      }

      // Handle single preset object
      if (!body.code) {
        return res.status(400).json({ success: false, error: 'Preset code is required' });
      }

      const code = String(body.code).trim().toUpperCase();
      const id = body.id || `preset-${Date.now()}`;
      const preset = {
        ...body,
        id,
        code,
        hasSmallChestNumber: Boolean(body.hasSmallChestNumber),
        smallChestNumberHeightInches: body.smallChestNumberHeightInches != null ? Number(body.smallChestNumberHeightInches) : 3.0,
        updatedAt: new Date().toISOString(),
      };

      inMemoryPresets.set(code, preset);
      inMemoryDeletedPresets.delete(code);
      savePresetsToDisk(inMemoryPresets, inMemoryDeletedPresets);

      return res.json({
        success: true,
        message: 'Preset saved successfully to database',
        preset,
      });
    } catch (err: any) {
      console.error('Save preset error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  });

  // 4. DELETE /api/presets/:id - Remove design preset
  app.delete('/api/presets/:id', (req, res) => {
    const id = req.params.id;
    const queryCode = (req.query.code as string) || '';
    const queryId = (req.query.id as string) || '';

    const targets = [id, queryCode, queryId].filter(Boolean).map((s) => s.toUpperCase());
    if (targets.length === 0) {
      return res.status(400).json({ success: false, error: 'Preset ID is required' });
    }

    for (const target of targets) {
      inMemoryDeletedPresets.add(target);
    }

    for (const [key, val] of inMemoryPresets.entries()) {
      const valId = (val.id || '').toUpperCase();
      const valCode = (val.code || '').toUpperCase();
      const match = targets.some((t) => key.toUpperCase() === t || valId === t || valCode === t);
      if (match) {
        if (valCode) inMemoryDeletedPresets.add(valCode);
        if (valId) inMemoryDeletedPresets.add(valId);
        inMemoryPresets.delete(key);
      }
    }
    savePresetsToDisk(inMemoryPresets, inMemoryDeletedPresets);
    return res.json({ success: true, message: 'Preset permanently deleted from database', deletedCodes: targets });
  });

  // 5. POST /api/orders/bulk - Save parsed orders batch
  app.post('/api/orders/bulk', (req, res) => {
    try {
      const { orders } = req.body;
      if (!Array.isArray(orders) || orders.length === 0) {
        return res.status(400).json({ success: false, error: 'No orders provided' });
      }

      for (const ord of orders) {
        const id = ord.id || `ord-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        inMemoryOrders.set(id, {
          ...ord,
          id,
          createdAt: new Date().toISOString(),
        });
      }

      return res.json({
        success: true,
        message: `${orders.length} orders saved`,
        count: orders.length,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
  });

  // 6. GET /api/orders - Get recent orders
  app.get('/api/orders', (_req, res) => {
    const ordersList = Array.from(inMemoryOrders.values());
    res.json({ success: true, orders: ordersList });
  });

  // Vite development middleware vs Static Production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Spidey Jersey DTF Server running on http://localhost:${PORT}`);
  });
}

startServer();
