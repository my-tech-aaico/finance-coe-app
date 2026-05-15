# COE Finance Claims Portal — UI Specification

> This document captures all UI decisions made during the design review session. Use it as the source of truth for frontend development.

---

## 1. Authentication

### 1.1 Login Method

- Users log in via **Google SSO** using their company Google account.
- No username/password form — Google SSO is the only authentication method.
- No self-registration — users must be pre-created by an Admin in User Management.

### 1.2 Login Screen UI

The login screen is a centered card with the following elements (no other entry points):

- Heading: "Welcome back".
- Subheading: "Sign in with your company Google account to continue".
- A single **"Sign in with Google"** button with the official Google "G" multicolor icon.
- An info note: "Only company email addresses pre-registered by an administrator can access this portal."

The screen has no other inputs, no "Forgot password" link, no sign-up link, and no alternate login methods.

### 1.3 Access Control

- Only users whose email exists in the User Management table **and** whose status is **Active** can log in.
- Users with **Inactive** status are blocked from logging in, even if their email exists in the system.
- If an unrecognized email attempts Google SSO, access is denied.

---

## 2. Layout & Navigation

### 2.1 Side Navigation

- Collapsible side nav (can toggle between full labels and icon-only mode).
- Menu items are grouped with collapsible parent items:
  - **Dashboard** — top-level item, no children.
  - **Claims** — collapsible parent:
    - Receipts
    - Statements
  - **Admin** — collapsible parent:
    - User Management
    - Entities
- Role-based visibility: unauthorized nav items are **hidden entirely** (not greyed out or disabled).

### 2.2 Header Bar

- Minimal top header bar.
- **Left:** App name / logo.
- **Right:** User avatar + logout dropdown.
- No notifications for MVP.

---

## 3. Role-Based Access

### 3.1 Roles

| Role     | Dashboard | Claims > Receipts | Claims > Statements | Admin > User Management | Admin > Entities |
|----------|-----------|-------------------|---------------------|-------------------------|------------------|
| Admin    | ✅        | ✅                 | ✅                   | ✅                       | ✅                |
| Finance  | ✅        | ✅                 | ✅                   | ❌                       | ❌                |
| Employee | ✅        | ❌                 | ✅                   | ❌                       | ❌                |

### 3.2 Data Scoping

- **Finance:** Can see and manage **all** claims and statements.
- **Employee:** Can see only **their own** statements and can only upload against claims **assigned to them**.
- **Admin:** Sees everything. Superset of Finance + Admin management. Can perform all actions.

### 3.3 Search & Filter

- All users get search and filter capabilities on all tables they can access.
- Search and filters are scoped to the data the user is permitted to see.

---

## 4. Dashboard

The dashboard is role-specific — Admin/Finance users and Employee users see different views.

### 4.1 Admin & Finance Dashboard

**Summary Cards (top row):**

| Card                | Value Description                          | Visual              |
|---------------------|--------------------------------------------|---------------------|
| Total Claims        | Count of all claims                        | Brand blue           |
| Awaiting Statement  | Claims with no statement linked yet        | Amber (warning)      |
| Statements Uploaded | Total statements uploaded                  | Blue                 |
| Verification Failed | Statements with failed verification        | Red (alert)          |

**Verification Status Breakdown:**
- Horizontal bar chart showing count of statements in each verification status: Success, In Progress, Pending Verification, Failed.

**Recent Activity Feed:**
- A timeline of the last 5–10 system events: claim created, statement uploaded, verification successful, verification failed.
- Each entry shows an icon (color-coded by type), description with claim ID, claimant name, and relative timestamp.

**Claims Needing Attention:**
- A mini table surfacing problem claims: verification failures and claims that have been "Awaiting Statement" for an extended period.
- Columns: Claim (ID + description), Claimant, Issue (status badge), Since (date/time), Action button (View Details / View Claim).

### 4.2 Employee Dashboard

**Summary Cards (top row):**

