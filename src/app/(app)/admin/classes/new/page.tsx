import { requireRole } from "@/lib/session";
import Link from "next/link";
import { ClassForm } from "../_components/ClassForm";

export default async function NewClassPage() {
  await requireRole(["admin"]);
  return (
    <div className="animate-in">
      <Link
        href="/admin/classes"
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Classes
      </Link>
      <ClassForm />
    </div>
  );
}
