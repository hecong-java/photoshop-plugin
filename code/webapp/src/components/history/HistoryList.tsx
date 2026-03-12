import React, { useState } from 'react';
import type { HistoryItem } from '../../stores/historyStore';
import { HistoryItemComponent } from './HistoryItem';
import './HistoryList.css';

interface HistoryListProps {
  items: HistoryItem[];
  onView: (item: HistoryItem) => Promise<void>;
  onRerun: (item: HistoryItem) => void;
  onReEdit: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

const ITEMS_PER_PAGE = 10;

export const HistoryList: React.FC<HistoryListProps> = ({
  items,
  onView,
  onRerun,
  onReEdit,
  onDelete,
  isLoading = false,
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedItems = items.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (isLoading) {
    return (
      <div className="history-list-loading">
        <p>加载中...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="history-list-empty">
        <p>暂无历史记录。请先创建一个任务！</p>
      </div>
    );
  }

  return (
    <div className="history-list">
      <div className="history-list-header">
        <span className="history-count">
          {items.length} {items.length !== 1 ? '条历史记录' : '条历史记录'}
        </span>
      </div>

      <div className="history-list-items">
        {paginatedItems.map((item) => (
          <HistoryItemComponent
            key={item.id}
            item={item}
            onView={onView}
            onRerun={onRerun}
            onReEdit={onReEdit}
            onDelete={onDelete}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="history-list-pagination">
          <button
            onClick={handlePreviousPage}
            disabled={currentPage === 1}
            className="pagination-btn"
          >
            ← 上一页
          </button>
          <span className="pagination-info">
            第 {currentPage} 页，共 {totalPages} 页
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage === totalPages}
            className="pagination-btn"
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
};
