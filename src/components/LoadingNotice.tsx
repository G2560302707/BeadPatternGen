interface LoadingNoticeProps {
  label: string;
}

export function LoadingNotice({ label }: LoadingNoticeProps) {
  return (
    <div className="loading-notice" role="status">
      <span className="loading-notice__peg" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
