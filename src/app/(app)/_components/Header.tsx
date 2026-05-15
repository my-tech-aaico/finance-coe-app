"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface HeaderProps {
  userName: string;
  userRole: string;
  pageTitle?: string;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function Header({ userName, userRole, pageTitle }: HeaderProps) {
  const router = useRouter();
  const [dark, setDark] = useState(false);

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark");
    setDark((d) => !d);
  };

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const toggleMobileSidebar = () => {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    sidebar?.classList.toggle("mobile-open");
    overlay?.classList.toggle("show");
  };

  return (
    <>
      <div id="sidebar-overlay" onClick={toggleMobileSidebar} />
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-surface-200 h-16 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            id="hamburger-btn"
            onClick={toggleMobileSidebar}
            className="btn-icon !border-0 flex-shrink-0"
          >
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
              <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h1 id="page-title" className="text-lg font-bold text-surface-900">
            {pageTitle ?? "Dashboard"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="user-info text-right mr-2">
            <p className="text-sm font-semibold text-surface-800">{userName}</p>
            <p className="text-xs text-surface-400 capitalize">{userRole}</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-semibold text-sm">
            {getInitials(userName)}
          </div>
          <button onClick={toggleTheme} className="btn-icon" title="Toggle theme">
            {dark ? (
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <path
                  d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button onClick={handleLogout} className="btn-icon" title="Logout">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path
                d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="16,17 21,12 16,7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line
                x1="21"
                y1="12"
                x2="9"
                y2="12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>
    </>
  );
}
