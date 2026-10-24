interface ErrorNoticeProps {
  code: string;
  message: string;
  onDismiss: () => void;
}

export function ErrorNotice({ code, message, onDismiss }: ErrorNoticeProps) {
  return (
    <div className="error-notice" role="alert">
      <div>
        <p className="error-notice__code">{code}</p>
        <p className="error-notice__msg">{message}</p>
      </div>
      <button type="button" className="btn" onClick={onDismiss}>
        关闭
      </button>
    </div>
  );
}