| Card                  | Value Description                                 | Visual              |
|-----------------------|---------------------------------------------------|---------------------|
| My Claims             | Claims assigned to the current user               | Brand blue           |
| Awaiting My Statement | Claims assigned to me still needing a statement   | Amber (warning)      |
| In Progress           | My statements currently being verified            | Blue                 |
| Completed             | My statements with final status (Success + Failed)| Green                |

**My Pending Actions:**
- A list of claims assigned to the employee that are "Awaiting Statement".
- Each item shows Claim ID, description, created date, and an "Upload" button linking directly to the statement upload form.

**My Recent Statements:**
- A mini table of the employee's last 5 statements.
- Columns: Claim (ID + short description), Upload Date, Verification Status badge.

---

## 5. Claims > Receipts

### 7.1 Create Claim Form

A form for the Finance team (or Admin) to create a new claim line item.

| Field      | Type                          | Notes                                      |
|------------|-------------------------------|---------------------------------------------|
| Claim Month | Dropdown (Jan – Dec)          | The month this claim is for.                |
| Claim Year | Dropdown (year list)          | The year this claim is for. Combined with Claim Month to form the claim period. |
| Entity     | Dropdown                      | The legal entity this claim belongs to (e.g. `apd-my`, `apd-sg`, `apd-hk`). Sourced from the Entities admin page. |
| Description | Free text input              | Description of the claim. Default placeholder: "Claim for the month of..." |
| Claimant   | Dropdown (list of active users), **optional** | Can be left empty at creation. Finance assigns the claimant later once receipts have been collected and the responsible person is identified. Can be any role (Admin, Finance, or Employee). |

**On submit:**

- A new claim record is created in the database.
- The Claim ID is auto-generated using the format `YYMM-CLM-XXX`, where `YYMM` is the claim period (year/month) and `XXX` is a running sequence (e.g. `2605-CLM-001` = May 2026, claim 001).
- A dedicated Google Drive folder is automatically generated at the path: `/<claim_id>/receipts`.
- The Google Drive folder link is saved and made accessible from the claims table.

### 7.2 Claims List Table

| Column            | Description                                                        |
|-------------------|--------------------------------------------------------------------|
| Claim ID          | Auto-generated unique identifier using format `YYMM-CLM-XXX` (e.g. `2605-CLM-001`) |
| Description       | Free text description of the claim                                 |
| Period            | The claim's month and year (e.g. "May 2026")                       |
| Entity            | The entity this claim belongs to, displayed as a chip (e.g. `apd-my`) |
| Claimant          | The assigned user (any role). Displays "Unassigned" when not yet set. |
| Status            | `Awaiting Statement` or `Statement Attached` (see below)           |
| Created Date      | Date the claim was created                                         |
| Google Drive Link | Icon/button that opens the claim's Google Drive folder              |
| Edit              | Opens the claim form inline in Edit mode. Allows editing Description and assigning/changing the Claimant. Claim Month, Year, and Entity are immutable because they form the Claim ID. |
| View Statement    | Button to navigate to the linked statement (only visible when status is `Statement Attached`) |

### 7.3 Claim Statuses

| Status               | Meaning                                           |
|----------------------|---------------------------------------------------|
| Awaiting Statement   | No credit card statement has been linked yet       |
| Statement Attached   | A credit card statement has been linked to this claim |

### 7.4 Table Features

- Search bar (searches across claim description, claimant name, claim ID).
- Filter dropdown for status (`Awaiting Statement` / `Statement Attached`).
- Filter dropdown for claimant — two options only: **"All Claimants"** (default) and **"Unassigned"** (surfaces claims that still need a claimant assigned).

### 7.5 Receipt Upload Flow

- Receipt upload is handled **outside the portal**.
- At claim creation, the Finance team may not yet know who the claimant is — the claim can be created without a claimant assigned.
- The Finance team collects receipts directly in the Google Drive folder (via email, chat, or by sharing the folder link with potential claimants).
- Once receipts have been gathered and the responsible person is identified, the Finance team assigns the Claimant by editing the claim.
- The portal only provides access to the Google Drive link — it does not handle receipt file uploads.

---

## 6. Claims > Statements

### 7.1 Statement Upload Form

A form for the claimant (Employee or Finance/Admin) to upload a credit card statement and link it to a claim.

