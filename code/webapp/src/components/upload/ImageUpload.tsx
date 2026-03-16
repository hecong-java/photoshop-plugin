import React, { useRef, useState } from 'react';
import { uploadToComfyUI, isValidImageFile } from '../../services/upload';

import './ImageUpload.css';

export interface ImageUploadProps {
  onImageUpload?: (filename: string, file: File) => void;
  onError?: (error: Error) => void;
  accept?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUpload,
  onError,
  accept = 'image/png,image/jpeg,image/jpg,image/webp'
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the drop zone itself
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processFile = async (file: File) => {
    setError(null);
    
    // Validate file type
    if (!isValidImageFile(file)) {
      const err = new Error(`Invalid file type or size. Supported: PNG, JPEG, WebP (max 50MB)`);
      setError(err.message);
      onError?.(err);
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = async (e) => {
      const preview = e.target?.result as string;
      setPreviewUrl(preview);

      // Upload to ComfyUI
      try {
        setIsUploading(true);
        const filename = await uploadToComfyUI(file);
        setUploadedFilename(filename);
        onImageUpload?.(filename, file);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setError(err.message);
        onError?.(err);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleClear = () => {
    setPreviewUrl(null);
    setUploadedFilename(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="image-upload">
      <div className="upload-container">
        {!previewUrl ? (
          <div
            className={`drop-zone ${isDragging ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div className="drop-zone-content">
              {isUploading ? (
                <>
                  <div className="spinner"></div>
                  <p>Uploading to ComfyUI...</p>
                </>
              ) : isDragging ? (
                <>
                  <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p>Drop image here...</p>
                </>
              ) : (
                <>
                  <svg className="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p>Drag & drop image here</p>
                  <p className="or-text">or</p>
                  <button 
                    className="choose-button" 
                    onClick={handleChooseFile}
                    disabled={isUploading}
                  >
                    Choose File
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="preview-container">
            <img src={previewUrl} alt="Preview" className="preview-image" />
            <div className="preview-info">
              {uploadedFilename && (
                <p className="filename">Filename: {uploadedFilename}</p>
              )}
              <button 
                className="replace-button" 
                onClick={handleChooseFile}
                disabled={isUploading}
              >
                Replace Image
              </button>
              <button 
                className="remove-button" 
                onClick={handleClear}
                disabled={isUploading}
              >
                Remove
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  );
};
