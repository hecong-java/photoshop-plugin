// Download service for managing image downloads from ComfyUI
// Handles progress tracking, file saving via bridge, and local file management

import { zipSync } from 'fflate';
import { sendBridgeMessage } from './upload';

export interface DownloadProgress {
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentComplete: number;
  status: 'pending' | 'downloading' | 'saving' | 'complete' | 'error';
  error?: string;
  savedPath?: string;
}

/**
 * Download image from ComfyUI and save to plugin local storage
 * @param imageUrl - ComfyUI /view URL
 * @param filename - Suggested filename
 * @param onProgress - Callback for progress updates
 * @returns Path where file was saved
 */
export async function downloadAndSaveImage(
  imageUrl: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ savedPath: string; filename: string }> {
  const progress: DownloadProgress = {
    filename,
    bytesDownloaded: 0,
    totalBytes: 0,
    percentComplete: 0,
    status: 'downloading'
  };

  try {
    // Fetch with progress tracking
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    // Get total size if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      progress.totalBytes = parseInt(contentLength, 10);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body not readable');
    }

    const chunks: Uint8Array[] = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;
      
      // Update progress
      progress.bytesDownloaded = receivedLength;
      if (progress.totalBytes > 0) {
        progress.percentComplete = Math.round((receivedLength / progress.totalBytes) * 100);
      }
      
      onProgress?.(progress);
    }

    // Combine chunks into single Uint8Array
    const data = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.length;
    }

    // Save to local FS via bridge
    progress.status = 'saving';
    onProgress?.(progress);

    const result = await sendBridgeMessage('fs.saveDownload', {
      filename,
      data: Array.from(data) // Convert Uint8Array to plain array for JSON serialization
    }) as { path: string; success: boolean };

    if (!result.success || !result.path) {
      throw new Error('Bridge failed to save file');
    }

    progress.status = 'complete';
    progress.percentComplete = 100;
    progress.savedPath = result.path;
    onProgress?.(progress);

    return {
      savedPath: result.path,
      filename
    };
  } catch (error) {
    progress.status = 'error';
    progress.error = error instanceof Error ? error.message : String(error);
    onProgress?.(progress);
    throw error;
  }
}

export async function downloadAndSaveZip(
  images: Array<{ url: string; filename: string; index: number }>,
  archiveName: string
): Promise<{ savedPath: string; filename: string }> {
  if (!archiveName.toLowerCase().endsWith('.zip')) {
    throw new Error('Archive filename must end with .zip');
  }

  const fileMap: Record<string, Uint8Array> = {};

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const baseName = image.filename || `image-${image.index + 1}.png`;
    let fileName = baseName;
    let suffix = 1;
    while (fileMap[fileName]) {
      const extIndex = baseName.lastIndexOf('.');
      if (extIndex > 0) {
        fileName = `${baseName.slice(0, extIndex)}-${suffix}${baseName.slice(extIndex)}`;
      } else {
        fileName = `${baseName}-${suffix}`;
      }
      suffix += 1;
    }
    fileMap[fileName] = new Uint8Array(buffer);
  }

  const zipData = zipSync(fileMap, { level: 0 });
  const result = await sendBridgeMessage('fs.saveDownload', {
    filename: archiveName,
    data: Array.from(zipData),
  }) as { path: string; success: boolean };

  if (!result.success || !result.path) {
    throw new Error('Bridge failed to save zip file');
  }

  return {
    savedPath: result.path,
    filename: archiveName,
  };
}

/**
 * Download multiple images in sequence
 * @param images - Array of { url, filename }
 * @param onProgress - Callback for each download
 * @returns Array of saved file info
 */
export async function downloadMultipleImages(
  images: Array<{ url: string; filename: string }>,
  onProgress?: (progress: DownloadProgress) => void
): Promise<Array<{ savedPath: string; filename: string }>> {
  const results: Array<{ savedPath: string; filename: string }> = [];

  for (const image of images) {
    try {
      const result = await downloadAndSaveImage(image.url, image.filename, onProgress);
      results.push(result);
    } catch (error) {
      console.error(`Failed to download ${image.filename}:`, error);
      // Continue with next image instead of failing entire batch
    }
  }

  return results;
}

/**
 * List downloaded files from plugin storage
 * @returns Array of downloaded files
 */
export async function listDownloadedFiles(): Promise<Array<{ 
  filename: string; 
  path: string; 
  size: number;
  modifiedTime: number;
}>> {
  try {
    const result = await sendBridgeMessage('fs.listDownloads', {}) as Array<{
      filename: string;
      path: string;
      size: number;
      modifiedTime: number;
    }>;
    return result || [];
  } catch (error) {
    console.error('Failed to list downloads:', error);
    return [];
  }
}

/**
 * Delete a downloaded file
 * @param path - File path to delete
 */
export async function deleteDownloadedFile(path: string): Promise<void> {
  try {
    await sendBridgeMessage('fs.deleteDownload', { path });
  } catch (error) {
    console.error('Failed to delete download:', error);
    throw error;
  }
}

/**
 * Open the downloads folder in system file manager
 */
export async function openDownloadsFolder(): Promise<void> {
  try {
    const result = await sendBridgeMessage('fs.openDirectory', {}) as {
      success?: boolean;
      opened?: boolean;
      path?: string;
      error?: string;
    };

    if (!result?.success) {
      throw new Error('打开下载目录失败');
    }

    if (!result.opened) {
      const details = result.error ? `，原因：${result.error}` : '';
      const pathHint = result.path ? `\n下载目录：${result.path}` : '';
      throw new Error(`当前环境无法自动打开目录${details}${pathHint}`);
    }
  } catch (error) {
    console.error('Failed to open downloads folder:', error);
    throw error;
  }
}

/**
 * Generate a standard download filename based on workflow name and timestamp
 */
export function generateDownloadFilename(
  workflowName: string,
  index: number = 0
): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const safeName = workflowName.replace(/[^\w\s-]/g, '').slice(0, 30);
  
  return `${safeName}_${dateStr}-${timeStr}_${index}.png`;
}
