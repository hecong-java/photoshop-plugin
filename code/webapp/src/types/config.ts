/**
 * Type definitions for plugin configuration.
 */

export interface ConfigNode {
  class_type: string;
  inputs?: string[];
}

export interface PluginConfig {
  version: string;
  nodes: ConfigNode[];
}
