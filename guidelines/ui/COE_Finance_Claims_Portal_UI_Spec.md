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
    - Departments
    - Classes
- Role-based visibility: unauthorized nav items are **hidden entirely** (not greyed out or disabled).

### 2.2 Header Bar

- Minimal top header bar.
- **Left:** App name / logo.
- **Right:** User avatar + logout dropdown.
- No notifications for MVP.

---

## 3. Role-Based Access

### 3.1 Roles

| Role     | Dashboard | Claims > Receipts | Claims > Statements | Admin > Users | Admin > Entities | Admin > Departments | Admin > Classes |
|----------|-----------|-------------------|---------------------|---------------|------------------|---------------------|-----------------|
| Admin    | ✅        | ✅                 | ✅                   | ✅             | ✅                | ✅                   | ✅               |
| Finance  | ✅        | ✅                 | ✅                   | ❌             | ❌                | ❌                   | ❌               |
| Employee | ✅        | ✅ (own claims)    | ✅                   | ❌             | ❌                | ❌                   | ❌               |

### 3.2 Data Scoping

- **Finance:** Can see and manage **all** claims (including all receipts on those claims) and **all** statements.
- **Employee:** Can see only claims **assigned to them** (where they are the claimant). Within those claims, they can view all receipts attached, but can only edit/delete their own. They can see only their own statements.
- **Admin:** Sees everything. Superset of Finance + Admin management. Can perform all actions.

### 3.2.1 Receipt-Level Permissions

Within a claim that a user can see:

- **Anyone who can see the claim** can add new receipts and view all existing receipts.
- **Receipt edit/delete:** The uploader can always edit/delete their own receipts. Finance and Admin can edit/delete any receipt regardless of who uploaded it (owner + admin override).

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

### 5.1 Create Claim Form

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
- The current user is captured as **Created By** (for accountability).
- A dedicated Google Drive folder is automatically generated at the path: `/<claim_id>/`, with sub-folders `/<claim_id>/receipt/` (for individual receipt files) and `/<claim_id>/statement/` (for the linked statement file).
- The Google Drive folder link is saved and made accessible from the claims table.

### 5.2 Claims List Table

| Column            | Description                                                        |
|-------------------|--------------------------------------------------------------------|
| Claim ID          | Auto-generated unique identifier (`YYMM-CLM-XXX`). Plain text.    |
| Description       | Free text description of the claim                                 |
| Period            | The claim's month and year (e.g. "May 2026")                       |
| Entity            | The entity this claim belongs to, displayed as a chip (e.g. `apd-my`) |
| Claimant          | The assigned user (any role). Displays "Unassigned" when not yet set. |
| Status            | `Awaiting Statement` or `Statement Attached`                       |
| Created Date      | Date the claim was created                                         |
| Details           | Icon button (eye icon) with tooltip "Claim details" that opens the Claim Detail page (see 5.5). |
| Drive             | Icon button (external-link) that opens the claim's Google Drive folder. **Visible to Admin and Finance only** — hidden for Employees, matching the Open in Drive button visibility on the Claim Detail page (see 5.5.1). |

> **Note:** Edit is no longer on the table row. The Edit action lives on the Claim Detail page (see 5.5), reachable by clicking the Details eye icon.

### 5.3 Claim Statuses

| Status               | Meaning                                           |
|----------------------|---------------------------------------------------|
| Awaiting Statement   | No credit card statement has been linked yet       |
| Statement Attached   | A credit card statement has been linked to this claim |

> Claim status is determined **only by statement attachment**. Receipts are independent supporting documents and do not affect claim status.

### 5.4 Table Features

- Search bar (searches across claim description, claimant name, claim ID).
- Filter dropdown for status (`Awaiting Statement` / `Statement Attached`).
- Filter dropdown for claimant — two options only: **"All Claimants"** (default) and **"Unassigned"** (surfaces claims that still need a claimant assigned).
- **Date range filter** — two date pickers ("From" and "To") on the claim's Created Date. Maximum span enforced to **12 months**.
- **Default sort order:** Created Date, descending (newest first).
- **Column sorting:** All data columns are sortable by clicking the column header.
- **Pagination:** 20 rows per page.

### 5.5 Claim Detail Page

Clicking a Claim ID in the table navigates to the Claim Detail page. This page is the home for editing the claim and managing its receipts.

**Page structure:**

1. **Back link** — "← Back to Claims" at the top
2. **Header** — Title "Claim Details" + Claim ID in mono. Status badge on the right.
3. **Action buttons** (in header):
   - **Edit** (secondary, pencil icon) — opens the claim edit form inline. Editable fields: Description and Claimant. Immutable fields: Claim Month, Year, Entity (because they form the Claim ID).
   - **Open in Drive** (secondary, external-link icon) — opens the claim's Google Drive folder
