// Shared types for history (used by historyStore, historyParser, downloadTracker).
// Extracted to avoid circular imports between the store and the services.

export interface HistoryItem {
  id: string;
  promptId: string;
  workflow: string;
  workflowName: string;
  imageName: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
  imageUrl?: string;
  thumbnailUrl?: string; // URL or path, NOT base64
  timestamp: number; // ms since epoch
  status: 'completed' | 'failed' | 'pending';
  localDownloads: string[];
  images: Array<{
    filename: string;
    subfolder?: string;
    type?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
  }>;
  source?: 'direct' | 'cluster'; // defaults to 'direct' for backward compat
  templateType?: 'COMFYUI' | 'THIRD_PARTY_API';
  templateVersion?: number;
}

export interface LocalDownload {
  promptId: string;
  filePath: string;
  downloadedAt: number;
}
