import React, { useState } from 'react';
import { usePresetStore } from '../../stores/presetStore';
import * as presetService from '../../services/preset';
import type { PresetFile } from '../../types/preset';
import { ConfirmDialog } from './ConfirmDialog';
import './PresetToolbar.css';

interface PresetToolbarProps {
  workflowName: string | null;
  workflowPath: string | undefined;
  inputValues: Record<string, string | number | boolean>;
  imageFilenames: Record<string, string>;
  onApplyPreset: (preset: PresetFile) => void;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

export const PresetToolbar: React.FC<PresetToolbarProps> = ({
  workflowName,
  workflowPath,
  inputValues,
  imageFilenames,
  onApplyPreset,
}) => {
  const {
    presets,
    selectedPresetName,
    selectedPresetData,
    isLoading: isPresetLoading,
    loadPresets,
    selectPreset,
    clearSelection,
    setLastAppliedValues,
    hasUnsavedChanges,
  } = usePresetStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [pendingPresetFilename, setPendingPresetFilename] = useState<string | null>(null);

  // Import conflict state (wired in Task 2)
  const [showImportConflict, setShowImportConflict] = useState(false);
  const [conflictPresetName, setConflictPresetName] = useState<string | null>(null);
  const [pendingImportData, setPendingImportData] = useState<PresetFile | null>(null);

  const disabled = !workflowName;

  // Sort presets by updatedAt descending
  const sortedPresets = [...presets].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const handleAddPreset = async () => {
    if (!workflowName) return;
    try {
      const nextName = presetService.getNextPresetName(presets);
      const filename = sanitizeFilename(`${workflowName}-${nextName}.json`);
      const now = new Date().toISOString();
      const data: PresetFile = {
        version: 1,
        name: nextName,
        workflowName,
        workflowPath,
        inputValues: { ...inputValues },
        imageFilenames: { ...imageFilenames },
        createdAt: now,
        updatedAt: now,
      };
      await presetService.savePreset(filename, data);
      await loadPresets(workflowName);
      await selectPreset(filename);
      setLastAppliedValues(inputValues, imageFilenames);
    } catch (error) {
      console.error('Failed to add preset:', error);
    }
  };

  const applyPresetFromFile = async (filename: string) => {
    try {
      const presetData = await presetService.readPreset(filename);
      await selectPreset(filename);
      onApplyPreset(presetData);
      setLastAppliedValues(presetData.inputValues, presetData.imageFilenames);
    } catch (error) {
      console.error('Failed to load preset:', error);
    }
  };

  const handleSelectPreset = (filename: string) => {
    if (!filename) {
      clearSelection();
      return;
    }
    if (hasUnsavedChanges(inputValues, imageFilenames)) {
      setPendingPresetFilename(filename);
      setShowUnsavedConfirm(true);
      return;
    }
    applyPresetFromFile(filename);
  };

  const handleUnsavedConfirmSwitch = () => {
    setShowUnsavedConfirm(false);
    if (pendingPresetFilename) {
      applyPresetFromFile(pendingPresetFilename);
      setPendingPresetFilename(null);
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPresetName || !workflowName) return;
    try {
      await presetService.deletePreset(selectedPresetName);
      clearSelection();
      await loadPresets(workflowName);
      setShowDeleteConfirm(false);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to delete preset:', error);
    }
  };

  const handleStartEdit = () => {
    if (!selectedPresetData) return;
    setEditName(selectedPresetData.name);
    setIsEditing(true);
  };

  const handleRenameConfirm = async () => {
    if (!selectedPresetData || !selectedPresetName || !workflowName || !editName.trim()) return;
    try {
      const trimmedName = editName.trim();
      const newFilename = sanitizeFilename(`${workflowName}-${trimmedName}.json`);
      const now = new Date().toISOString();
      const updatedData: PresetFile = {
        ...selectedPresetData,
        name: trimmedName,
        updatedAt: now,
      };
      await presetService.savePreset(newFilename, updatedData);
      if (newFilename !== selectedPresetName) {
        await presetService.deletePreset(selectedPresetName);
      }
      await loadPresets(workflowName);
      await selectPreset(newFilename);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to rename preset:', error);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  // Import/export stubs (wired in Task 2)
  const handleImportPreset = async () => {
    if (!workflowName) return;
    try {
      const result = await presetService.importPreset();
      if (result.cancelled) return;

      const validated = presetService.validatePresetData(result.data);
      if (!validated) {
        console.error('Preset import failed: invalid file format');
        return;
      }

      // Check for name conflict
      const conflict = presets.find((p) => p.name === validated.name);
      if (conflict) {
        setPendingImportData(validated);
        setConflictPresetName(conflict.name);
        setShowImportConflict(true);
        return;
      }

      // No conflict - save directly
      const filename = sanitizeFilename(`${workflowName}-${validated.name}.json`);
      await presetService.savePreset(filename, validated);
      await loadPresets(workflowName);
    } catch (error) {
      console.error('Failed to import preset:', error);
    }
  };

  const handleExportPreset = async () => {
    if (!selectedPresetData || !selectedPresetName) {
      console.error('Please select a preset first');
      return;
    }
    try {
      const result = await presetService.exportPreset(selectedPresetName, selectedPresetData);
      if (result.cancelled) return;
    } catch (error) {
      console.error('Failed to export preset:', error);
    }
  };

  const handleImportOverwrite = async () => {
    if (!pendingImportData || !conflictPresetName || !workflowName) return;
    try {
      const filename = sanitizeFilename(`${workflowName}-${conflictPresetName}.json`);
      await presetService.savePreset(filename, pendingImportData);
      await loadPresets(workflowName);
    } catch (error) {
      console.error('Failed to overwrite preset:', error);
    }
    setShowImportConflict(false);
    setPendingImportData(null);
    setConflictPresetName(null);
  };

  const handleImportRename = async () => {
    if (!pendingImportData || !workflowName) return;
    try {
      // Generate a new unique name
      let baseName = pendingImportData.name;
      let counter = 1;
      const existingNames = new Set(presets.map((p) => p.name));
      let newName = `${baseName} (${counter})`;
      while (existingNames.has(newName)) {
        counter++;
        newName = `${baseName} (${counter})`;
      }
      const renamedData: PresetFile = {
        ...pendingImportData,
        name: newName,
      };
      const filename = sanitizeFilename(`${workflowName}-${newName}.json`);
      await presetService.savePreset(filename, renamedData);
      await loadPresets(workflowName);
    } catch (error) {
      console.error('Failed to rename imported preset:', error);
    }
    setShowImportConflict(false);
    setPendingImportData(null);
    setConflictPresetName(null);
  };

  const handleImportSkip = () => {
    setShowImportConflict(false);
    setPendingImportData(null);
    setConflictPresetName(null);
  };

  const currentPreset = presets.find((p) => p.filename === selectedPresetName);

  return (
    <div className={`preset-toolbar ${disabled ? 'disabled' : ''}`}>
      {isEditing && selectedPresetData ? (
        <div className="preset-edit-row">
          <input
            type="text"
            className="preset-edit-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleEditKeyDown}
            autoFocus
          />
          <button
            className="preset-toolbar-btn preset-delete-btn"
            title="删除预设"
            onClick={() => setShowDeleteConfirm(true)}
          >
            &#x2715;
          </button>
          <button
            className="preset-toolbar-btn"
            title="完成编辑"
            onClick={() => setIsEditing(false)}
          >
            &#x2713;
          </button>
        </div>
      ) : (
        <>
          <select
            className="preset-select"
            value={selectedPresetName || ''}
            onChange={(e) => handleSelectPreset(e.target.value)}
            disabled={isPresetLoading}
          >
            <option value="" disabled>
              {isPresetLoading ? '加载中...' : '选择预设...'}
            </option>
            {sortedPresets.map((preset) => (
              <option key={preset.filename} value={preset.filename}>
                {preset.filename === selectedPresetName ? '[*] ' : ''}
                {preset.name}
              </option>
            ))}
          </select>
          <button
            className="preset-toolbar-btn"
            title="保存为预设"
            onClick={handleAddPreset}
            disabled={isPresetLoading}
          >
            +
          </button>
          <button
            className="preset-toolbar-btn"
            title="编辑预设"
            onClick={handleStartEdit}
            disabled={!selectedPresetName || isPresetLoading}
          >
            &#x2699;
          </button>
          <button
            className="preset-toolbar-btn"
            title="导入预设"
            onClick={handleImportPreset}
            disabled={isPresetLoading || !workflowName}
          >
            &#x1F4E5;
          </button>
          <button
            className="preset-toolbar-btn"
            title="导出预设"
            onClick={handleExportPreset}
            disabled={!selectedPresetName || isPresetLoading}
          >
            &#x1F4E4;
          </button>
        </>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="删除预设"
        message={`确定要删除预设「${currentPreset?.name || ''}」吗？此操作不可撤销。`}
        actions={[
          { label: '取消', variant: 'secondary', onClick: () => setShowDeleteConfirm(false) },
          { label: '删除', variant: 'destructive', onClick: handleDeletePreset },
        ]}
        onClose={() => setShowDeleteConfirm(false)}
      />

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        visible={showUnsavedConfirm}
        title="未保存的更改"
        message="当前参数有未保存的更改，切换预设将丢弃这些更改。"
        actions={[
          { label: '取消', variant: 'secondary', onClick: () => { setShowUnsavedConfirm(false); setPendingPresetFilename(null); } },
          { label: '不保存并切换', variant: 'primary', onClick: handleUnsavedConfirmSwitch },
        ]}
        onClose={() => { setShowUnsavedConfirm(false); setPendingPresetFilename(null); }}
      />

      {/* Import conflict dialog */}
      <ConfirmDialog
        visible={showImportConflict}
        title="预设名称冲突"
        message={`导入的预设「${conflictPresetName || ''}」与已有预设同名，请选择处理方式：`}
        actions={[
          { label: '覆盖', variant: 'destructive', onClick: handleImportOverwrite },
          { label: '跳过', variant: 'secondary', onClick: handleImportSkip },
          { label: '重命名', variant: 'primary', onClick: handleImportRename },
        ]}
        onClose={handleImportSkip}
      />
    </div>
  );
};
