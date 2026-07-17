"use client";

import { canAccess, type Role } from "@/lib/permissions";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface SidebarProps {
  role: Role;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const [claimsOpen, setClaimsOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      id="sidebar"
      className="sidebar fixed top-0 left-0 h-full bg-white border-r border-surface-200 z-50 flex flex-col"
      style={{ width: 256 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-surface-100 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-bold text-lg text-surface-900 tracking-tight">
          COE Finance
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {/* Dashboard */}
        <Link
          href="/dashboard"
          className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${isActive("/dashboard") ? "active" : "text-surface-600"}`}
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path
              d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points="9,22 9,12 15,12 15,22"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Dashboard</span>
        </Link>

        {/* Claims Group */}
        {(canAccess(role, "/claims/receipts") || canAccess(role, "/claims/statements")) && (
          <div className="pt-3">
            <button
              onClick={() => setClaimsOpen(!claimsOpen)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider hover:text-surface-600 transition-colors"
            >
              <span>Claims</span>
              <svg
                className={`w-4 h-4 transition-transform ${claimsOpen ? "" : "-rotate-90"}`}
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {claimsOpen && (
              <div className="space-y-0.5 mt-1">
                {canAccess(role, "/claims/receipts") && (
                  <Link
                    href="/claims/receipts"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/claims/receipts") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polyline
                        points="14,2 14,8 20,8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Receipts</span>
                  </Link>
                )}
                {canAccess(role, "/claims/statements") && (
                  <Link
                    href="/claims/statements"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/claims/statements") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polyline
                        points="17,8 12,3 7,8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <line
                        x1="12"
                        y1="3"
                        x2="12"
                        y2="15"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>Statements</span>
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* Admin Group */}
        {(canAccess(role, "/admin/users") || canAccess(role, "/admin/entities") || canAccess(role, "/admin/project-code") || canAccess(role, "/admin/departments") || canAccess(role, "/admin/classes")) && (
          <div className="pt-3">
            <button
              onClick={() => setAdminOpen(!adminOpen)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider hover:text-surface-600 transition-colors"
            >
              <span>Admin</span>
              <svg
                className={`w-4 h-4 transition-transform ${adminOpen ? "" : "-rotate-90"}`}
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {adminOpen && (
              <div className="space-y-0.5 mt-1">
                {canAccess(role, "/admin/users") && (
                  <Link
                    href="/admin/users"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/admin/users") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx="9"
                        cy="7"
                        r="4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <path
                        d="M23 21v-2a4 4 0 00-3-3.87"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M16 3.13a4 4 0 010 7.75"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span>User Management</span>
                  </Link>
                )}
                {canAccess(role, "/admin/entities") && (
                  <Link
                    href="/admin/entities"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/admin/entities") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Entities</span>
                  </Link>
                )}
                {canAccess(role, "/admin/project-code") && (
                  <Link
                    href="/admin/project-code"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/admin/project-code") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path d="M20 7h-9M14 17H5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <circle cx="17" cy="17" r="3" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                    <span>Project Code</span>
                  </Link>
                )}
                {canAccess(role, "/admin/departments") && (
                  <Link
                    href="/admin/departments"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/admin/departments") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <span>Departments</span>
                  </Link>
                )}
                {canAccess(role, "/admin/classes") && (
                  <Link
                    href="/admin/classes"
                    className={`nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm pl-6 ${isActive("/admin/classes") ? "active" : "text-surface-600"}`}
                  >
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                      <rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Classes</span>
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
}
