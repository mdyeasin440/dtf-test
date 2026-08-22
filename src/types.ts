/**
 * SPIDEY JERSEY - DTF Print Automation Types
 */

export interface NumberStyle {
  fontFamily: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number; // in pixels at standard scale
  hasInnerStroke?: boolean;
  innerStrokeColor?: string;
  badgeIcon?: 'lion' | 'star' | 'crest' | 'swoosh' | 'shield' | 'none';
  customAssetUrl?: string; // High-res PNG or SVG URL
}

export interface DesignPreset {
  id: string;
  code: string; // e.g., "SJ-Y5EMT", "BARCELONA 2016-17"
  teamName: string;
  league: string; // e.g., "La Liga", "Premier League", "Serie A", "Retro", "Custom"
  season: string; // e.g., "2023-24", "2016-17", "Classic"
  fontFamily: string; // e.g., "Oswald", "Bebas Neue", "Anton", "Jersey 15", or custom
  customFontDataUrl?: string; // Data URL for uploaded .ttf / .woff file
  textColor: string; // Hex color
  strokeColor: string; // Hex color
  strokeWidth: number; // Border thickness
  hasInnerOutline?: boolean;
  innerOutlineColor?: string;
  textEffect: 'none' | 'arc' | 'italic' | 'drop-shadow' | 'stencil';
  arcAmount?: number; // degree of curve
  letterSpacing?: number; // spacing between letters
  numberStyle: NumberStyle;
  numberAssets?: Record<string, string>; // Map of digit '0'..'9' -> Data URL string (PNG/SVG image)
  letterAssets?: Record<string, string>; // Map of uppercase letter 'A'..'Z' -> Data URL string (PNG/SVG image)
  defaultNameWidthInches: number; // e.g. 12"
  defaultNameHeightInches: number; // e.g. 2.2"
  defaultNumberHeightInches: number; // e.g. 9.5"
  notes?: string;
  updatedAt?: string;
  isCustom?: boolean;
}

export type GarmentSize = 'Adult' | 'Youth' | 'Infant' | 'Custom';

export interface OrderItem {
  id: string;
  rawLine: string;
  designCode: string;
  matchedPreset?: DesignPreset;
  customerName: string;
  number: string;
  garmentSize: GarmentSize;
  quantity: number;
  nameWidthInches: number;
  nameHeightInches: number;
  numberHeightInches: number;
  numberWidthInches: number; // Calculated or user defined
  status: 'matched' | 'unmatched_code' | 'error';
  errorMessage?: string;
}

export type CanvasItemType = 'name' | 'number' | 'combo';

export interface CanvasItem {
  id: string;
  orderId: string;
  itemType: CanvasItemType;
  customerName: string;
  number: string;
  designCode: string;
  preset: DesignPreset;
  x: number; // Position X in inches from top-left
  y: number; // Position Y in inches from top-left
  width: number; // Width in inches
  height: number; // Height in inches
  rotation: number; // 0 or 90 degrees
  zIndex: number;
  locked?: boolean;
  customColorOverride?: string;
  customStrokeOverride?: string;
  garmentSize: GarmentSize;
  hasCollision?: boolean;
}

export type NestingStrategy = 'compact' | 'grouped_by_order' | 'rotated_max_density';
export type PackingMode = 'row_by_row_structured' | 'separate_names_and_numbers' | 'paired_order_rows' | 'combo_blocks' | 'smart_auto';
export type DigitNestingMode = 'intact' | 'smart_unbundle' | 'split_all';

export interface DigitSplitLocation {
  digit: string;
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shelfRowIndex: number;
}

export interface DigitSplitLogEntry {
  id: string;
  orderId: string;
  customerName: string;
  originalNumber: string;
  reason: 'gap_optimization' | 'shelf_end_fill' | 'smart_pocket_fill' | 'manual_unbundle';
  digits: DigitSplitLocation[];
  spaceSavedInches: number;
  timestamp: string;
}

export interface LayoutSettings {
  rollWidthInches: number; // Default 39"
  marginInches: number; // Default 0.35" cut spacing
  nestingStrategy: NestingStrategy;
  packingMode: PackingMode;
  showCutLines: boolean;
  cutLineColor: string;
  dpi: number; // Default 300 for export
  zoomLevel: number; // Screen zoom factor (e.g. 1.0)
  autoRotateLongNames: boolean;
  groupDistanceInches: number; // Extra gap between orders when grouped
  splitDigitsForNesting?: boolean; // Toggle for split nesting
  digitNestingMode?: DigitNestingMode; // 'intact' | 'smart_unbundle' | 'split_all'
}

export interface RollMetrics {
  totalRollLengthInches: number;
  totalRollLengthMeters: number;
  usedAreaSquareInches: number;
  totalCapacitySquareInches: number;
  wastePercentage: number;
  efficiencyPercentage: number;
  totalNamesCount: number;
  totalNumbersCount: number;
  totalOrdersCount: number;
  estimatedPrintTimeMinutes: number;
  estimatedFilmCostUSD: number;
  totalUnbundledDigitsCount?: number;
  totalSpaceSavedInches?: number;
}