4. **Overview card** showing: Period, Entity, Claimant, Description, Created Date, Created By
5. **Receipts summary card** — three stat tiles:
   - Total Receipts (count)
   - Total Amount in local currency (e.g. MYR 3,420.00)
   - Total Amount in USD (e.g. USD 725.40)
6. **Receipts table** with "Add Receipt" button at the top right.

#### 5.5.1 Role-Based View Variations

The Claim Detail page renders differently based on the viewer's role and ownership relative to the claim:

| Element                       | Admin / Finance | Employee (is claimant) | Employee (not claimant) |
|-------------------------------|-----------------|------------------------|--------------------------|
| Overview card                 | ✅ Visible       | ✅ Visible              | ✅ Visible                |
| Edit button (header)          | ✅ Visible       | ❌ Hidden               | ❌ Hidden                 |
| Open in Drive button (header) | ✅ Visible       | ❌ Hidden               | ❌ Hidden                 |
| Receipts summary totals       | All receipts    | All receipts            | Only their own receipts   |
| Receipts table rows           | All rows        | All rows                | Only rows they uploaded   |
| Add Receipt button            | ✅ Visible       | ✅ Visible              | ✅ Visible                |
| Edit / Delete on receipt rows | Always shown    | Own rows only           | Own rows only             |

**Rationale:** Employees who are claimants on the claim need full visibility into all receipts attached (since the claim is theirs) but they cannot edit claim metadata or access the Drive folder directly — those are Finance/Admin responsibilities. Employees who are *not* the claimant (e.g. another team member who happened to attach a receipt for context) only see what's directly attributable to them, preventing leakage of other people's expenses. Anyone who can see a claim can still add new receipts to it (per Section 3.2.1).

The receipts summary card and table reflect the same filtered dataset — totals always match the rows visible to that user.

### 5.6 Receipts Management

Receipts are individual supporting documents (e.g. restaurant bills, taxi receipts) attached to a claim by the claimant. Multiple receipts can be uploaded per claim. Each receipt is tracked as a distinct record with its own metadata.

#### 5.6.1 Receipts Table (on Claim Detail page)

| Column           | Description                                                  |
|------------------|--------------------------------------------------------------|
| Receipt Date     | The date of the receipt (transaction date).                  |
| Amount           | Two-line display: local amount on top (e.g. "MYR 250.00"), USD equivalent below in smaller muted text (e.g. "≈ USD 53.00"). |
| Department       | Department code chip (e.g. "eng", "sales").                  |
| Class            | Class code chip (e.g. "travel", "meals").                    |
| File             | Icon button that opens the receipt file (in Google Drive)    |
| Uploaded By      | Name of the user who uploaded the receipt                    |
| Actions          | Edit + Delete icon buttons. Visibility is permission-gated (owner + admin override). |

**Table features:**

- Default sort order: Receipt Date, descending (newest first)
- All data columns sortable
- No pagination (typically < 50 receipts per claim)
- No date range filter

#### 5.6.2 Add / Edit Receipt Form (inline, no modal)

When the user clicks "Add Receipt" (top-right of the receipts table) or an Edit pencil on a row, an inline form replaces the receipts table on the same page. The form has a "← Back to Claim" link at the top.

| Field        | Type                          | Notes                                                  |
|--------------|-------------------------------|---------------------------------------------------------|
| Receipt File | File input (PDF, JPG, PNG)    | Single file per receipt. In edit mode, current file is shown above the upload area; leaving empty keeps existing file. |
| Receipt Date | Date picker                   | The transaction date on the receipt.                    |
| Amount       | Decimal input                 | The receipt amount in the claim entity's local currency. The currency code is shown as an inline suffix (e.g. "MYR"). |
| Department   | Dropdown (strict)             | From the Departments admin page. Only Active departments shown. |
| Class        | Dropdown (strict)             | From the Classes admin page. Only Active classes shown.|

All fields are mandatory.

**On submit (Add):**

- A new receipt record is created.
- The file is uploaded to `/<claim_id>/receipt/<receipt_id>_<original_filename>` in Google Drive.
- The current FX rate (local currency → USD) is fetched at this moment, applied to the amount, and **frozen on the record**.
- The receipt stores: local amount, currency code (derived from entity), USD amount, FX rate used, and the uploader's user ID + timestamp.

**On submit (Edit):**

- All fields are editable.
- If the user uploads a new file, the **old file is deleted** from Google Drive and replaced.
- If the user changes the amount, the **FX rate is re-fetched** at edit time and the USD amount is recalculated and re-frozen. The FX rate field is also updated.
- A receipt's `Uploaded By` does **not** change on edit.

#### 5.6.3 Delete Receipt

- Triggered from the Delete icon on a receipt row.
- A simple inline confirm action (no modal): the row enters a confirmation state showing "Delete this receipt? [Confirm] [Cancel]", or a browser-native confirm prompt — implementation can choose.
- On confirm, the receipt record is deleted and its file is **permanently removed** from Google Drive.

