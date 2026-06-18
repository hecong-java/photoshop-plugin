// History Parser — pure functions for converting ComfyUI history entries
// and cluster task history items into the unified HistoryItem shape.
//
// Extracted from historyStore.ts so the parsing logic can be tested
// in isolation and reused by Draw.tsx (which currently has a parallel
// `extractImagesFromHistory` for the rerun path).

import type { ComfyUIClient, ComfyUIHistoryEntry } from './comfyui';
import type { LemonGridClient, LemonGridTaskHistoryItem } from './lemongrid';
import type { HistoryItem, LocalDownload } from '../stores/historyTypes';

// ---------------------------------------------------------------------------
// Timestamp extraction
// ---------------------------------------------------------------------------

/**
 * Extract the most accurate execution timestamp from a ComfyUI history entry.
 * Tries (in order): the timestamp on the execution_success message,
 * the start_time field. Falls back to `Date.now()` if neither is present.
 */
export const extractExecutionTimestamp = (entry: ComfyUIHistoryEntry): number => {
  const status = entry.status;
  if (!status || typeof status !== 'object') {
    return typeof entry.start_time === 'number' ? entry.start_time * 1000 : Date.now();
  }

  const statusRecord = status as Record<string, unknown>;
  const messages = statusRecord.messages;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!Array.isArray(msg) || msg.length < 2) continue;
      const type = msg[0];
      const payload = msg[1];
      if (type !== 'execution_success' || !payload || typeof payload !== 'object') continue;
      const ts = (payload as Record<string, unknown>).timestamp;
      if (typeof ts === 'number') {
        return ts < 1e12 ? ts * 1000 : ts;
      }
    }
  }

  return typeof entry.start_time === 'number' ? entry.start_time * 1000 : Date.now();
};

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

export interface ExtractedImageInfo {
  imageName: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  images: Array<{
    filename: string;
    subfolder?: string;
    type?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
  }>;
}

/**
 * Walk a ComfyUI history entry's outputs map and build image references
 * (with view URLs) using the provided ComfyUI client.
 */
export const extractHistoryImage = (
  outputs: Record<string, unknown>,
  client: ComfyUIClient
): ExtractedImageInfo => {
  const images: ExtractedImageInfo['images'] = [];
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId] as {
      images?: Array<{ filename: string; subfolder?: string; type?: string }>;
    };
    if (!Array.isArray(nodeOutput.images) || nodeOutput.images.length === 0) {
      continue;
    }

    nodeOutput.images.forEach((image) => {
      if (!image || !image.filename) return;
      const filename = image.filename;
      const subfolder = image.subfolder || '';
      const type = image.type || 'output';
      images.push({
        filename,
        subfolder,
        type,
        thumbnailUrl: client.getViewUrl({
          filename,
          type: type as 'output' | 'input' | 'temp',
          subfolder,
          preview: true,
        }),
        imageUrl: client.getViewUrl({
          filename,
          type: type as 'output' | 'input' | 'temp',
          subfolder,
          preview: false,
        }),
      });
    });
  }

  if (images.length === 0) {
    return { imageName: 'Unknown Image', images };
  }

  const first = images[0];
  const imageName = first.filename || 'Unknown Image';
  const type = (first.type as 'output' | 'input' | 'temp') || 'output';
  const subfolder = first.subfolder || '';

  return {
    imageName,
    thumbnailUrl: client.getViewUrl({ filename: imageName, type, subfolder, preview: true }),
    imageUrl: client.getViewUrl({ filename: imageName, type, subfolder, preview: false }),
    images,
  };
};

// ---------------------------------------------------------------------------
// Prompt node extraction
// ---------------------------------------------------------------------------

export const isPromptNodesRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return false;
  }

  return entries.some(([, node]) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return false;
    }
    const record = node as Record<string, unknown>;
    return (
      typeof record.class_type === 'string' ||
      typeof record.type === 'string' ||
      (record.inputs && typeof record.inputs === 'object' && !Array.isArray(record.inputs))
    );
  });
};

/**
 * Extract the prompt nodes record from a ComfyUI history entry's prompt field.
 * The prompt field can be a tuple `[..., workflow_dict, extra_data, ...]`,
 * a wrapped object with `prompt`/`workflow`/`nodes` keys, or a bare record.
 */
export const extractPromptNodes = (prompt: unknown): Record<string, unknown> => {
  if (isPromptNodesRecord(prompt)) {
    return prompt;
  }

  if (Array.isArray(prompt)) {
    for (const item of prompt) {
      if (isPromptNodesRecord(item)) {
        return item;
      }
    }
  }

  if (prompt && typeof prompt === 'object') {
    const record = prompt as Record<string, unknown>;
    const candidates: unknown[] = [record.prompt, record.workflow, record.nodes];
    for (const candidate of candidates) {
      if (isPromptNodesRecord(candidate)) {
        return candidate;
      }
    }
  }

  return {};
};

