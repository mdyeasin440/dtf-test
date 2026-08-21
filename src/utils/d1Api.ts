/**
 * Spidey Jersey DTF Pro - Cloudflare D1 Database & R2 Storage Client
 * Synchronizes design presets, order records, and custom uploaded media (PNGs, TTF/OTF fonts)
 * between the React frontend and Cloudflare D1 (env.MY_DB) + Cloudflare R2 (env.MY_BUCKET).
 */

import { DesignPreset, OrderItem } from '../types';
import { getFullPresetDatabase } from '../data/presets';
import { registerCustomFont } from './fontLoader';

const LOCAL_STORAGE_KEY = 'spidey_jersey_presets_v2';
const CUSTOM_USER_PRESETS_KEY = 'spidey_user_custom_presets_v2';

/**
 * Gets specifically the user-created / user-modified custom presets
 */
export function getSavedCustomPresets(): DesignPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_USER_PRESETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed to read custom user presets:', err);
  }
  return [];
}

/**
 * Saves specifically the user-created / user-modified custom presets
 */
export function saveCustomPresets(customPresets: DesignPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_USER_PRESETS_KEY, JSON.stringify(customPresets));
  } catch (err) {
    console.warn('Failed to save custom user presets:', err);
  }
}

/**
 * Loads presets from local storage cache first, combining defaults with all user custom designs.
 */
export function getLocalPresets(): DesignPreset[] {
  const defaultPresets = getFullPresetDatabase();
  const customPresets = getSavedCustomPresets();

  const presetMap = new Map<string, DesignPreset>();
  
  // 1. First add all built-in defaults
  for (const p of defaultPresets) {
    if (p && p.code) {
      presetMap.set(p.code.toUpperCase(), p);
    }
  }

  // 2. Also check general localStorage key
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          if (p && p.code) presetMap.set(p.code.toUpperCase(), p);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read presets from localStorage:', err);
  }

  // 3. Guarantee user-saved custom presets take priority
  for (const p of customPresets) {
    if (p && p.code) {
      presetMap.set(p.code.toUpperCase(), p);
    }
  }

  return Array.from(presetMap.values());
}

/**
 * Saves current presets array to local storage cache and updates custom presets store.
 */
export function saveLocalPresets(presets: DesignPreset[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(presets));

    // Also extract and save user custom presets
    const defaultCodes = new Set(getFullPresetDatabase().map((p) => p.code.toUpperCase()));
    const customOnly = presets.filter((p) => !defaultCodes.has(p.code.toUpperCase()) || (p as any).isCustom);
    saveCustomPresets(customOnly);
  } catch (err) {
    console.warn('Failed to save presets to localStorage:', err);
  }
}

/**
 * Pre-registers any custom fonts present in the loaded presets so canvases render accurately.
 */
export function preloadPresetFonts(presets: DesignPreset[]) {
  for (const p of presets) {
    if (p.customFontDataUrl && p.fontFamily) {
      registerCustomFont(p.fontFamily, p.customFontDataUrl).catch(() => {});
    }
  }
}

/**
 * Fetch all design presets from the Cloudflare D1 database via API.
 * Automatically merges cloud database presets with local custom creations.
 */
