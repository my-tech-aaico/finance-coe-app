"use client";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

type Entity = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
};

type UserOption = {
  id: string;
  name: string;
  status: "active" | "inactive";
};

interface Props {
  entities: Entity[];
  users: UserOption[];
  defaultValues?: {
    claimMonth?: number;
    claimYear?: number;
    entityId?: string;
    description?: string;
    claimantId?: string | null;
  };
  currentEntityId?: string;
  currentClaimantId?: string | null;
}

export function ClaimFormFields({
  entities,
  users,
  defaultValues,
  currentEntityId,
  currentClaimantId,
}: Props) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  const entityOptions = [
    ...entities.filter((e) => e.status === "active"),
  ];
  if (currentEntityId) {
    const current = entities.find((e) => e.id === currentEntityId);
    if (current && current.status !== "active") {
      entityOptions.unshift(current);
    }
  }

  const userOptions = [...users.filter((u) => u.status === "active")];
  if (currentClaimantId) {
    const current = users.find((u) => u.id === currentClaimantId);
    if (current && current.status !== "active") {
      userOptions.unshift(current);
    }
  }

  return (
    <>
      <div className="flex gap-4">
        <div style={{ flex: 1 }}>
          <label className="input-label">
            Claim Month <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <select
            name="claimMonth"
            className="input-field"
            defaultValue={defaultValues?.claimMonth ?? now.getMonth() + 1}
            required
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="input-label">
            Claim Year <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <select
            name="claimYear"
            className="input-field"
            defaultValue={defaultValues?.claimYear ?? currentYear}
            required
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="input-label">
          Entity <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          name="entityId"
          className="input-field"
          defaultValue={defaultValues?.entityId ?? ""}
          required
        >
          <option value="" disabled>
            Select entity…
          </option>
          {entityOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} — {e.name}
              {e.status === "inactive" ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="input-label">
          Description <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          name="description"
          type="text"
          className="input-field"
          placeholder="Claim for the month of..."
          defaultValue={defaultValues?.description ?? ""}
          maxLength={1000}
          required
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
        />
      </div>

      <div>
        <label className="input-label">Claimant</label>
        <select
          name="claimantId"
          className="input-field"
          defaultValue={defaultValues?.claimantId ?? ""}
        >
          <option value="">Leave unassigned for now.</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.status === "inactive" ? " (inactive)" : ""}
            </option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>
          Optional. Finance can assign the claimant after collecting receipts.
        </p>
      </div>
    </>
  );
}
