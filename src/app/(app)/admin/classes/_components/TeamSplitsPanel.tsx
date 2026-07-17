"use client";

import { useActionState, useEffect, useTransition, useState } from "react";
import { createTeamSplit, updateTeamSplit, toggleTeamSplitStatus } from "../_actions";

type TeamSplitRow = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
};

interface Props {
  classId: string;
  classStatus: "active" | "inactive";
  teamSplits: TeamSplitRow[];
}

type ActionState = { error: string } | { ok: true } | null;

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-gray-100 text-gray-500",
};

function AddTeamSplitForm({
  classId,
  onSuccess,
  onCancel,
}: {
  classId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(createTeamSplit, null as ActionState);

  useEffect(() => {
    if (state && "ok" in state) onSuccess();
  }, [state, onSuccess]);

  return (
    <form
      action={formAction}
      autoComplete="off"
      className="rounded-xl border border-surface-200 bg-surface-50 p-4 mb-4"
    >
      <input type="hidden" name="classId" value={classId} />
      <p className="text-sm font-medium text-surface-700 mb-3">New Team Split</p>
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        <div>
          <label className="input-label">
            Code <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            name="code"
            className="input-field"
            placeholder="e.g. team-a"
            required
            style={{ fontFamily: "monospace", width: 160 }}
          />
          <p className="text-xs text-surface-400 mt-1">Lowercase, hyphen-separated.</p>
        </div>
        <div className="flex-1">
          <label className="input-label">
            Name <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <input
            name="name"
            className="input-field"
            placeholder="e.g. Team A"
            required
          />
        </div>
        <div className="flex gap-2 pt-6">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? (
              <>
                <svg className="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Adding…
              </>
            ) : (
              "Add"
            )}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
      {state && "error" in state && (
        <p className="text-xs text-red-600 mt-3">{state.error}</p>
      )}
    </form>
  );
}

function EditTeamSplitForm({
  split,
  onSuccess,
  onCancel,
}: {
  split: TeamSplitRow;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateTeamSplit, null as ActionState);

  useEffect(() => {
    if (state && "ok" in state) onSuccess();
  }, [state, onSuccess]);

  return (
    <tr>
      <td colSpan={4} className="px-5 py-4">
        <form action={formAction} autoComplete="off">
          <input type="hidden" name="teamSplitId" value={split.id} />
          <div className="flex flex-col sm:flex-row gap-3 items-start">
            <div>
              <label className="input-label">Code (immutable)</label>
              <input
                className="input-field"
                value={split.code}
                disabled
                style={{ fontFamily: "monospace", width: 160 }}
              />
            </div>
            <div className="flex-1">
              <label className="input-label">
                Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="name"
                className="input-field"
                defaultValue={split.name}
                required
              />
            </div>
            <div className="flex gap-2 pt-6">
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </button>
              <button type="button" onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
          {state && "error" in state && (
            <p className="text-xs text-red-600 mt-3">{state.error}</p>
          )}
        </form>
      </td>
    </tr>
  );
}

function ToggleButton({ split }: { split: TeamSplitRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isDeactivate = split.status === "active";

  function handleClick() {
    const action = isDeactivate ? "deactivate" : "activate";
    if (!window.confirm(`Are you sure you want to ${action} this team split from the class?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await toggleTeamSplitStatus(split.id);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="btn-secondary text-xs py-1 px-2"
        style={isDeactivate ? { color: "#b45309" } : { color: "#16a34a" }}
        title={isDeactivate ? "Deactivate this team split" : "Activate this team split"}
      >
        {isPending ? "…" : isDeactivate ? "Deactivate" : "Activate"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function TeamSplitsPanel({ classId, classStatus, teamSplits }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const isClassActive = classStatus === "active";

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-surface-900">Team Splits</h3>
          <p className="text-sm text-surface-400 mt-0.5">
            {isClassActive
              ? "Manage team splits available for receipt tagging under this class."
              : "Class is inactive — new team splits cannot be added. Existing splits can still be edited or toggled."}
          </p>
        </div>
        <button
          type="button"
          disabled={!isClassActive || showAddForm}
          onClick={() => {
            setEditingId(null);
            setShowAddForm(true);
          }}
          className="btn-primary"
          style={!isClassActive ? { opacity: 0.45, cursor: "not-allowed" } : {}}
          title={!isClassActive ? "Cannot add team splits to an inactive class" : undefined}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add Team Split
        </button>
      </div>

      {showAddForm && (
        <AddTeamSplitForm
          classId={classId}
          onSuccess={() => setShowAddForm(false)}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {teamSplits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <p className="text-surface-900 font-semibold mb-1">No team splits yet</p>
            {isClassActive && (
              <p className="text-sm text-surface-400">
                Click &ldquo;Add Team Split&rdquo; to create the first one for this class.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Code
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {teamSplits.map((split) =>
                  editingId === split.id ? (
                    <EditTeamSplitForm
                      key={split.id}
                      split={split}
                      onSuccess={() => setEditingId(null)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <tr key={split.id} className="table-row">
                      <td className="px-5 py-4">
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: 12,
                            fontWeight: 600,
                            background: "#f1f3f7",
                            color: "#374151",
                            padding: "2px 8px",
                            borderRadius: 6,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {split.code}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-medium text-surface-800">{split.name}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`badge ${STATUS_COLORS[split.status] ?? ""}`}
                          style={{ textTransform: "capitalize" }}
                        >
                          {split.status}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddForm(false);
                              setEditingId(split.id);
                            }}
                            className="btn-icon"
                            title="Edit name"
                          >
                            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                              <path
                                d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <ToggleButton split={split} />
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
