import React, { useState, useCallback } from 'react';
import { usePromptReverseStore } from '../../stores/promptReverseStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { analyzeImage, PROMPT_TEMPLATES } from '../../services/dashscope';
import './PromptReverseFlow.css';

export const PromptReverseFlow: React.FC<{ onFillPrompt?: (text: string) => void }> = ({
  onFillPrompt,
}) => {
  const step = usePromptReverseStore((s) => s.step);
  const imagePreviewUrl = usePromptReverseStore((s) => s.imagePreviewUrl);
  const imageBase64 = usePromptReverseStore((s) => s.imageBase64);
  const selectedTemplate = usePromptReverseStore((s) => s.selectedTemplate);
  const result = usePromptReverseStore((s) => s.result);
  const error = usePromptReverseStore((s) => s.error);
  const selectTemplate = usePromptReverseStore((s) => s.selectTemplate);
  const setLoading = usePromptReverseStore((s) => s.setLoading);
  const setResult = usePromptReverseStore((s) => s.setResult);
  const setError = usePromptReverseStore((s) => s.setError);
  const reset = usePromptReverseStore((s) => s.reset);
  const setAbortController = usePromptReverseStore((s) => s.setAbortController);
  const getActiveTemplate = usePromptReverseStore((s) => s.getActiveTemplate);
  const dashScope = useSettingsStore((s) => s.dashScope);

  const [copySuccess, setCopySuccess] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleStartAnalysis = useCallback(async () => {
    if (!dashScope.apiKey) {
      setError('请先在设置页面填写 DashScope API Key');
      return;
    }
    if (!imageBase64 || !selectedTemplate) return;

    const template = getActiveTemplate();
    if (!template) return;

    setLoading();
    setIsAnalyzing(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const text = await analyzeImage(
        { apiKey: dashScope.apiKey, model: dashScope.model },
        imageBase64,
        template.systemPrompt
      );
      setResult(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setError(`分析失败：${msg}。请检查 API Key 是否正确，稍后重试。`);
    } finally {
      setIsAnalyzing(false);
      setAbortController(null);
    }
  }, [dashScope, imageBase64, selectedTemplate, getActiveTemplate, setLoading, setResult, setError, setAbortController]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = result;
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
    selectTemplate(selectedTemplate || '');
  }, [selectTemplate, selectedTemplate]);

  if (step === 'closed') return null;

  const isDrawPage = !!onFillPrompt;

  return (
    <div className="prompt-reverse-flow-overlay" onClick={reset}>
      <div className="prompt-reverse-flow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-reverse-flow-header">
          <h2 className="prompt-reverse-flow-title">
            {step === 'preview' && '确认图片'}
            {step === 'template' && '选择描述风格'}
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
              <button className="prf-btn prf-btn-primary" onClick={() => selectTemplate(selectedTemplate || '')}>下一步</button>
            </div>
          </div>
        )}

        {/* Step: Template Selection */}
        {step === 'template' && (
          <div className="prompt-reverse-flow-body">
            {!dashScope.apiKey && (
              <div className="prompt-reverse-empty-state">
                请先在设置页面配置 DashScope API Key
              </div>
            )}
            <div className="prompt-reverse-template-grid">
              {PROMPT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  className={`prompt-reverse-template-card ${selectedTemplate === tpl.id ? 'selected' : ''}`}
                  onClick={() => selectTemplate(tpl.id)}
                >
                  <span className="template-name">{tpl.name}</span>
                  <span className="template-desc">{tpl.description}</span>
                </button>
              ))}
            </div>
            <div className="prompt-reverse-flow-actions">
              <button className="prf-btn prf-btn-secondary" onClick={reset}>返回</button>
              <button
                className="prf-btn prf-btn-primary"
                disabled={!selectedTemplate || !dashScope.apiKey}
                onClick={handleStartAnalysis}
              >
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
              {getActiveTemplate() && (
                <span className="prompt-reverse-result-template">{getActiveTemplate()!.name}</span>
              )}
            </div>
            {error ? (
              <div className="prompt-reverse-error">{error}</div>
            ) : (
              <div className="prompt-reverse-result-text">{result}</div>
            )}
            <div className="prompt-reverse-flow-actions">
              {isDrawPage && !error && (
                <button className="prf-btn prf-btn-info" onClick={handleFillPrompt}>填入提示词</button>
              )}
              {!error && (
                <button className="prf-btn prf-btn-primary" onClick={handleCopy}>
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
