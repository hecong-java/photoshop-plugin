import React from 'react';
import './ConfirmDialog.css';

export interface ConfirmDialogAction {
  label: string;
  variant: 'primary' | 'destructive' | 'secondary';
  onClick: () => void;
}

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  actions: ConfirmDialogAction[];
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  actions,
  onClose,
}) => {
  if (!visible) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="confirm-dialog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-header">{title}</div>
        <div className="confirm-dialog-body">{message}</div>
        <div className="confirm-dialog-actions">
          {actions.map((action, index) => (
            <button
              key={index}
              className={`confirm-dialog-btn confirm-dialog-btn-${action.variant}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
