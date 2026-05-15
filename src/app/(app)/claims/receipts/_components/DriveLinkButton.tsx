"use client";

interface Props {
  url: string;
}

export function DriveLinkButton({ url }: Props) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-icon"
      title="Open Google Drive receipts folder"
    >
      <svg width="15" height="15" viewBox="0 0 87.3 78" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L28.25 52H0c0 1.55.4 3.1 1.2 4.5l5.4 10.35z" fill="#0066da" />
        <path d="M43.65 25L29.2 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 47.5A9 9 0 000 52h28.25L43.65 25z" fill="#00ac47" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A9 9 0 0087.3 52H59.05l6.5 13.2 8 11.6z" fill="#ea4335" />
        <path d="M43.65 25L58.1 0H28.25L43.65 25z" fill="#00832d" />
        <path d="M73.7 52H87.3a9 9 0 00-1.2-4.5L61.65 3.3C60.85 1.9 59.7.8 58.35 0L43.65 25 59.05 52H73.7z" fill="#2684fc" />
        <path d="M59.05 52H28.25L13.8 76.8c1.35.8 2.9 1.2 4.5 1.2h49.9c1.6 0 3.1-.45 4.5-1.2L59.05 52z" fill="#ffba00" />
      </svg>
    </a>
  );
}
