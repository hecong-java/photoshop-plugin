import React, { useState, useCallback } from 'react';
import { usePromptReverseStore } from '../../stores/promptReverseStore';
import * as clusterPromptReverseService from '../../services/clusterPromptReverseService';
import { ClusterResultView } from './ClusterResultView';
import type { ClusterReversePromptResult } from '../../services/clusterPromptReverseService';
import './PromptReverseFlow.css';

export const PromptReverseFlow: React.FC<{ onFillPrompt?: (text: string) => void }> = ({
  onFillPrompt,
}) => {
  const step = usePromptReverseStore((s) => s.step);
  const imagePreviewUrl = usePromptReverseStore((s) => s.imagePreviewUrl);
  const imageBase64 = usePromptReverseStore((s) => s.imageBase64);
  const assetId = usePromptReverseStore((s) => s.assetId);
  const customPrompt = usePromptReverseStore((s) => s.customPrompt);
  const result = usePromptReverseStore((s) => s.result);
  const error = usePromptReverseStore((s) => s.error);
  const goToPrompt = usePromptReverseStore((s) => s.goToPrompt);
  const setCustomPrompt = usePromptReverseStore((s) => s.setCustomPrompt);
  const setLoading = usePromptReverseStore((s) => s.setLoading);
  const setResult = usePromptReverseStore((s) => s.setResult);
  const setError = usePromptReverseStore((s) => s.setError);
  const reset = usePromptReverseStore((s) => s.reset);
  const setAbortController = usePromptReverseStore((s) => s.setAbortController);

  const [copySuccess, setCopySuccess] = useState(false);
  const [, setIsAnalyzing] = useState(false);
  const [clusterResult, setClusterResult] = useState<ClusterReversePromptResult | null>(null);

  const handleStartAnalysis = useCallback(async () => {
    if (!imageBase64 && !assetId) return;
    setLoading();
    setIsAnalyzing(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      let effectiveAssetId = assetId;
      if (!effectiveAssetId && imageBase64) {
        const blob = await fetch(`data:image/png;base64,${imageBase64}`).then(r => r.blob());
        effectiveAssetId = await clusterPromptReverseService.uploadForReversePrompt(blob);
      }
      if (!effectiveAssetId) {
        setError('分析失败：无法获取图片资源');
        return;
      }
      const clusterRes = await clusterPromptReverseService.reversePromptFromAsset(
        effectiveAssetId,
        customPrompt
      );
      setClusterResult(clusterRes);
      setResult(clusterRes.prompt_cn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setError(`分析失败：${msg}`);
    } finally {
      setIsAnalyzing(false);
      setAbortController(null);
    }
  }, [assetId, imageBase64, customPrompt, setLoading, setResult, setError, setAbortController]);

  const handleCopy = useCallback(async (text?: string) => {
    const copyText = text || result;
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = copyText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  }, [result]);

  const handleFillPrompt = useCallback(() => {
    if (result && onFillPrompt) {
      onFillPrompt(result);
    }
  }, [result, onFillPrompt]);

  const handleRetry = useCallback(() => {
    setIsAnalyzing(false);
    setClusterResult(null);
    goToPrompt();
  }, [goToPrompt]);

  if (step === 'closed') return null;

  const isDrawPage = !!onFillPrompt;

  return (
    <div className="prompt-reverse-flow-overlay" onClick={reset}>
      <div className="prompt-reverse-flow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-reverse-flow-header">
          <h2 className="prompt-reverse-flow-title">
            {step === 'preview' && '确认图片'}
            {step === 'prompt' && '编辑提示词'}
            {step === 'loading' && '正在分析图片...'}
            {step === 'result' && '分析结果'}
          </h2>
          <button className="prompt-reverse-flow-close" onClick={reset}>x</button>
        </div>

        {/* Step: Preview */}
        {step === 'preview' && (
          <div className="prompt-reverse-flow-body">
            {imagePreviewUrl && (
              <div className="prompt-reverse-preview">
                <img src={imagePreviewUrl} alt="preview" className="prompt-reverse-preview-image" />
              </div>
            )}
            <div className="prompt-reverse-flow-actions">
              <button className="prf-btn prf-btn-secondary" onClick={reset}>取消</button>
              <button className="prf-btn prf-btn-primary" onClick={goToPrompt}>下一步</button>
            </div>
          </div>
        )}

        {/* Step: Editable Prompt */}
        {step === 'prompt' && (
          <div className="prompt-reverse-flow-body">
            <div className="prompt-reverse-prompt-section">
              <label className="prompt-reverse-prompt-label">分析提示词</label>
              <textarea
                className="prompt-reverse-prompt-textarea"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={6}
                placeholder="输入自定义提示词来指导图片分析..."
              />
              <span className="prompt-reverse-prompt-hint">
                修改提示词可以改变分析的角度和详细程度
              </span>
            </div>
            <div className="prompt-reverse-flow-actions">
              <button className="prf-btn prf-btn-secondary" onClick={reset}>取消</button>
              <button className="prf-btn prf-btn-primary" onClick={handleStartAnalysis}>
                开始分析
              </button>
            </div>
          </div>
        )}

        {/* Step: Loading */}
        {step === 'loading' && (
          <div className="prompt-reverse-flow-body">
            <div className="prompt-reverse-loading">
              <div className="spinner"></div>
              <p>正在分析图片，请稍候...</p>
            </div>
            <div className="prompt-reverse-flow-actions">
              <button className="prf-btn prf-btn-secondary" onClick={reset}>取消</button>
            </div>
          </div>
        )}

        {/* Step: Result */}
        {step === 'result' && (
          <div className="prompt-reverse-flow-body">
            <div className="prompt-reverse-result-header">
              {imagePreviewUrl && (
                <img src={imagePreviewUrl} alt="analyzed" className="prompt-reverse-result-thumb" />
              )}
            </div>
            {error ? (
              <div className="prompt-reverse-error">{error}</div>
            ) : clusterResult ? (
              <ClusterResultView
                result={clusterResult}
                onCopy={handleCopy}
                onFillPrompt={handleFillPrompt}
                copySuccess={copySuccess}
                isDrawPage={isDrawPage}
              />
            ) : (
              <div className="prompt-reverse-result-text">{result}</div>
            )}
            <div className="prompt-reverse-flow-actions">
              {isDrawPage && !error && (
                <button className="prf-btn prf-btn-info" onClick={handleFillPrompt}>填入提示词</button>
              )}
              {!error && (
                <button className="prf-btn prf-btn-primary" onClick={() => void handleCopy()}>
                  {copySuccess ? '已复制' : '复制到剪贴板'}
                </button>
              )}
              <button className="prf-btn prf-btn-secondary" onClick={handleRetry}>重新分析</button>
              <button className="prf-btn prf-btn-secondary" onClick={reset}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
