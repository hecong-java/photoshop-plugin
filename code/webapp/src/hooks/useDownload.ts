// Hook for managing download state and operations
import { useState, useCallback } from 'react';
import {
  downloadAndSaveImage,
  listDownloadedFiles,
  deleteDownloadedFile,
  openDownloadsFolder,
  generateDownloadFilename
} from '../services/download';
import type { DownloadProgress } from '../services/download';


export interface DownloadedFile {
  filename: string;
  path: string;
  size: number;
  modifiedTime: number;
}

interface UseDownloadState {
  isDownloading: boolean;
  progress: DownloadProgress | null;
  downloadedFiles: DownloadedFile[];
  error: string | null;
}

export function useDownload() {
  const [state, setState] = useState<UseDownloadState>({
    isDownloading: false,
    progress: null,
    downloadedFiles: [],
    error: null
  });

  /**
   * Download single image
   */
  const downloadImage = useCallback(
    async (imageUrl: string, workflowName: string, index: number = 0) => {
      setState(prev => ({ ...prev, isDownloading: true, error: null }));
      
      try {
        const filename = generateDownloadFilename(workflowName, index);
        const result = await downloadAndSaveImage(
          imageUrl,
          filename,
          (progress) => {
            setState(prev => ({ ...prev, progress }));
          }
        );
        
        setState(prev => ({
          ...prev,
          isDownloading: false,
          progress: null,
          error: null
        }));
        
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState(prev => ({
          ...prev,
          isDownloading: false,
          progress: null,
          error: errorMsg
        }));
        throw error;
      }
    },
    []
  );

  /**
   * Download multiple images
   */
  const downloadImages = useCallback(
    async (
      images: Array<{ url: string; workflowName: string }>,
      onProgress?: (current: number, total: number) => void
    ) => {
      setState(prev => ({ ...prev, isDownloading: true, error: null }));
      
      try {
        const results = [];
        
        for (let i = 0; i < images.length; i++) {
          const filename = generateDownloadFilename(images[i].workflowName, i);
          const result = await downloadAndSaveImage(
            images[i].url,
            filename,
            (progress) => {
              setState(prev => ({ ...prev, progress }));
            }
          );
          results.push(result);
          onProgress?.(i + 1, images.length);
        }
        
        setState(prev => ({
          ...prev,
          isDownloading: false,
          progress: null,
          error: null
        }));
        
        return results;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        setState(prev => ({
          ...prev,
          isDownloading: false,
          progress: null,
          error: errorMsg
        }));
        throw error;
      }
    },
    []
  );

  /**
   * Refresh list of downloaded files
   */
  const refreshDownloadList = useCallback(async () => {
    try {
      const files = await listDownloadedFiles();
      setState(prev => ({
        ...prev,
        downloadedFiles: files,
        error: null
      }));
      return files;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState(prev => ({
        ...prev,
        error: errorMsg
      }));
      throw error;
    }
  }, []);

  /**
   * Delete a downloaded file
   */
  const deleteFile = useCallback(async (path: string) => {
    try {
      await deleteDownloadedFile(path);
      
      // Refresh list after deletion
      const files = await listDownloadedFiles();
      setState(prev => ({
        ...prev,
        downloadedFiles: files,
        error: null
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState(prev => ({
        ...prev,
        error: errorMsg
      }));
      throw error;
    }
  }, []);

  /**
   * Open downloads folder in system file manager
   */
  const openFolder = useCallback(async () => {
    try {
      await openDownloadsFolder();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setState(prev => ({
        ...prev,
        error: errorMsg
      }));
      throw error;
    }
  }, []);

  /**
   * Clear error message
   */
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    // State
    isDownloading: state.isDownloading,
    progress: state.progress,
    downloadedFiles: state.downloadedFiles,
    error: state.error,
    
    // Actions
    downloadImage,
    downloadImages,
    refreshDownloadList,
    deleteFile,
    openFolder,
    clearError
  };
}