| Field               | Type                                | Notes                                                                 |
|---------------------|-------------------------------------|-----------------------------------------------------------------------|
| File Upload         | File input                          | Accepts: PDF, JPG, PNG. Single file per upload.                       |
| Statement Closing Date | Date picker                      | The closing date of the credit card statement.                        |
| Linked Claim        | Dropdown                            | Shows only claims with `Awaiting Statement` status **and** with a claimant assigned that matches the current user. Enforces one-to-one linking. Unassigned claims do not appear in any user's dropdown. |
| Start verification immediately | Checkbox (unchecked by default) | When checked, queues the statement for verification right after upload (status set to `Queued`). When unchecked, the statement stays at `Pending Verification` until the user manually clicks Start Verification. |

**On submit:**

- The statement file is saved to Google Drive at: `/<claim_id>/statement`.
- The statement record is created in the database, linked to the selected claim.
- The linked claim's status changes from `Awaiting Statement` to `Statement Attached`.
- A verification queue record is created with status:
  - `Queued` — if the "Start verification immediately" checkbox was checked.
  - `Pending Verification` — otherwise (default).

### 7.2 Statements List Table

| Column              | Description                                                        |
|---------------------|--------------------------------------------------------------------|
| Statement ID        | Auto-generated unique identifier                                   |
| Statement Date      | The statement closing date provided during upload                   |
| Linked Claim        | The claim this statement is linked to (Claim ID / Description)      |
| Upload Date         | Date the statement was uploaded                                     |
| Verification Status | Current verification status (see below)                            |

### 7.3 Verification Statuses

| Status                | Meaning                                                            |
|-----------------------|--------------------------------------------------------------------|
| Pending Verification  | Statement uploaded, awaiting the user to start verification. This is the immediate status after upload. The user must explicitly click **Start Verification** to advance to the next stage. |
| Queued                | User has clicked Start Verification. The scheduler will pick this up shortly and send it to Opus. |
| In Progress           | Scheduler has sent the statement to Opus, which is currently running the verification workflow. |
| Success               | Verification completed successfully.                               |
| Failed                | Verification failed.                                                |

### 7.4 Row Actions

| Action              | Condition                          | Description                                    |
|---------------------|-------------------------------------|------------------------------------------------|
| View Details        | Always available                   | Opens a detail view showing statement info and verification details. |
| Start Verification  | Only on `Pending Verification` rows | Manually triggers the verification workflow. Status changes to `Queued`. |

### 7.5 Statement Detail Page

The detail page has two sections:

**Overview Card** — A card at the top displaying: Statement Date, Upload Date, Linked Claim, Claimant, Claim Description, Statement File link, and Google Drive Folder link. A status badge and one of two action buttons (Start Verification or Retry Verification) are shown in the header.

- **Start Verification button** is only visible when the current verification status is `Pending Verification`. Clicking it advances the status to `Queued`.
- **Retry Verification button** is only visible when the current verification status is `Failed` or `Success`. Clicking it sends the statement back through the verification flow.
- No action button is shown when status is `Queued` or `In Progress` — the user waits for the scheduler.

**Verification History** — Below the card, an accordion list of all verification attempts. Each accordion item shows:
- Header: Status badge, Opus Job ID, and timestamp.
- Expanded content: Full Opus response details.
  - `Failed` responses have a red background.
  - `Success` responses have a green background.

### 7.6 Verification Flow

1. User uploads statement → status = `Pending Verification`.
2. User clicks **Start Verification** on the row or detail page → status = `Queued`.
3. Scheduler periodically picks up `Queued` records → sends to Opus → receives `JOB_EXECUTION_ID` → status = `In Progress`.
4. Separate scheduler checks `In Progress` records → queries Opus → status = `Success` or `Failed`.

### 7.7 Table Features

- Search bar (searches across statement ID, linked claim, statement date).
- Filter dropdown for verification status.

---

## 7. Admin > User Management

### 7.1 User List Table

| Column      | Description                                     |
|-------------|--------------------------------------------------|
| Name        | User's full name                                 |
| Email       | User's email address                             |
| Role        | Finance, Employee, or Admin                      |
| Status      | Active or Inactive                               |
| Date Added  | Date the user account was created                |
| Created By  | The admin who created this user account          |

