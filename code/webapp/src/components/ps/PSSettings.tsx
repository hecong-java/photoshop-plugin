import { useState } from 'react';
import type { PSImportMode } from '../../hooks/usePSBridge';

interface PSSettingsProps {
  defaultMode?: PSImportMode;
  onModeChange?: (mode: PSImportMode) => void;
}

export const PSSettings = ({ defaultMode = 'pixel', onModeChange }: PSSettingsProps) => {
  const [mode, setMode] = useState<PSImportMode>(defaultMode);

  const handleChange = (nextMode: PSImportMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  return (
    <section>
      <h3>Photoshop Import</h3>
      <div role="radiogroup" aria-label="Photoshop import mode">
        <label>
          <input
            type="radio"
            name="ps-import-mode"
            value="pixel"
            checked={mode === 'pixel'}
            onChange={() => handleChange('pixel')}
          />
          Pixel Layer
        </label>
        <label>
          <input
            type="radio"
            name="ps-import-mode"
            value="smartObject"
            checked={mode === 'smartObject'}
            onChange={() => handleChange('smartObject')}
          />
          Smart Object
        </label>
      </div>
    </section>
  );
};
