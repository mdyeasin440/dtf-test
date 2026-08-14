-- Cloudflare D1 Database Schema for Spidey Jersey DTF Pro (spd-dtf)
-- Binding: env.MY_DB

-- Table: design_presets
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
  numberStyle TEXT, -- JSON payload for NumberStyle
  numberAssets TEXT, -- JSON payload for Record<digit, urlOrDataUrl>
  letterAssets TEXT, -- JSON payload for Record<letter, urlOrDataUrl>
  defaultNameWidthInches REAL DEFAULT 12.0,
  defaultNameHeightInches REAL DEFAULT 2.2,
  defaultNumberHeightInches REAL DEFAULT 9.5,
  notes TEXT,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presets_code ON design_presets (code);
CREATE INDEX IF NOT EXISTS idx_presets_league ON design_presets (league);

-- Table: orders
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

CREATE INDEX IF NOT EXISTS idx_orders_designCode ON orders (designCode);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