#### 5.6.4 Currency and FX Conversion

- The receipt's local currency is **derived from the claim's entity**:
  - `apd-my` → MYR
  - `apd-sg` → SGD
  - `apd-hk` → HKD
  - Future entities should declare their currency on creation (see Section 8 — Entities).
- The USD value is **captured at upload time and frozen** on the receipt record. It is recalculated only when the amount is edited.
- The FX rate used is stored on the receipt record for audit purposes.
- The Receipts summary card on the Claim Detail page shows totals in **both** the local currency and USD.

---

## 6. Claims > Statements

### 6.1 Statement Upload Form

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

### 6.2 Statements List Table

| Column              | Description                                                        |
|---------------------|--------------------------------------------------------------------|
| Statement ID        | Auto-generated unique identifier                                   |
| Statement Date      | The statement closing date provided during upload                   |
| Linked Claim        | The claim this statement is linked to (Claim ID / Description)      |
| Upload Date         | Date the statement was uploaded                                     |
| Verification Status | Current verification status (see below)                            |

### 6.3 Verification Statuses

| Status                | Meaning                                                            |
|-----------------------|--------------------------------------------------------------------|
| Pending Verification  | Statement uploaded, awaiting the user to start verification. This is the immediate status after upload. The user must explicitly click **Start Verification** to advance to the next stage. |
| Queued                | User has clicked Start Verification. The scheduler will pick this up shortly and send it to Opus. |
| In Progress           | Scheduler has sent the statement to Opus, which is currently running the verification workflow. |
| Success               | Verification completed successfully.                               |
| Failed                | Verification failed.                                                |

### 6.4 Row Actions

| Action              | Condition                          | Description                                    |
|---------------------|-------------------------------------|------------------------------------------------|
| View Details        | Always available                   | Opens the detail view. Edits are made from there. |
| Start Verification  | Only on `Pending Verification` rows | Manually triggers the verification workflow. Status changes to `Queued`. |

### 6.4.1 Edit Statement Behavior

The Edit action lives on the **Statement Detail page** (not in the table row). On that page, a secondary **Edit** button appears in the header alongside Start Verification / Retry Verification. Clicking it opens an inline edit form (no modal):

- **All fields are editable:** Statement File (re-upload), Statement Closing Date, and Linked Claim.
- **Re-uploading the file:** The old statement file at `/<claim_id>/statement` is **deleted from Google Drive**, and the new file is uploaded in its place. Only one statement file may exist per claim at any time.
- **Changing the linked claim:** The statement file is **moved** in Google Drive from the previous claim's statement folder (`/<old_claim_id>/statement`) to the new claim's statement folder (`/<new_claim_id>/statement`). No copy is made — the file is relocated.
- **Re-uploading or changing the linked claim resets verification status to `Pending Verification`**. Any prior `Queued`, `In Progress`, `Success`, or `Failed` status is cleared. The Opus verification history is preserved for audit but a new attempt starts fresh.
- **If the linked claim is changed**, the previously linked claim returns to `Awaiting Statement` status, and the new claim moves to `Statement Attached`.
- The "Start verification immediately" checkbox is **not shown in edit mode**, since the user can start verification afterwards from the row or detail page.
- The current file is shown at the top of the form as a reference, with a "View" link. Leaving the file picker empty keeps the existing file (no delete or move triggered on the file itself).

### 6.5 Statement Detail Page

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

### 6.6 Verification Flow

1. User uploads statement → status = `Pending Verification`.
2. User clicks **Start Verification** on the row or detail page → status = `Queued`.
3. Scheduler periodically picks up `Queued` records → sends to Opus → receives `JOB_EXECUTION_ID` → status = `In Progress`.
4. Separate scheduler checks `In Progress` records → queries Opus → status = `Success` or `Failed`.

### 6.7 Table Features

- Search bar (searches across statement ID, linked claim, statement date).
- Filter dropdown for verification status.
- **Date range filter** — two date pickers ("From" and "To") on the Statement Date. Maximum span enforced to **12 months**; the system clamps the "To" date if the user picks a wider range. A "Clear" button resets both fields.
- **Default sort order:** Statement Date, descending (newest first).
- **Column sorting:** All data columns (Statement ID, Statement Date, Linked Claim, Upload Date, Verification) are sortable by clicking the column header. First click sorts ascending, second click toggles to descending. Up/down arrows indicate the active column and direction. Action columns (Actions, Start) are not sortable.
- **Pagination:** 20 rows per page. The footer shows "Showing X–Y of N statements · 20 per page" and Previous / page-number / Next controls.

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
| Currency    | The local currency for this entity (e.g. MYR, SGD, HKD). Used to derive the currency of receipts attached to claims of this entity. |
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
| Currency    | Dropdown (ISO 4217 codes)  | The local currency for this entity. Used for receipts.  |

