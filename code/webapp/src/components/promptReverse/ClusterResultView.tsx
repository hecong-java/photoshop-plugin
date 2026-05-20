import React from 'react';
import type { ClusterReversePromptResult } from '../../services/clusterPromptReverseService';
import './ClusterResultView.css';

interface ClusterResultViewProps {
  result: ClusterReversePromptResult;
  onCopy: (text: string) => void;
  onFillPrompt: (text: string) => void;
  copySuccess: boolean;
  isDrawPage: boolean;
}

export const ClusterResultView: React.FC<ClusterResultViewProps> = ({
  result, onCopy, onFillPrompt, copySuccess, isDrawPage,
}) => {
  const [showAnalysis, setShowAnalysis] = React.useState(false);

  return (
    <div className="cluster-result-view">
      <div className="cluster-result-main">
        <label className="cluster-result-label">中文提示词</label>
        <div className="cluster-result-text">{result.prompt_cn}</div>
        <div className="cluster-result-actions-inline">
          <button className="crf-btn crf-btn-sm" onClick={() => onCopy(result.prompt_cn)}>
            {copySuccess ? '已复制' : '复制'}
          </button>
          {isDrawPage && (
            <button className="crf-btn crf-btn-sm crf-btn-primary" onClick={() => onFillPrompt(result.prompt_cn)}>
              填入提示词
            </button>
          )}
        </div>
      </div>

      {result.prompt && result.prompt !== result.prompt_cn && (
        <div className="cluster-result-section">
          <label className="cluster-result-label">英文提示词</label>
          <div className="cluster-result-text">{result.prompt}</div>
          <button className="crf-btn crf-btn-sm" onClick={() => onCopy(result.prompt)}>复制</button>
        </div>
      )}

      {result.negative_prompt && (
        <div className="cluster-result-section">
          <label className="cluster-result-label">反向提示词</label>
          <div className="cluster-result-text">{result.negative_prompt}</div>
          <button className="crf-btn crf-btn-sm" onClick={() => onCopy(result.negative_prompt)}>复制</button>
        </div>
      )}

      {result.analysis && (
        <div className="cluster-result-section">
          <button className="cluster-result-toggle" onClick={() => setShowAnalysis(!showAnalysis)}>
            {showAnalysis ? '收起分析' : '展开详细分析'}
          </button>
          {showAnalysis && (
            <div className="cluster-result-analysis">
              {result.analysis.subject && <p><strong>主体：</strong>{result.analysis.subject}</p>}
              {result.analysis.composition && <p><strong>构图：</strong>{result.analysis.composition}</p>}
              {result.analysis.lighting && <p><strong>光影：</strong>{result.analysis.lighting}</p>}
              {result.analysis.color_palette && <p><strong>色彩：</strong>{result.analysis.color_palette}</p>}
              {result.analysis.mood && <p><strong>氛围：</strong>{result.analysis.mood}</p>}
              {result.analysis.style && <p><strong>风格：</strong>{result.analysis.style}</p>}
              {result.analysis.technical && <p><strong>技术：</strong>{result.analysis.technical}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