// ---------------------------------------------------------------------------
// Full entry → HistoryItem conversion (ComfyUI direct mode)
// ---------------------------------------------------------------------------

/**
 * Convert a single ComfyUI history entry to a HistoryItem.
 * Pure given the client (for URL building) and the local downloads.
 */
export const convertEntryToItem = (
  promptId: string,
  entry: ComfyUIHistoryEntry,
  client: ComfyUIClient,
  localDownloads: string[]
): HistoryItem => {
  const outputs = entry.outputs || {};
  const imageInfo = extractHistoryImage(outputs, client);

  // ComfyUI history structure: prompt is a tuple [number, prompt_id, workflow_dict, extra_data, outputs_to_execute, sensitive]
  // - index 2: actual workflow dict (the API format JSON)
  // - index 3: extra_data (contains workflow_name, client_id, etc.)
  const promptTuple = entry.prompt;
  const workflowDict = Array.isArray(promptTuple) && promptTuple.length > 2
    ? promptTuple[2]
    : promptTuple; // fallback for old format
  const extraData = Array.isArray(promptTuple) && promptTuple.length > 3
    ? promptTuple[3]
    : undefined;

  const promptData = extractPromptNodes(workflowDict);
  const hasExtraData = extraData && typeof extraData === 'object';
  const hasWorkflowName = hasExtraData && 'workflow_name' in extraData;
  const extractedWorkflowName = hasExtraData ? (extraData as Record<string, unknown>).workflow_name : undefined;
  const workflowName = hasWorkflowName
    ? String(extractedWorkflowName)
    : imageInfo.imageName;

  return {
    id: promptId,
    promptId,
    workflow: promptId,
    workflowName,
    imageName: imageInfo.imageName,
    params: promptData as Record<string, unknown>,
    outputs,
    imageUrl: imageInfo.imageUrl,
    thumbnailUrl: imageInfo.thumbnailUrl,
    images: imageInfo.images,
    timestamp: extractExecutionTimestamp(entry),
    status: 'completed',
    localDownloads,
    source: 'direct' as const,
  };
};

// ---------------------------------------------------------------------------
// Status filtering
// ---------------------------------------------------------------------------

/**
 * Decide whether a ComfyUI history entry should be shown in the history list.
 * Filters out entries with an error status. ComfyUI's API exposes the status
 * in two places (top-level `status_str` or nested in `status.status_str`).
 */
export const isHistoryEntrySuccessful = (entry: ComfyUIHistoryEntry): boolean => {
  const statusStr = entry.status_str ||
    (typeof entry.status === 'object' && entry.status?.status_str);
  return statusStr !== 'error';
};

// ---------------------------------------------------------------------------
// Cluster task → HistoryItem conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single LemonGrid task history item to a HistoryItem.
 * Pure: the only side effect is the thumbnail URL with token, which is
 * deterministic given the client + asset id.
 */
export const convertClusterTaskToItem = (
  task: LemonGridTaskHistoryItem,
  client: LemonGridClient
): HistoryItem => {
  const outputIds = task.output_file_ids || [];
  const firstAssetId = outputIds[0];
  const thumbnailUrl = firstAssetId
    ? client.getThumbnailUrlWithToken(firstAssetId)
    : undefined;

  return {
    id: `cluster-${task.id}`,
    promptId: task.id,
    workflow: task.template_id,
    workflowName: task.workflow_name || task.template_category || 'Unknown',
    imageName: task.workflow_name || task.template_id,
    params: task.parameters || {},
    outputs: {},
    thumbnailUrl,
    imageUrl: thumbnailUrl, // Use thumbnail for list view; full download on demand
    timestamp: task.completed_at
      ? new Date(task.completed_at).getTime()
      : new Date(task.created_at).getTime(),
    status: (task.status === 'COMPLETED' ? 'completed' : task.status === 'FAILED' ? 'failed' : 'completed') as HistoryItem['status'],
    localDownloads: [],
    images: outputIds.map((fid) => ({
      filename: fid,
      type: 'output',
      thumbnailUrl: client.getThumbnailUrlWithToken(fid),
      imageUrl: client.getThumbnailUrlWithToken(fid),
    })),
    source: 'cluster' as const,
  };
};

// ---------------------------------------------------------------------------
// Local downloads map builder
// ---------------------------------------------------------------------------

/**
 * Build a Map<promptId, filePath[]> from a flat list of LocalDownloads.
 * Useful for quick lookup when constructing HistoryItems.
 */
export const buildLocalDownloadsMap = (downloads: LocalDownload[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const download of downloads) {
    const existing = map.get(download.promptId) || [];
    existing.push(download.filePath);
    map.set(download.promptId, existing);
  }
  return map;
};
