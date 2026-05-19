"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import Link from "next/link";
import {
  startVerification,
  retryVerification,
  deleteStatement,
} from "../_actions";
import type { StatementVerificationStatus } from "../_lib/mutability";
import { isStatementMutable } from "../_lib/mutability";

interface Props {
  statementId: string;
  statementDisplayId: string;
  claimDisplayId: string;
  verificationStatus: StatementVerificationStatus;
  canEdit: boolean;
  canDelete: boolean;
}

function StartButton({ statementId }: { statementId: string }) {
  const [, formAction, pending] = useActionState(startVerification, null);
  const [, startTransition] = useTransition();

  function handleClick() {
    const fd = new FormData();
    fd.set("statementId", statementId);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-primary flex-shrink-0"
      disabled={pending}
      onClick={handleClick}
    >
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
        <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      Start Verification
    </button>
  );
}

function RetryButton({ statementId }: { statementId: string }) {
  const [, formAction, pending] = useActionState(retryVerification, null);
  const [, startTransition] = useTransition();

  function handleClick() {
    const fd = new FormData();
    fd.set("statementId", statementId);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-primary flex-shrink-0"
      disabled={pending}
      onClick={handleClick}
    >
      <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
        <polyline points="23,4 23,10 17,10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Retry Verification
    </button>
  );
}

function DeleteButton({
  statementId,
  statementDisplayId,
  claimDisplayId,
}: {
  statementId: string;
  statementDisplayId: string;
  claimDisplayId: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deleteStatement, null);
  const [, startTransition] = useTransition();

  function handleClick() {
    const msg =
      `Permanently delete statement ${statementDisplayId}?\n\n` +
      `This will:\n` +
      `• Remove the statement record and all its verification history.\n` +
      `• Move the file to Google Drive trash.\n` +
      `• Revert claim ${claimDisplayId} to "Awaiting Statement"\n` +
      `  so a new statement can be uploaded.\n\n` +
      `This cannot be undone from the portal. The file in Drive trash\n` +
      `is recoverable for ~30 days.`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("statementId", statementId);
    startTransition(async () => {
      await formAction(fd);
      // After server action settles successfully, navigate. The action returns
      // { ok: true } on success; an error stays on the state below.
      router.push("/claims/statements");
    });
  }

  return (
    <div className="flex flex-col items-end">
      <button
        className="btn-secondary flex-shrink-0"
        disabled={pending}
        onClick={handleClick}
        style={{ color: "#ef4444", borderColor: "#fecaca" }}
      >
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
          <polyline points="3,6 5,6 21,6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Delete
      </button>
      {state && "error" in state && (
        <span style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{state.error}</span>
      )}
    </div>
  );
}

export function DetailHeaderActions(props: Props) {
  const mutable = isStatementMutable(props.verificationStatus);

  if (!mutable) {
    // Locked state: render no action buttons. Status badge is rendered elsewhere.
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 self-start">
      {props.canEdit && (
        <Link
          href={`/claims/statements/${props.statementId}/edit`}
          className="btn-secondary flex-shrink-0"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Edit
        </Link>
      )}

      {props.verificationStatus === "pending_verification" && <StartButton statementId={props.statementId} />}
      {(props.verificationStatus === "success" || props.verificationStatus === "failed") && (
        <RetryButton statementId={props.statementId} />
      )}

      {props.canDelete && (
        <DeleteButton
          statementId={props.statementId}
          statementDisplayId={props.statementDisplayId}
          claimDisplayId={props.claimDisplayId}
        />
      )}
    </div>
  );
}