### 7.2 Add User Form

An inline form (full-page view, no modal dialog) with the following fields:

| Field | Type                        | Notes                          |
|-------|-----------------------------|--------------------------------|
| Name  | Text input                  | User's full name               |
| Email | Text input (email format)   | User's email address           |
| Role  | Dropdown                    | Options: Finance, Employee, Admin |

**On submit:**

- User account is created with Active status.
- The user's company email must match their SSO identity to log in.

### 7.3 User Actions

| Action            | Description                                                    |
|-------------------|----------------------------------------------------------------|
| Edit User         | Opens the user form in Edit mode. Allows editing Name, Email, and Role. |
| Toggle Status     | Switch between Active and Inactive (no hard deletes)            |

### 7.4 Table Features

- Search bar (searches across name, email).
- Filter dropdowns for role and status.

---

## 8. Admin > Entities

The Entities page allows Admins to configure the legal entities that own claims (e.g. country-specific business units). Entities are referenced by the Claim creation form.

### 8.1 Entity List Table

| Column      | Description                                                  |
|-------------|--------------------------------------------------------------|
| Entity Code | Short identifier shown as a chip (e.g. `apd-my`, `apd-sg`, `apd-hk`). Lowercase, hyphen-separated. |
| Entity Name | Full legal name of the entity                                |
| Country     | Country the entity is based in                               |
| Status      | Active or Inactive                                           |
| Date Added  | Date the entity was created                                  |
| Created By  | The admin who created this entity                            |

### 8.2 Add Entity Form

An inline form (full-page view, no modal dialog) with the following fields:

| Field       | Type                       | Notes                                          |
|-------------|----------------------------|------------------------------------------------|
| Entity Code | Text input                 | Lowercase, hyphen-separated. Used in claim IDs and dropdowns. |
| Entity Name | Text input                 | Full legal name                                |
| Country     | Dropdown                   | Select country                                 |

### 8.3 Entity Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the entity form inline in Edit mode. Allows editing entity name and country. Entity Code is immutable because it is referenced by existing claim IDs. |
| Toggle Status | Switch between Active and Inactive (no hard deletes). Inactive entities do not appear in the claim creation dropdown. |

### 8.4 Table Features

- Search bar (searches across entity code, entity name).
- Filter dropdown for status.

---

## 9. Empty States

- When a table has no data (e.g. no claims, no statements, no users), display a **friendly empty state** with:
  - A relevant icon/illustration.
  - A contextual message (e.g. "No claims yet").
  - A call-to-action button (e.g. "Create your first claim").
- Do not show a blank or broken-looking table.

---

## 10. General UI Principles

- **Mobile responsive:** Yes — all views must work on mobile devices.
- **CSS framework:** Tailwind CSS.
- **No hard deletes:** Users are deactivated, not deleted, to preserve data integrity.
- **No modal dialogs:** All Add and Edit interactions use full-page inline forms with a "Back to ..." link, never modal pop-ups.
- **File types accepted for statements:** PDF, JPG, PNG.
- **One-to-one linking:** Each statement links to exactly one claim. Each claim can have at most one statement.
- **Claim assignment:** Claims can be created without a claimant assigned (since Finance may not know the responsible person until receipts are collected). Finance assigns the Claimant later by editing the claim. Once assigned, this determines what users can see in their Statements view. A claimant must be assigned before a statement can be linked.

---

## 11. Verification Flow (Background — Not UI)

> Included for context. This flow combines manual user action with automated schedulers.

1. Statement uploaded → status = `Pending Verification`.
2. User clicks **Start Verification** (manual gatekeeper) → status = `Queued`.
3. Scheduler picks up `Queued` records → sends to Opus → receives `JOB_EXECUTION_ID` → status = `In Progress`.
4. Separate scheduler checks `In Progress` records → queries Opus for completion.
5. On completion → status = `Success` or `Failed`.
6. From `Success` or `Failed`, the user can click **Retry Verification** to send the statement back through the flow (returns to `Queued`).
