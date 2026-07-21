"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createReceipt, updateReceipt } from "../_actions";

type Dept = { id: string; code: string; name: string; status: "active" | "inactive" };
type Cls = { id: string; code: string; name: string; status: "active" | "inactive" };
type TeamSplit = { id: string; code: string; name: string; classId: string };
type ProjectCode = { id: string; code: string; name: string };
type Receipt = {
  id: string;
  departmentId: string;
  classId: string;
  teamSplitId: string | null;
  projectCodeId: string | null;
  fileName: string;
};

interface BaseProps {
  claimId: string;
  claimDisplayId: string;
  departments: Dept[];
  classes: Cls[];
  teamSplits: TeamSplit[];
  projectCodes: ProjectCode[];
}
interface AddProps extends BaseProps {
  mode: "add";
}
interface EditProps extends BaseProps {
  mode: "edit";
  receipt: Receipt;
}

type Props = AddProps | EditProps;
type ActionState = { error: string } | { ok: true } | null;

// Searchable, type-to-filter dropdown for Project Code (the list can be large — 1000+ codes).
// Keeps a hidden `projectCodeId` input so the server-action contract is unchanged.
function ProjectCodeCombobox({
  projectCodes,
  defaultValue,
}: {
  projectCodes: ProjectCode[];
  defaultValue: string;
}) {
  const initial = projectCodes.find((p) => p.id === defaultValue);
  const labelOf = (p: ProjectCode) => `${p.code} — ${p.name}`;

  const [selectedId, setSelectedId] = useState<string>(initial ? defaultValue : "");
  const [query, setQuery] = useState<string>(initial ? labelOf(initial) : "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = projectCodes.find((p) => p.id === selectedId);
  // When the input still shows the selected label, treat the filter as empty so
  // reopening shows the full list rather than an empty "no match".
  const showingSelection = selected != null && query === labelOf(selected);
  const q = showingSelection ? "" : query.trim().toLowerCase();
  const matches =
    q === ""
      ? projectCodes
      : projectCodes.filter(
          (p) => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        );

  function select(p: ProjectCode) {
    setSelectedId(p.id);
    setQuery(labelOf(p));
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <input type="hidden" name="projectCodeId" value={selectedId} />
      <input
        type="text"
        className="input-field"
        placeholder="Search project code or name…"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedId(""); // typing invalidates the selection until a new one is chosen
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div
          className="absolute z-20 mt-1 w-full bg-white border border-surface-200 rounded-lg shadow-lg"
          style={{ maxHeight: 224, overflowY: "auto" }}
        >
          {matches.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-surface-400">No matching project code</div>
          ) : (
            matches.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => select(p)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface-50 flex items-center gap-2"
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "#f0f4ff",
                    color: "#4263eb",
                    padding: "2px 8px",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.code}
                </span>
                <span className="text-surface-700">{p.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ReceiptForm(props: Props) {
  const isEdit = props.mode === "edit";
  const receipt = isEdit ? (props as EditProps).receipt : undefined;
  const action = isEdit ? updateReceipt : createReceipt;
  const [state, formAction, pending] = useActionState(action, null as ActionState);

  const [classId, setClassId] = useState<string>(receipt?.classId ?? "");
  const [teamSplitId, setTeamSplitId] = useState<string>(receipt?.teamSplitId ?? "");

  const splitsForClass = props.teamSplits.filter((t) => t.classId === classId);
  const classChosen = classId !== "";
  const classHasSplits = splitsForClass.length > 0;
  const teamSplitRequired = classChosen && classHasSplits;

  function onClassChange(next: string) {
    setClassId(next);
    setTeamSplitId(""); // reset on class change (spec §5.6.2)
  }

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-surface-900">
            {isEdit ? "Edit Receipt" : "Add Receipt"}
          </h3>
          <p className="text-xs text-surface-400 mt-0.5">
            Claim <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{props.claimDisplayId}</span>
          </p>
        </div>
        <Link
          href={`/claims/receipts/${props.claimId}`}
          className="flex items-center gap-1 text-sm text-surface-400 hover:text-surface-700 transition-colors"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Claim
        </Link>
      </div>

      <form action={formAction} autoComplete="off">
        {isEdit && <input type="hidden" name="receiptId" value={receipt!.id} />}
        {!isEdit && <input type="hidden" name="claimId" value={props.claimId} />}
        {/* Keep the controlled team split value in the submitted form data */}
        <input type="hidden" name="teamSplitId" value={teamSplitId} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          <div>
            <label className="input-label">
              Receipt File {!isEdit && <span style={{ color: "#ef4444" }}>*</span>}
            </label>
            {isEdit && receipt && (
              <p className="text-xs text-surface-400 mb-2">
                Current: <span className="font-medium text-surface-700">{receipt.fileName}</span>. Leave empty to keep existing file.
              </p>
            )}
            <input
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic"
              required={!isEdit}
              className="input-field"
              style={{ height: "auto", padding: "10px 14px" }}
            />
            <p className="text-xs text-surface-400 mt-1">PDF, JPEG, PNG, or HEIC. Max 10 MiB.</p>
          </div>

          <div>
            <label className="input-label">
              Department <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select name="departmentId" required className="input-field" defaultValue={receipt?.departmentId ?? ""}>
              <option value="" disabled>Select department…</option>
              {props.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}{d.status === "inactive" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="input-label">
              Class <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select
              name="classId"
              required
              className="input-field"
              value={classId}
              onChange={(e) => onClassChange(e.target.value)}
            >
              <option value="" disabled>Select class…</option>
              {props.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}{c.status === "inactive" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="input-label">
              Team Split {teamSplitRequired && <span style={{ color: "#ef4444" }}>*</span>}
            </label>
            <select
              className="input-field"
              value={teamSplitId}
              disabled={!classChosen || !classHasSplits}
              required={teamSplitRequired}
              onChange={(e) => setTeamSplitId(e.target.value)}
            >
              <option value="">
                {!classChosen
                  ? "Select a class first…"
                  : !classHasSplits
                    ? "No team splits for this class"
                    : "Select team split…"}
              </option>
              {splitsForClass.map((t) => (
                <option key={t.id} value={t.id}>{t.code}</option>
              ))}
            </select>
            <p className="text-xs text-surface-400 mt-1">
              {!classChosen
                ? "Depends on the selected class."
                : !classHasSplits
                  ? "This class has no team splits — optional."
                  : "Required for this class."}
            </p>
          </div>

          <div>
            <label className="input-label">
              Project Code <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <ProjectCodeCombobox
              projectCodes={props.projectCodes}
              defaultValue={receipt?.projectCodeId ?? ""}
            />
            <p className="text-xs text-surface-400 mt-1">Type to search by code or name. Only active codes.</p>
          </div>
        </div>

        {state && "error" in state && (
          <div style={{
            marginTop: 16,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#dc2626",
            fontSize: 13,
            borderRadius: 8,
            padding: "10px 14px",
          }}>
            {state.error}
          </div>
        )}

        <div className="flex gap-3 items-center mt-6">
          <button
            type="submit"
            disabled={pending}
            className="btn-primary"
          >
            {pending ? (
              <>
                <svg className="animate-spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {isEdit ? "Saving…" : "Uploading…"}
              </>
            ) : isEdit ? "Save Changes" : "Add Receipt"}
          </button>
          <Link href={`/claims/receipts/${props.claimId}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
