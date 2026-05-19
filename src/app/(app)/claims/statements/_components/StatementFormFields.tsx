"use client";

type ClaimOption = {
  id: string;
  displayId: string;
  description: string;
  claimantName: string | null;
};

interface UploadProps {
  mode: "upload";
  claims: ClaimOption[];
}

interface EditProps {
  mode: "edit";
  claims: ClaimOption[];
  current: {
    statementDate: string;
    claimId: string;
    fileName: string;
    fileSizeBytes: number;
    fileUrl: string;
    uploadDate: Date;
  };
}

type Props = UploadProps | EditProps;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function StatementFormFields(props: Props) {
  const isEdit = props.mode === "edit";
  const current = isEdit ? props.current : null;

  return (
    <div className="space-y-5">
      <div>
        <label className="input-label">
          Statement File {!isEdit && <span style={{ color: "#ef4444" }}>*</span>}
        </label>
        {isEdit && current && (
          <div
            style={{
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "#eff6ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#4263eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="14,2 14,8 20,8" stroke="#4263eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {current.fileName}
                </p>
                <p style={{ fontSize: 11, color: "#9ca3af" }}>
                  Uploaded {new Date(current.uploadDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {formatSize(current.fileSizeBytes)}
                </p>
              </div>
            </div>
            <a href={current.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#4263eb", fontWeight: 500, flexShrink: 0 }}>
              View
            </a>
          </div>
        )}
        <input
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          required={!isEdit}
          className="input-field"
          style={{ height: "auto", padding: "10px 14px" }}
        />
        <p className="text-xs text-surface-400 mt-1">
          PDF, JPEG, or PNG. Max 10 MiB.
          {isEdit && " Leave empty to keep the existing file."}
        </p>
      </div>

      <div>
        <label className="input-label">
          Statement Closing Date <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          name="statementDate"
          type="date"
          required
          className="input-field"
          defaultValue={current?.statementDate ?? ""}
        />
      </div>

      <div>
        <label className="input-label">
          Link to Claim <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          name="claimId"
          required
          className="input-field"
          defaultValue={current?.claimId ?? ""}
        >
          <option value="" disabled>
            Select a claim…
          </option>
          {props.claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayId} — {c.description}
              {c.claimantName ? ` (${c.claimantName})` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-surface-400 mt-1.5">
          Only claims with &ldquo;Awaiting Statement&rdquo; status and an assigned claimant are shown.
        </p>
      </div>

      {!isEdit && (
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              name="startVerification"
              style={{ marginTop: 2, width: 16, height: 16, accentColor: "#4263eb", cursor: "pointer", flexShrink: 0 }}
            />
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "#1f2937" }}>Start verification immediately</p>
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                Queue the statement for verification right after upload. If unchecked, the statement will sit in &ldquo;Pending Verification&rdquo; until you start it manually.
              </p>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