export async function fetchPresetsFromD1(): Promise<DesignPreset[]> {
  try {
    const res = await fetch('/api/presets');
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.presets)) {
      const defaultPresets = getFullPresetDatabase();
      const localPresets = getLocalPresets();
      const customPresets = getSavedCustomPresets();
      const cloudPresets: DesignPreset[] = data.presets;

      const presetMap = new Map<string, DesignPreset>();
      // 1. Add default presets
      for (const p of defaultPresets) {
        if (p && p.code) {
          presetMap.set(p.code.toUpperCase(), p);
        }
      }
      // 2. Add local presets
      for (const p of localPresets) {
        if (p && p.code) {
          presetMap.set(p.code.toUpperCase(), p);
        }
      }
      // 3. Overwrite / append cloud presets from D1 database
      for (const p of cloudPresets) {
        if (p && p.code) {
          presetMap.set(p.code.toUpperCase(), p);
        }
      }
      // 4. Ensure local custom presets created in this browser are never dropped
      for (const p of customPresets) {
        if (p && p.code && !presetMap.has(p.code.toUpperCase())) {
          presetMap.set(p.code.toUpperCase(), p);
        }
      }

      const merged = Array.from(presetMap.values());
      saveLocalPresets(merged);
      preloadPresetFonts(merged);

      // Auto-sync any local custom presets to D1 if D1 had fewer
      if (cloudPresets.length === 0 && localPresets.length > defaultPresets.length) {
        savePresetsToD1(merged).catch(() => {});
      }

      return merged;
    }
  } catch (err) {
    console.warn('Cloudflare D1 fetch error, falling back to cached presets:', err);
  }
  const local = getLocalPresets();
  preloadPresetFonts(local);
  return local;
}

/**
 * Converts any local Base64 data URLs in a preset (font, numbers, letters)
 * to permanent Cloudflare R2 URLs before saving to D1 database.
 */
export async function uploadPresetAssetsToR2(preset: DesignPreset): Promise<DesignPreset> {
  const code = (preset.code || 'CUSTOM').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const updated: DesignPreset = { ...preset };

  // 1. Process custom font if it's a base64 data URL
  if (updated.customFontDataUrl && updated.customFontDataUrl.startsWith('data:')) {
    try {
      const mimeType = updated.customFontDataUrl.includes('woff2') ? 'font/woff2' : 'font/ttf';
      const ext = mimeType === 'font/woff2' ? 'woff2' : 'ttf';
      const r2Key = `fonts/${code}_font_${Date.now()}.${ext}`;
      const uploadRes = await uploadAssetToR2(r2Key, updated.customFontDataUrl, mimeType);
      if (uploadRes.success && uploadRes.url) {
        updated.customFontDataUrl = uploadRes.url;
      }
    } catch (e) {
      console.warn('Font R2 upload warning:', e);
    }
  }

  // 2. Process number assets (0-9)
  if (updated.numberAssets && typeof updated.numberAssets === 'object') {
    const newNumberAssets: Record<string, string> = { ...updated.numberAssets };
    for (const [digit, val] of Object.entries(newNumberAssets)) {
      if (typeof val === 'string' && val.startsWith('data:')) {
        try {
          const r2Key = `numbers/${code}_digit_${digit}_${Date.now()}.png`;
          const uploadRes = await uploadAssetToR2(r2Key, val, 'image/png');
          if (uploadRes.success && uploadRes.url) {
            newNumberAssets[digit] = uploadRes.url;
          }
        } catch (e) {
          console.warn(`Number ${digit} R2 upload warning:`, e);
        }
      }
    }
    updated.numberAssets = newNumberAssets;
  }

  // 3. Process letter assets (A-Z)
  if (updated.letterAssets && typeof updated.letterAssets === 'object') {
    const newLetterAssets: Record<string, string> = { ...updated.letterAssets };
    for (const [char, val] of Object.entries(newLetterAssets)) {
      if (typeof val === 'string' && val.startsWith('data:')) {
        try {
          const r2Key = `letters/${code}_char_${char}_${Date.now()}.png`;
          const uploadRes = await uploadAssetToR2(r2Key, val, 'image/png');
          if (uploadRes.success && uploadRes.url) {
            newLetterAssets[char] = uploadRes.url;
          }
        } catch (e) {
          console.warn(`Letter ${char} R2 upload warning:`, e);
        }
      }
    }
    updated.letterAssets = newLetterAssets;
  }

  return updated;
}

/**
 * Saves or updates a single design preset to Cloudflare D1 backend.
 * Automatically uploads all embedded media (PNGs, Fonts) to Cloudflare R2 bucket first!
 */
