// Config logic — pure functions for node filtering and input gating.
//
// Extracted from configStore.ts. The store used to lock these inside Zustand
// callbacks (where the config had to be read via `get()`). Pulling them out
// makes the logic testable in isolation and reusable from any caller that
// has a `PluginConfig` in hand.

import type { PluginConfig } from '../types/config';

/**
 * Decide whether a ComfyUI node class should be shown in the UI, based on
 * the current config's node list.
 *
 * Returns `true` (show) when:
 *   - config is null
 *   - config has no nodes (empty filter = show everything)
 *   - any node.class_type matches the given classType
 *
 * Returns `false` (hide) when:
 *   - config has nodes but none match the given classType
 */
export function shouldDisplayNode(
  config: PluginConfig | null,
  classType: string
): boolean {
  if (!config || !config.nodes || config.nodes.length === 0) {
    return true;
  }
  return config.nodes.some((node) => node.class_type === classType);
}

/**
 * Get the list of input names allowed for a given node class, or null
 * (meaning "all inputs allowed") when no gating is in effect.
 *
 * Returns `null` when:
 *   - config is null
 *   - config has no nodes
 *   - no node with matching class_type exists
 *   - the matched node has no `inputs` field defined
 */
export function getAllowedInputs(
  config: PluginConfig | null,
  classType: string
): string[] | null {
  if (!config || !config.nodes || config.nodes.length === 0) {
    return null;
  }
  const node = config.nodes.find((n) => n.class_type === classType);
  if (!node) {
    return null;
  }
  return node.inputs ?? null;
}
