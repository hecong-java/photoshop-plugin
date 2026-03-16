import { useState } from 'react';
import { usePSBridge, type PSImportMode } from '../../hooks/usePSBridge';
import { fileToBase64 } from '../../services/upload';

interface PSImportButtonProps {
  imagePath: string;
  imageBlob?: Blob | null;
  mode?: PSImportMode;
  layerName?: string;
  workflowName?: string;
  onImported?: (result: { mode: PSImportMode; layerName: string }) => void;
}

export const PSImportButton = ({
  imagePath,
  imageBlob,
  mode = 'pixel',
  layerName,
  workflowName,
  onImported
}: PSImportButtonProps) => {
  const { importImageAsLayer, importBase64AsLayer } = usePSBridge();
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setError(null);

    if (!imagePath && !imageBlob) {
      setError('Image path is required for Photoshop import.');
      return;
    }

    try {
      setIsImporting(true);
      const result = imageBlob
        ? await importBase64AsLayer({
            base64Data: await fileToBase64(new File([imageBlob], `ps-import-${Date.now()}.png`, { type: imageBlob.type || 'image/png' })),
            layerName,
            mode,
            workflowName,
            mimeType: imageBlob.type || 'image/png'
          })
        : await importImageAsLayer({
            imagePath,
            layerName,
            mode,
            workflowName
          });

      onImported?.({ mode: result.mode, layerName: result.layerName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={handleImport} disabled={isImporting || (!imagePath && !imageBlob)}>
        {isImporting ? '导入中...' : '导入到PS'}
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  );
};