export async function savePresetToD1(
  preset: DesignPreset
): Promise<{ success: boolean; preset?: DesignPreset; error?: string }> {
  try {
    // 1. Ensure all assets are uploaded to R2 first
    const presetWithR2Assets = await uploadPresetAssetsToR2(preset);

    // 2. Save clean preset to D1 database
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(presetWithR2Assets),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    const data = await res.json();
    const finalPreset = data.preset || presetWithR2Assets;

    // 3. Update local cache with permanent URLs
    const local = getLocalPresets();
    const map = new Map<string, DesignPreset>();
    for (const p of local) {
      if (p && p.code) map.set(p.code.toUpperCase(), p);
    }
    map.set(finalPreset.code.toUpperCase(), finalPreset);
    saveLocalPresets(Array.from(map.values()));

    return { success: true, preset: finalPreset };
  } catch (err: any) {
    console.warn('Cloudflare D1 save failed (local storage backup kept):', err);
    return { success: false, error: err.message || 'Failed to save preset to D1' };
  }
}

/**
 * Saves or updates design presets (plural) to Cloudflare D1 backend.
 */
export async function savePresetsToD1(
  presets: DesignPreset[] | DesignPreset
): Promise<{ success: boolean; error?: string }> {
  try {
    const isArray = Array.isArray(presets);
    const presetsArray = isArray ? presets : [presets];

    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isArray ? presetsArray : presetsArray[0]),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    // Also update local cache
    if (Array.isArray(presets)) {
      saveLocalPresets(presets);
    }

    return { success: true };
  } catch (err: any) {
    console.warn('Cloudflare D1 batch save error:', err);
    return { success: false, error: err.message || 'Failed to save presets to D1' };
  }
}

/**
 * Delete a design preset from Cloudflare D1
 */
export async function deletePresetFromD1(presetId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/presets/${encodeURIComponent(presetId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    return { success: true };
  } catch (err: any) {
    console.warn('Cloudflare D1 delete error:', err);
    return { success: false, error: err.message || 'Failed to delete preset from D1' };
  }
}

/**
 * Bulk save orders list to Cloudflare D1 database
 */
export async function saveOrdersToD1(orders: OrderItem[]): Promise<{ success: boolean; error?: string }> {
  try {
    if (!orders || orders.length === 0) return { success: true };
    const res = await fetch('/api/orders/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orders }),
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    return { success: true };
  } catch (err: any) {
    console.warn('Cloudflare D1 orders save notice:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Upload an asset file (SVG, PNG, TTF font, etc.) directly to the Cloudflare R2 bucket (env.MY_BUCKET).
 * Returns the permanent R2 public streaming URL (/api/assets/file/:key)
 */
export async function uploadAssetToR2(
  key: string,
  dataUrlOrBinary: string | ArrayBuffer,
  contentType?: string
): Promise<{ success: boolean; url?: string; key?: string; error?: string }> {
  try {
    const isDataUrl = typeof dataUrlOrBinary === 'string';
    let res: Response;

    if (isDataUrl) {
      res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, dataUrl: dataUrlOrBinary, contentType }),
      });
    } else {
      res = await fetch(`/api/assets/upload?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
        body: dataUrlOrBinary,
      });
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Upload failed with status ${res.status}`);
    }

    const data = await res.json();
    return { success: true, url: data.url, key: data.key };
  } catch (err: any) {
    console.warn('Cloudflare R2 upload fallback:', err);
    // If running in dev server without live R2 bound yet, we can return the dataUrl as safe fallback
    if (typeof dataUrlOrBinary === 'string') {
      return { success: true, url: dataUrlOrBinary, key };
    }
    return { success: false, error: err.message || 'Failed to upload asset to R2' };
  }
}

/**
 * List all assets currently stored in the R2 bucket
 */
export async function listR2Assets(prefix = ''): Promise<{ success: boolean; assets: Array<{ key: string; size: number; url: string }> }> {
  try {
    const res = await fetch(`/api/assets/list?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    return { success: true, assets: data.assets || [] };
  } catch (err: any) {
    console.warn('Failed to list R2 assets:', err);
    return { success: false, assets: [] };
  }
}
