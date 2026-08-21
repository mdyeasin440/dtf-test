import { DesignPreset } from '../types';

/**
 * Default presets database: Empty by default so only user-uploaded
 * and custom-created presets exist in the system.
 */
export const INITIAL_PRESETS: DesignPreset[] = [];

export function getFullPresetDatabase(): DesignPreset[] {
  return [];
}
