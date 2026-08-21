import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

// In-memory backing for Node / Express development server
const inMemoryPresets: Map<string, any> = new Map();
const inMemoryDeletedPresets: Set<string> = new Set();
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

  // 1. Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Spidey Jersey DTF API (Cloudflare D1 Compatible)',
      database: 'spd-dtf (MY_DB)',
      timestamp: new Date().toISOString(),
    });
  });

  // 2. GET /api/presets - Retrieve all presets from storage
  app.get('/api/presets', (_req, res) => {
    const presetsList = Array.from(inMemoryPresets.values()).sort((a, b) => {
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
            const id = item.id || `preset-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            const code = (item.code || '').trim().toUpperCase();
            const preset = {
              ...item,
              id,
              code,
              updatedAt: new Date().toISOString(),
            };
            inMemoryPresets.set(id, preset);
            inMemoryDeletedPresets.delete(code);
            savedPresets.push(preset);
          }
        }
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

      const id = body.id || `preset-${Date.now()}`;
      const code = (body.code || '').trim().toUpperCase();
      const preset = {
        ...body,
        id,
        code,
        updatedAt: new Date().toISOString(),
      };

      inMemoryPresets.set(id, preset);
      inMemoryDeletedPresets.delete(code);

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
