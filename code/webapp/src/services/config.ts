// Configuration service for plugin node display settings

import { sendBridgeMessage, hasBridgeTransport } from './upload';
import type { PluginConfig, ConfigNode } from '../types/config';

// Re-export types for convenience
export type { PluginConfig, ConfigNode } from '../types/config';

export const DEFAULT_CONFIG: PluginConfig = {
  version: '1.0',
  nodes: [], // Empty = show all nodes
};

/**
 * Validate and sanitize a config object
 * - Ensures config is an object with nodes array
 * - Filters nodes to only entries with valid class_type (string)
 * - Filters inputs arrays to only contain strings
 */
export function validateConfig(config: unknown): PluginConfig {
  if (!config || typeof config !== 'object') {
    console.warn('[Config] Invalid config: not an object, using DEFAULT_CONFIG');
    return DEFAULT_CONFIG;
  }

  const cfg = config as Record<string, unknown>;

  // Validate nodes array
  if (!Array.isArray(cfg.nodes)) {
    console.warn('[Config] Invalid config: nodes is not an array, using DEFAULT_CONFIG');
    return DEFAULT_CONFIG;
  }

  // Filter and sanitize node entries
  const validNodes: ConfigNode[] = [];
  for (const node of cfg.nodes) {
    if (!node || typeof node !== 'object') continue;

    const nodeObj = node as Record<string, unknown>;

    // Must have a valid class_type string
    if (typeof nodeObj.class_type !== 'string' || !nodeObj.class_type.trim()) {
      continue;
    }

    const entry: ConfigNode = {
      class_type: nodeObj.class_type.trim(),
    };

    // If inputs is specified, validate it's an array of strings
    if (Array.isArray(nodeObj.inputs)) {
      const validInputs = nodeObj.inputs.filter(
        (input): input is string => typeof input === 'string' && input.trim() !== ''
      );
      if (validInputs.length > 0) {
        entry.inputs = validInputs;
      }
    }

    validNodes.push(entry);
  }

  const version = typeof cfg.version === 'string' ? cfg.version : '1.0';

  return {
    version,
    nodes: validNodes,
  };
}

/**
 * Load plugin configuration from Bridge
 * - Checks if Bridge transport is available
 * - Calls fs.readPluginConfig to read node-config.json
 * - Returns validated config or DEFAULT_CONFIG on any error
 */
export async function loadPluginConfig(): Promise<PluginConfig> {
  console.log('[Config] loadPluginConfig called, hasBridgeTransport:', hasBridgeTransport());
  
  // Check if Bridge transport is available
  if (!hasBridgeTransport()) {
    console.log('[Config] No Bridge transport available, using DEFAULT_CONFIG (show all nodes)');
    return DEFAULT_CONFIG;
  }

  try {
    console.log('[Config] Sending fs.readPluginConfig request...');
    const result = await sendBridgeMessage('fs.readPluginConfig', {
      filename: 'node-config.json',
    }) as { exists: boolean; data?: unknown };
    
    console.log('[Config] Bridge response:', JSON.stringify(result, null, 2));

    if (!result.exists || !result.data) {
      console.log('[Config] Config file not found or empty, using DEFAULT_CONFIG (show all nodes)');
      return DEFAULT_CONFIG;
    }

    // Bridge already returns parsed JSON object
    // Validate and return
    const validated = validateConfig(result.data);
    console.log(`[Config] Config loaded successfully:`);
    console.log(`[Config]   - Version: ${validated.version}`);
    console.log(`[Config]   - Nodes count: ${validated.nodes.length}`);
    if (validated.nodes.length > 0) {
      validated.nodes.forEach((node, i) => {
        console.log(`[Config]   - Node ${i + 1}: ${node.class_type}, inputs: ${node.inputs?.join(', ') || 'all'}`);
      });
    } else {
      console.log('[Config]   - Empty nodes array = show ALL nodes');
    }
    return validated;
  } catch (error) {
    console.error('[Config] Failed to load config:', error);
    return DEFAULT_CONFIG;
  }
}
