import React, { useState, useEffect, useCallback } from 'react';
import { usePresetStore } from '../../stores/presetStore';
import { useSettingsStore } from '../../stores/settingsStore';
import * as presetService from '../../services/preset';
import * as clusterPresetService from '../../services/clusterPresetService';
import type { PresetFile } from '../../types/preset';
import type { PresetMeta } from '../../types/preset';
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

/**
 * Set the selected preset in the store directly, bypassing presetService.readPreset.
 * In cluster mode, the preset data comes from the LemonGrid API (not the local Bridge),
 * so calling the store's selectPreset() would fail because it tries to read from Bridge.
 */
function selectClusterPreset(presetId: string, presetData: PresetFile): void {
  usePresetStore.setState({
    selectedPresetName: presetId,
    selectedPresetData: presetData,
    isLoading: false,
  });
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

  const connectionMode = useSettingsStore((s) => s.connectionMode);
  const isCluster = connectionMode === 'cluster';

  // Preset operation error state for user-visible feedback
  const [presetError, setPresetError] = useState<string | null>(null);

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!presetError) return;
    const timer = setTimeout(() => setPresetError(null), 5000);
    return () => clearTimeout(timer);
  }, [presetError]);

  /**
   * Reload presets from the correct source based on connection mode.
   * The store's loadPresets() always uses the local Bridge service,
   * which returns empty in cluster mode. This helper dispatches to
   * clusterPresetService for cluster mode.
   */
  const reloadPresets = useCallback(async (wfName: string): Promise<void> => {
    if (isCluster) {
      const clusterPresets = await clusterPresetService.listPresets(wfName);
      setClusterPresetCache(clusterPresets);
      const metas: PresetMeta[] = clusterPresets.map(p => ({
        filename: p.id,
        name: p.name,
        workflowName: p.template_id,
        updatedAt: p.updated_at,
        createdAt: p.created_at,
      }));
      usePresetStore.setState({ presets: metas, isLoading: false });
    } else {
      await loadPresets(wfName);
    }
  }, [isCluster, loadPresets]);

  // Cache full cluster preset data (with parameters) to avoid re-fetching on select
  const [clusterPresetCache, setClusterPresetCache] = useState<clusterPresetService.ClusterPresetMeta[]>([]);

  // Cluster mode: load presets from LemonGrid server instead of Bridge filesystem
  useEffect(() => {
    if (isCluster && workflowName) {
      usePresetStore.setState({ isLoading: true });
      reloadPresets(workflowName).catch(err => {
        usePresetStore.setState({ error: err.message, isLoading: false });
      });
    }
  }, [isCluster, workflowName, reloadPresets]);

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

  /**
   * Build a PresetFile from a cluster preset's parameters.
   * LemonGrid JSONB stores the exact dict. Split by type:
   * strings -> imageFilenames, others -> inputValues.
   */
  const buildPresetFileFromCluster = useCallback((
    clusterPreset: clusterPresetService.ClusterPresetMeta
  ): PresetFile => {
    const inputVals: Record<string, string | number | boolean> = {};
    const imageFns: Record<string, string> = {};
    for (const [key, value] of Object.entries(clusterPreset.parameters)) {
      if (typeof value === 'string') {
        imageFns[key] = value;
      } else {
        inputVals[key] = value as string | number | boolean;
      }
    }
    return {
      version: 1,
      name: clusterPreset.name,
      workflowName: clusterPreset.template_id,
      inputValues: inputVals,
      imageFilenames: imageFns,
      createdAt: clusterPreset.created_at,
      updatedAt: clusterPreset.updated_at,
    };
  }, []);

  const handleAddPreset = async () => {
    if (!workflowName) return;
    setPresetError(null);
    try {
      if (selectedPresetName && selectedPresetData) {
        // Update existing preset
        if (isCluster) {
          const parameters: Record<string, unknown> = { ...inputValues, ...imageFilenames };
          const updated = await clusterPresetService.updatePreset(workflowName, selectedPresetName, { parameters });
          await reloadPresets(workflowName);
          const presetData = buildPresetFileFromCluster(updated);
          selectClusterPreset(selectedPresetName, presetData);
        } else {
          const now = new Date().toISOString();
          const data: PresetFile = {
            ...selectedPresetData,
            inputValues: { ...inputValues },
            imageFilenames: { ...imageFilenames },
            updatedAt: now,
          };
          await presetService.savePreset(selectedPresetName, data);
          await loadPresets(workflowName);
          await selectPreset(selectedPresetName);
        }
        setLastAppliedValues(inputValues, imageFilenames);
      } else {
        // No preset selected — create new
        if (isCluster) {
          const nextName = presetService.getNextPresetName(presets);
          const parameters: Record<string, unknown> = { ...inputValues, ...imageFilenames };
          const created = await clusterPresetService.createPreset(workflowName, nextName, parameters);
          await reloadPresets(workflowName);
          const presetData = buildPresetFileFromCluster(created);
          selectClusterPreset(created.id, presetData);
          setLastAppliedValues(inputValues, imageFilenames);
        } else {
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
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存预设失败';
      console.error('Failed to save preset:', error);
      setPresetError(message);
    }
  };

  const applyPresetFromFile = async (filename: string) => {
    setPresetError(null);
    try {
      if (isCluster) {
        // Use cached cluster preset data instead of re-fetching from API
        const clusterPreset = clusterPresetCache.find(p => p.id === filename);
        if (!clusterPreset) {
          console.error('Cluster preset not found:', filename);
          setPresetError('未找到预设');
          return;
        }
        const presetData = buildPresetFileFromCluster(clusterPreset);
        selectClusterPreset(filename, presetData);
        onApplyPreset(presetData);
        setLastAppliedValues(presetData.inputValues, presetData.imageFilenames);
      } else {
        const presetData = await presetService.readPreset(filename);
        await selectPreset(filename);
        onApplyPreset(presetData);
        setLastAppliedValues(presetData.inputValues, presetData.imageFilenames);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载预设失败';
      console.error('Failed to load preset:', error);
      setPresetError(message);
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
    setPresetError(null);
    try {
      if (isCluster) {
        await clusterPresetService.deletePreset(workflowName, selectedPresetName);
      } else {
        await presetService.deletePreset(selectedPresetName);
      }
      clearSelection();
      await reloadPresets(workflowName);
      setShowDeleteConfirm(false);
      setIsEditing(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除预设失败';
      console.error('Failed to delete preset:', error);
      setPresetError(message);
    }
  };

  const handleStartEdit = () => {
    if (!selectedPresetData) return;
    setEditName(selectedPresetData.name);
    setIsEditing(true);
  };

  const handleRenameConfirm = async () => {
    if (!selectedPresetData || !selectedPresetName || !workflowName || !editName.trim()) return;
    setPresetError(null);
    try {
      const trimmedName = editName.trim();
      if (isCluster) {
        const updated = await clusterPresetService.updatePreset(workflowName, selectedPresetName, { name: trimmedName });
        await reloadPresets(workflowName);
        // Re-select by updating store directly with the renamed preset data
        const presetData = buildPresetFileFromCluster(updated);
        selectClusterPreset(selectedPresetName, presetData);
      } else {
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
      }
      setIsEditing(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '重命名预设失败';
      console.error('Failed to rename preset:', error);
      setPresetError(message);
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
    setPresetError(null);
    try {
      const result = await presetService.importPreset();
      if (result.cancelled) return;

      const validated = presetService.validatePresetData(result.data);
      if (!validated) {
        console.error('Preset import failed: invalid file format');
        setPresetError('预设文件格式无效');
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
      const message = error instanceof Error ? error.message : '导入预设失败';
      console.error('Failed to import preset:', error);
      setPresetError(message);
    }
  };

  const handleExportPreset = async () => {
    if (!selectedPresetData || !selectedPresetName) {
      console.error('Please select a preset first');
      return;
    }
    setPresetError(null);
    try {
      const result = await presetService.exportPreset(selectedPresetName, selectedPresetData);
      if (result.cancelled) return;
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出预设失败';
      console.error('Failed to export preset:', error);
      setPresetError(message);
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
      {presetError && (
        <div className="preset-error-notice">
          <span className="preset-error-icon">&#x26A0;</span>
          <span className="preset-error-text">{presetError}</span>
          <button className="preset-error-dismiss" onClick={() => setPresetError(null)}>&#x2715;</button>
        </div>
      )}
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
            onClick={handleRenameConfirm}
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
                {preset.filename === selectedPresetName && hasUnsavedChanges(inputValues, imageFilenames) ? '[*] ' : ''}
                {preset.name}
              </option>
            ))}
          </select>
          <button
            className="preset-toolbar-btn"
            title={selectedPresetName ? '保存预设' : '保存为预设'}
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
            disabled={isPresetLoading || !workflowName || isCluster}
          >
            &#x2193;
          </button>
          <button
            className="preset-toolbar-btn"
            title="导出预设"
            onClick={handleExportPreset}
            disabled={!selectedPresetName || isPresetLoading || isCluster}
          >
            &#x2191;
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