### 8.3 Entity Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the entity form inline in Edit mode. Allows editing entity name, country, and currency. Entity Code is immutable because it is referenced by existing claim IDs. |
| Toggle Status | Switch between Active and Inactive (no hard deletes). Inactive entities do not appear in the claim creation dropdown. |

### 8.4 Table Features

- Search bar (searches across entity code, entity name).
- Filter dropdown for status.

---

## 9. Admin > Departments

The Departments page allows Admins to configure departments that can be associated with receipts. Departments are referenced by the Receipt add/edit form.

### 9.1 Department List Table

| Column          | Description                                                  |
|-----------------|--------------------------------------------------------------|
| Department Code | Short identifier shown as a chip (e.g. `eng`, `sales`). Lowercase, hyphen-separated. Immutable once created. |
| Department Name | Full name (e.g. "Engineering", "Sales & Marketing").         |
| Status          | Active or Inactive                                           |
| Date Added      | Date the department was created                              |
| Created By      | The admin who created this department                        |

### 9.2 Add Department Form

Inline form with these fields:

| Field           | Type                       | Notes                                          |
|-----------------|----------------------------|------------------------------------------------|
| Department Code | Text input                 | Lowercase, hyphen-separated. Used in receipt records and reporting. |
| Department Name | Text input                 | Full department name                            |

### 9.3 Department Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the department form inline in Edit mode. Allows editing the name. Code is immutable. |
| Toggle Status | Switch between Active and Inactive. Inactive departments do not appear in the receipt form dropdown. |

### 9.4 Table Features

- Search bar (searches across department code, department name).
- Filter dropdown for status.
- Departments are a **single global list shared across all entities**.

---

## 10. Admin > Classes

The Classes page allows Admins to configure classes (e.g. expense categories) that can be associated with receipts. Classes are referenced by the Receipt add/edit form.

### 10.1 Class List Table

| Column     | Description                                                  |
|------------|--------------------------------------------------------------|
| Class Code | Short identifier shown as a chip (e.g. `travel`, `meals`, `office`). Lowercase, hyphen-separated. Immutable once created. |
| Class Name | Full name (e.g. "Travel & Transport", "Meals & Entertainment"). |
| Status     | Active or Inactive                                           |
| Date Added | Date the class was created                                   |
| Created By | The admin who created this class                             |

### 10.2 Add Class Form

Inline form with these fields:

| Field      | Type                       | Notes                                          |
|------------|----------------------------|------------------------------------------------|
| Class Code | Text input                 | Lowercase, hyphen-separated. Used in receipt records and reporting. |
| Class Name | Text input                 | Full class name                                 |

### 10.3 Class Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the class form inline in Edit mode. Allows editing the name. Code is immutable. |
| Toggle Status | Switch between Active and Inactive. Inactive classes do not appear in the receipt form dropdown. |

### 10.4 Table Features

- Search bar (searches across class code, class name).
- Filter dropdown for status.
- Classes are a **single global list shared across all entities**.

---

## 11. Empty States

- When a table has no data (e.g. no claims, no statements, no users), display a **friendly empty state** with:
  - A relevant icon/illustration.
  - A contextual message (e.g. "No claims yet").
  - A call-to-action button (e.g. "Create your first claim").
- Do not show a blank or broken-looking table.

---

## 12. General UI Principles

- **Mobile responsive:** Yes — all views must work on mobile devices.
- **CSS framework:** Tailwind CSS.
- **No hard deletes:** Users are deactivated, not deleted, to preserve data integrity.
- **No modal dialogs:** All Add and Edit interactions use full-page inline forms with a "Back to ..." link, never modal pop-ups.
- **File types accepted for statements:** PDF, JPG, PNG.
- **One-to-one linking:** Each statement links to exactly one claim. Each claim can have at most one statement.
- **Claim assignment:** Claims can be created without a claimant assigned (since Finance may not know the responsible person until receipts are collected). Finance assigns the Claimant later by editing the claim. Once assigned, this determines what users can see in their Statements view. A claimant must be assigned before a statement can be linked.

---

## 13. Verification Flow (Background — Not UI)

> Included for context. This flow combines manual user action with automated schedulers.

1. Statement uploaded → status = `Pending Verification`.
2. User clicks **Start Verification** (manual gatekeeper) → status = `Queued`.
3. Scheduler picks up `Queued` records → sends to Opus → receives `JOB_EXECUTION_ID` → status = `In Progress`.
4. Separate scheduler checks `In Progress` records → queries Opus for completion.
5. On completion → status = `Success` or `Failed`.
6. From `Success` or `Failed`, the user can click **Retry Verification** to send the statement back through the flow (returns to `Queued`).
