/**
 * Configuration service for loading and validating plugin config.
 * This is a stub file for TDD - implementation will be added in Wave 1.
 */

import type { PluginConfig } from '../types/config';

export const DEFAULT_CONFIG: PluginConfig = {
  version: '1.0',
  nodes: [],
};

export async function loadPluginConfig(): Promise<PluginConfig> {
  // Placeholder - will be implemented in Wave 1
  return DEFAULT_CONFIG;
}

export function validateConfig(config: unknown): PluginConfig {
  // Placeholder - will be implemented in Wave 1
  return DEFAULT_CONFIG;
}
