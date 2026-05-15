"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { AddUserForm } from "./AddUserForm";
import { ToggleStatusButton } from "./ToggleStatusButton";

type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "finance" | "employee";
  status: "active" | "inactive";
  createdAt: Date;
  createdByName: string;
};

type FormMode = { mode: "add" } | { mode: "edit"; user: User };

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-50 text-purple-700",
  finance: "bg-teal-50 text-teal-700",
  employee: "bg-blue-50 text-blue-700",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-gray-100 text-gray-500",
};

interface Props {
  users: User[];
  filters: { q?: string; role?: string; status?: string };
}

export function UserTable({ users, filters }: Props) {
  const router = useRouter();
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.replace(`/admin/users?${params.toString()}`));
    },
    [filters, router]
  );

  if (formMode) {
    return (
      <AddUserForm
        onBack={() => setFormMode(null)}
        editUser={formMode.mode === "edit" ? formMode.user : undefined}
      />
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 page-header">
        <div>
          <h2 className="text-xl font-bold text-surface-900">User Management</h2>
          <p className="text-sm text-surface-400 mt-0.5">
            Manage portal users and access roles.
          </p>
        </div>
        <button onClick={() => setFormMode({ mode: "add" })} className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add User
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-4 px-4 py-3" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
          <svg
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a1a8b8", pointerEvents: "none" }}
            width="16" height="16" fill="none" viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            className="input-field"
            style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }}
            placeholder="Search users…"
            defaultValue={filters.q ?? ""}
            onChange={(e) => updateFilter("q", e.target.value)}
          />
        </div>
        <select
          className="input-field"
          style={{ width: 140, flexShrink: 0 }}
          defaultValue={filters.role ?? ""}
          onChange={(e) => updateFilter("role", e.target.value)}
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="finance">Finance</option>
          <option value="employee">Employee</option>
        </select>
        <select
          className="input-field"
          style={{ width: 148, flexShrink: 0 }}
          defaultValue={filters.status ?? ""}
          onChange={(e) => updateFilter("status", e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="9" cy="7" r="4" stroke="#a1a8b8" strokeWidth="1.8" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">No users found</p>
            <p className="text-sm text-surface-400 mb-5">Add your first user to get started.</p>
            <button onClick={() => setFormMode({ mode: "add" })} className="btn-primary">
              Add User
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Email</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Role</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Date Added</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Created By</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {users.map((u) => (
                  <tr key={u.id} className="table-row">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-xs flex-shrink-0">
                          {u.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
                        </div>
                        <span className={`font-medium ${u.status === "inactive" ? "text-surface-400" : "text-surface-800"}`}>
                          {u.name}
                        </span>
                      </div>
                    </td>
                    <td className={`px-5 py-4 ${u.status === "inactive" ? "text-surface-400" : "text-surface-600"}`}>{u.email}</td>
                    <td className="px-5 py-4">
                      <span className={`badge justify-center ${ROLE_COLORS[u.role] ?? ""}`} style={{ textTransform: "capitalize" }}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`badge justify-center ${STATUS_COLORS[u.status] ?? ""}`} style={{ textTransform: "capitalize" }}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-surface-500">
                      {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-4 text-surface-500">{u.createdByName}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setFormMode({ mode: "edit", user: u })}
                          className="btn-icon"
                          title="Edit user"
                        >
                          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <ToggleStatusButton userId={u.id} userName={u.name} currentStatus={u.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
