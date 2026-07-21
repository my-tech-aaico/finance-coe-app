# COE Finance Claims Portal — UI Specification (v2)

> This document is the v2 source of truth for frontend development. It supersedes `COE_Finance_Claims_Portal_UI_Spec.md`.
>
> **What changed from v1** (summary — details in each section):
> 1. **New role: Credit Card Holder (CCH)** and a reworked, narrower access model for Employee.
> 2. **New Admin menu: Project Code** — a Google-Sheet-synced list (Code + Name) with an **Active/Inactive status** toggled in the portal (no manual Add/Edit/Delete). Added as an **active-only, searchable** dropdown on the receipt form.
> 3. **Team Split** — a Team Split sits under a Class (one Class → many Team Splits; some Classes have none). It is **not** a top-level menu; Team Splits are managed **inside the Class edit page** (`/admin/classes/<classId>/edit`). Added as a class-dependent dropdown on the receipt form.
> 4. **Receipt no longer captures an amount.** Amount, currency, and FX are removed from the portal UI. Receipt fields are now File, Department, Class, Team Split, Project Code. **Receipt Date is removed** (table sorts on `uploaded_at`).
> 5. The Receipts summary card shows **count only**; the Amount column and the two money tiles are removed.
>
> **Callouts marked "⚠️ Assumption (confirm)"** are downstream rules the requirements did not fully specify; they are best-guess defaults and can be changed.

---

## 1. Authentication

*(Unchanged from v1.)*

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
    - **Project Code** *(new — placed after Entities)*
    - Departments
    - Classes
- Team Split is **not** a nav item — it is managed within the Class edit page (see Section 12).
- Role-based visibility: unauthorized nav items are **hidden entirely** (not greyed out or disabled). A parent group is shown only if the user can see at least one child. See the visibility matrix in Section 3.1.

### 2.2 Header Bar

- Minimal top header bar.
- **Left:** App name / logo.
- **Right:** User avatar + logout dropdown.
- No notifications for MVP.

---

## 3. Role-Based Access

There are **four** roles: **Admin**, **Finance**, **Credit Card Holder (CCH)**, and **Employee**.

- **Admin** — full access to everything.
- **Finance** — all Receipts and all Statements functions, plus the **Classes** (which is where Team Splits are managed) and **Project Code** admin config pages. No access to User Management, Entities, or Departments.
- **Credit Card Holder (CCH)** — the person who paid on a company credit card and is responsible for uploading the matching statement. Can view **all** claims and receipts (including claims not related to them), add receipts, and manage their **own** statements end to end.
- **Employee** — the claimant on a claim. Can view and add receipts on claims where they are the claimant. **No access to Statements.** The Dashboard nav redirects them to the Receipts list.

### 3.1 Role → Menu Visibility Matrix

| Menu item              | Admin | Finance | Credit Card Holder | Employee |
|------------------------|:-----:|:-------:|:------------------:|:--------:|
| Dashboard              | ✅    | ✅      | ✅                 | ➡️ redirects to Receipts |
| Claims > Receipts      | ✅    | ✅      | ✅                 | ✅        |
| Claims > Statements    | ✅    | ✅      | ✅                 | ❌        |
| Admin > User Management| ✅    | ❌      | ❌                 | ❌        |
| Admin > Entities       | ✅    | ❌      | ❌                 | ❌        |
| Admin > Project Code   | ✅    | ✅      | ❌                 | ❌        |
| Admin > Departments    | ✅    | ❌      | ❌                 | ❌        |
| Admin > Classes        | ✅    | ✅      | ❌                 | ❌        |

> The **Admin** parent group is visible to Finance (it exposes Project Code and Classes only). It is hidden for CCH and Employee.
> **Team Split** is not a menu — it is managed inside the Class edit page, so anyone who can open a Class (Admin, Finance) can manage its Team Splits (see Section 12).

### 3.1.1 Role → Function Matrix

| Function                                   | Admin | Finance | Credit Card Holder | Employee |
|--------------------------------------------|:-----:|:-------:|:------------------:|:--------:|
| Receipts: Create Claim                     | ✅    | ✅      | ❌                 | ❌        |
| Receipts: Edit Claim                       | ✅    | ✅      | ❌                 | ❌        |
| Receipts: View Claim                       | ✅    | ✅      | ✅                 | ✅ (own claims) |
| Receipts: View Receipt                     | ✅    | ✅      | ✅                 | ✅        |
| Receipts: Add Receipt                      | ✅    | ✅      | ✅                 | ✅        |
| Receipts: Edit / Delete Receipt            | ✅ (any) | ✅ (any) | ✅ (own) | ✅ (own) |
| Statements: Upload                         | ✅    | ✅      | ✅                 | ❌        |
| Statements: View list / View Details       | ✅    | ✅      | ✅ (own uploads)   | ❌        |
| Statements: Edit                           | ✅    | ✅      | ✅ (own uploads)   | ❌        |
| Statements: Start / Retry Verification     | ✅    | ✅      | ✅ (own uploads)   | ❌        |
| Statements: Delete                         | 🚧 deferred — not implemented in v2 (see §6.8) |||

### 3.2 Data Scoping

- **Admin:** Sees everything. Can perform all actions.
- **Finance:** Can see and manage **all** claims (including all receipts on those claims) and **all** statements.
- **Credit Card Holder:** Can see **all** claims and **all** receipts, including claims not related to them (they need full visibility to decide which claim a statement belongs to). Can add receipts to any claim and edit/delete their own receipts. On the Statements list they see **only statements they uploaded**.
- **Employee:** Is the claimant. Can see only claims **assigned to them** (where they are the claimant). Within those claims they can view all receipts attached, add receipts, and edit/delete their own. **No Statements access.**

### 3.2.1 Receipt-Level Permissions

Within a claim that a user can see:

- **Anyone who can see the claim** can add new receipts and view all existing receipts on it.
- **Receipt edit/delete:** The uploader can always edit/delete their own receipts (this applies to CCH and Employee). Finance and Admin can edit/delete any receipt regardless of who uploaded it (owner + admin override).

### 3.3 Search & Filter

- All users get search and filter capabilities on all tables they can access.
- Search and filters are scoped to the data the user is permitted to see.

---

## 4. Dashboard

The dashboard is role-specific.

### 4.1 Admin & Finance Dashboard

*(Unchanged from v1.)*

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

### 4.2 Credit Card Holder Dashboard

The CCH dashboard is statement-focused and scoped to statements they uploaded.

**Summary Cards (top row):**

| Card                  | Value Description                                     | Visual              |
|-----------------------|------------------------------------------------------|---------------------|
| My Statements         | Statements I have uploaded                            | Brand blue           |
| Awaiting Verification | My statements at `Pending Verification` (need Start) | Amber (warning)      |
| In Progress           | My statements currently being verified (`Queued` + `In Progress`) | Blue     |
| Completed             | My statements with final status (Success + Failed)   | Green                |

**My Pending Actions:**
- A list of the CCH's own statements that need action:
  - `Pending Verification` → shows a **Start Verification** action.
  - `Failed` → shows a **Retry Verification** action.
- Each item shows Statement ID, Linked Claim (ID + short description), and the relevant action button.
- Scope: the CCH's **own** statements only.

**My Recent Statements:**
- A mini table of the CCH's last 5 uploaded statements.
- Columns: Statement ID, Linked Claim (ID + short description), Upload Date, Verification Status badge.

### 4.3 Employee — No Dashboard

Employees do not have a summary-card dashboard. Selecting **Dashboard** in the nav (or logging in) redirects them to the **Receipts** list, scoped to claims where they are the claimant.

---

## 5. Claims > Receipts

### 5.1 Create Claim Form

A form for Finance (or Admin) to create a new claim line item. *(Create/Edit claim is Admin/Finance only — the entry point to this form, the "New Claim" button, is hidden for CCH and Employee.)*

| Field      | Type                          | Notes                                      |
|------------|-------------------------------|---------------------------------------------|
| Claim Month | Dropdown (Jan – Dec)          | The month this claim is for.                |
| Claim Year | Dropdown (year list)          | The year this claim is for. Combined with Claim Month to form the claim period. |
| Entity     | Dropdown                      | The legal entity this claim belongs to (e.g. `apd-my`, `apd-sg`, `apd-hk`). Sourced from the Entities admin page. |
| Description | Free text input              | Description of the claim. Default placeholder: "Claim for the month of..." |
| Claimant   | Dropdown (list of active users), **optional** | Can be left empty at creation. Finance assigns the claimant later once receipts have been collected and the responsible person is identified. Can be **any active user of any role**. |

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
| Drive             | Icon button (external-link) that opens the claim's Google Drive folder. **Visible to Admin and Finance only** — hidden for CCH and Employees, matching the Open in Drive button visibility on the Claim Detail page (see 5.5.1). |

**Scoping:** Admin/Finance/CCH see all claims. Employee sees only claims where they are the claimant.

> **"New Claim" button:** The Create Claim button (top-right of the Receipts/Claims page) is **visible to Admin and Finance only** — hidden for CCH and Employee, per the Create Claim function in Section 3.1.1. This applies to the empty-state "Create your first claim" CTA as well (see Section 13).

> **Note:** Edit is not on the table row. The Edit action lives on the Claim Detail page (Admin/Finance only — see 5.5).

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

Clicking the Details eye icon navigates to the Claim Detail page. This page is the home for editing the claim (Admin/Finance) and managing its receipts (all roles who can see the claim).

**Page structure:**

1. **Back link** — "← Back to Claims" at the top
2. **Header** — Title "Claim Details" + Claim ID in mono. Status badge on the right.
3. **Action buttons** (in header):
   - **Edit** (secondary, pencil icon) — Admin/Finance only. Opens the claim edit form inline. Editable fields: Description and Claimant. Immutable fields: Claim Month, Year, Entity (because they form the Claim ID).
   - **Open in Drive** (secondary, external-link icon) — Admin/Finance only. Opens the claim's Google Drive folder.
4. **Overview card** showing: Period, Entity, Claimant, Description, Created Date, Created By
5. **Receipts summary card** — a single stat tile:
   - **Total Receipts (count)**
   - *(The v1 "Total Amount local" and "Total Amount USD" tiles are removed — see Section 5.6.4.)*
6. **Receipts table** with "Add Receipt" button at the top right.

#### 5.5.1 Role-Based View Variations

| Element                       | Admin / Finance | Credit Card Holder | Employee (claimant) |
|-------------------------------|:---------------:|:------------------:|:-------------------:|
| Overview card                 | ✅ Visible       | ✅ Visible          | ✅ Visible           |
| Edit button (header)          | ✅ Visible       | ❌ Hidden           | ❌ Hidden            |
| Open in Drive button (header) | ✅ Visible       | ❌ Hidden           | ❌ Hidden            |
| Receipts summary (count)      | All receipts    | All receipts       | All receipts on the claim |
| Receipts table rows           | All rows        | All rows           | All rows on the claim |
| Add Receipt button            | ✅ Visible       | ✅ Visible          | ✅ Visible           |
| Edit / Delete on receipt rows | Always shown    | Own rows only      | Own rows only        |

> **Rationale:** Anyone who can see a claim sees all receipts on it and can add new receipts. Editing/deleting a receipt is restricted to its uploader, plus Finance/Admin override. Employees can only reach claims where they are the claimant, so they always see the full receipt set for their own claims. CCH can reach every claim (including ones not related to them) but cannot edit claim metadata or access the Drive folder — those remain Finance/Admin responsibilities.

### 5.6 Receipts Management

Receipts are individual supporting documents (e.g. restaurant bills, taxi receipts) attached to a claim. Multiple receipts can be uploaded per claim. Each receipt is tracked as a distinct record with its own metadata.

> **v2 change:** Receipts no longer capture a monetary amount. Amount/currency/FX have moved to a separate system and are out of scope for the portal.

#### 5.6.1 Receipts Table (on Claim Detail page)

| Column           | Description                                                  |
|------------------|--------------------------------------------------------------|
| Uploaded         | The receipt's `uploaded_at` timestamp. Used as the table's sort key. |
| Department       | Department code chip (e.g. "eng", "sales").                  |
| Class            | Class code chip (e.g. "travel", "meals").                   |
| Team Split       | Team Split code chip (e.g. "team-a"). Blank if the class has no team splits. *(new)* |
| Project Code     | Project code chip. *(new)*                                    |
| File             | Icon button that opens the receipt file (in Google Drive).   |
| Uploaded By      | Name of the user who uploaded the receipt.                   |
| Actions          | Edit + Delete icon buttons. Visibility is permission-gated (owner + admin override). |

> The v1 **Amount** column (local + USD two-line display) is **removed**.

**Table features:**

- **Default sort order:** Uploaded (`uploaded_at`), descending (newest first). *(Replaces the v1 Receipt Date sort.)*
- All data columns sortable.
- No pagination (typically < 50 receipts per claim).
- No date range filter.

#### 5.6.2 Add / Edit Receipt Form (inline, no modal)

Reached at `/claims/receipt/<claimId>?action=add-receipt` and `/claims/receipts/<claimId>?action=edit-receipt&rid=<receiptId>`. When the user clicks "Add Receipt" (top-right of the receipts table) or an Edit pencil on a row, an inline form replaces the receipts table on the same page. The form has a "← Back to Claim" link at the top.

| Field        | Type                          | Notes                                                  |
|--------------|-------------------------------|---------------------------------------------------------|
| Receipt File | File input (PDF, JPG, PNG)    | Single file per receipt. In edit mode, current file is shown above the upload area; leaving empty keeps existing file. |
| Department   | Dropdown (strict)             | From the Departments admin page. Only Active departments shown. |
| Class        | Dropdown (strict)             | From the Classes admin page. Only Active classes shown. |
| Team Split   | Dropdown (strict, class-dependent) | From the Team Splits configured under the selected Class (managed in the Class edit page). Only **Active** Team Splits shown. **Greyed out / disabled until a Class is selected.** See rules below. *(new)* |
| Project Code | Dropdown (strict, **searchable**) | From the Project Code admin list. **Only Active codes are selectable**; supports **type-to-search by code or name** (the list can be large). Editing a receipt whose code was later deactivated shows it as "(inactive)" and keeps it on save. *(new)* |

> **Removed from v1:** the **Amount** field and the **Receipt Date** field are no longer collected.

**Team Split field rules:**

- Disabled until a Class is chosen. Once a Class is selected, it populates with the Team Splits belonging to that Class.
- **Mandatory when the selected Class has at least one (active) Team Split.**
- **Optional (and effectively empty) when the selected Class has no Team Splits.** The control may remain disabled/empty in that case.
- **On Class change (add or edit):** the Team Split selection is **reset** and must be re-selected. If the newly selected Class has no Team Splits, Team Split becomes optional again.

**Mandatory fields:** File, Department, Class, Project Code are always required. Team Split is required conditionally (per the rule above).

**On submit (Add):**

- A new receipt record is created.
- The file is uploaded to `/<claim_id>/receipt/<receipt_id>_<original_filename>` in Google Drive.
- The receipt stores: department code, class code, team split code (nullable), project code, and the uploader's user ID + `uploaded_at` timestamp.

> **FX note:** The v1 currency/FX machinery (local amount, currency code, USD amount, FX rate freeze) is **retained in the data model/back end but not exercised** in v2 — no amount is collected, so no conversion occurs. It is left in place for possible future use.

**On submit (Edit):**

- All fields are editable.
- If the user uploads a new file, the **old file is deleted** from Google Drive and replaced.
- If the user changes the Class, the Team Split must be re-selected (see rules above).
- A receipt's `Uploaded By` does **not** change on edit.

#### 5.6.3 Delete Receipt

- Triggered from the Delete icon on a receipt row (owner, or Finance/Admin override).
- A simple inline confirm action (no modal): the row enters a confirmation state showing "Delete this receipt? [Confirm] [Cancel]", or a browser-native confirm prompt — implementation can choose.
- On confirm, the receipt record is deleted and its file is **permanently removed** from Google Drive.

#### 5.6.4 Currency and FX Conversion — Deprecated in v2

- Receipts no longer capture an amount, so no currency or FX conversion is performed in the portal.
- The Receipts summary card shows **Total Receipts (count) only**.
- The **Entity → Currency** field (Section 8) is likewise retained but **unused** in v2.

---

## 6. Claims > Statements

> **Access:** Statements are visible to Admin, Finance, and Credit Card Holder. **Employees have no access to Statements.** CCH sees only statements they uploaded.

### 6.1 Statement Upload Form

A form for the CCH (or Finance/Admin) to upload a credit card statement and link it to a claim.

| Field               | Type                                | Notes                                                                 |
|---------------------|-------------------------------------|-----------------------------------------------------------------------|
| File Upload         | File input                          | Accepts: PDF, JPG, PNG. Single file per upload.                       |
| Statement Closing Date | Date picker                      | The closing date of the credit card statement.                        |
| Linked Claim        | Dropdown                            | Shows **all** claims with `Awaiting Statement` status. Enforces one-to-one linking. The uploader chooses which claim the statement belongs to. |
| Start verification immediately | Checkbox (unchecked by default) | When checked, queues the statement for verification right after upload (status set to `Queued`). When unchecked, the statement stays at `Pending Verification` until the user manually clicks Start Verification. |

> **v2 change:** The v1 rule that the Linked Claim dropdown only showed claims whose claimant matched the current user is **removed**. CCH/Finance/Admin see all `Awaiting Statement` claims and pick the correct one.
>
> **v2 change:** A claim does **not** need a claimant assigned before a statement can be linked to it (the v1 "claimant must be assigned first" rule is relaxed, since the uploader is now the CCH and is no longer required to equal the claimant).

**On submit:**

- The statement file is saved to Google Drive at: `/<claim_id>/statement`.
- The statement record is created in the database, linked to the selected claim, and stamped with the uploader's user ID.
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

**Scoping:** Admin/Finance see all statements. CCH sees only statements they uploaded.

### 6.3 Verification Statuses

| Status                | Meaning                                                            |
|-----------------------|--------------------------------------------------------------------|
| Pending Verification  | Statement uploaded, awaiting the user to start verification. This is the immediate status after upload. The user must explicitly click **Start Verification** to advance. |
| Queued                | User has clicked Start Verification. The scheduler will pick this up shortly and send it to Opus. |
| In Progress           | Scheduler has sent the statement to Opus, which is currently running the verification workflow. |
| Success               | Verification completed successfully.                               |
| Failed                | Verification failed.                                                |

### 6.4 Row Actions

| Action              | Condition                          | Description                                    |
|---------------------|-------------------------------------|------------------------------------------------|
| View Details        | Always available                   | Opens the detail view. Edits are made from there. |
| Start Verification  | Only on `Pending Verification` rows | Manually triggers the verification workflow. Status changes to `Queued`. Available to CCH (own), Finance, Admin. |

### 6.4.1 Edit Statement Behavior

The Edit action lives on the **Statement Detail page** (not in the table row) and is available to the statement's uploader (CCH), Finance, and Admin. On that page, a secondary **Edit** button appears in the header alongside Start Verification / Retry Verification. Clicking it opens an inline edit form (no modal):

- **All fields are editable:** Statement File (re-upload), Statement Closing Date, and Linked Claim.
- **Re-uploading the file:** The old statement file at `/<claim_id>/statement` is **deleted from Google Drive**, and the new file is uploaded in its place. Only one statement file may exist per claim at any time.
- **Changing the linked claim:** The statement file is **moved** in Google Drive from the previous claim's statement folder (`/<old_claim_id>/statement`) to the new claim's statement folder (`/<new_claim_id>/statement`). No copy is made.
- **Re-uploading or changing the linked claim resets verification status to `Pending Verification`.** Any prior `Queued`, `In Progress`, `Success`, or `Failed` status is cleared. The Opus verification history is preserved for audit but a new attempt starts fresh.
- **If the linked claim is changed**, the previously linked claim returns to `Awaiting Statement` status, and the new claim moves to `Statement Attached`.
- The "Start verification immediately" checkbox is **not shown in edit mode**.
- The current file is shown at the top of the form as a reference, with a "View" link. Leaving the file picker empty keeps the existing file.

### 6.5 Statement Detail Page

**Overview Card** — A card at the top displaying: Statement Date, Upload Date, Linked Claim, Claimant, Claim Description, Statement File link, and Google Drive Folder link. A status badge and one of two action buttons (Start Verification or Retry Verification) are shown in the header.

- **Start Verification button** is only visible when the current verification status is `Pending Verification`. Clicking it advances the status to `Queued`.
- **Retry Verification button** is only visible when the current verification status is `Failed` or `Success`. Clicking it sends the statement back through the verification flow.
- No action button is shown when status is `Queued` or `In Progress` — the user waits for the scheduler.
- Start/Retry are available to the uploader (CCH), Finance, and Admin.

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
- **Column sorting:** All data columns are sortable. First click sorts ascending, second toggles descending. Up/down arrows indicate the active column and direction. Action columns are not sortable.
- **Pagination:** 20 rows per page. The footer shows "Showing X–Y of N statements · 20 per page" and Previous / page-number / Next controls.

### 6.8 Delete Statement — Deferred

Delete Statement was raised for CCH/Finance/Admin but its behavior (Drive file removal, reverting the claim to `Awaiting Statement`, verification-history handling, trigger location) is **not yet defined**. It is **out of scope for v2** and intentionally omitted pending clarification.

---

## 7. Admin > User Management

*(Visible to Admin only. Unchanged from v1 except the Role dropdown now includes Credit Card Holder.)*

### 7.1 User List Table

| Column      | Description                                     |
|-------------|--------------------------------------------------|
| Name        | User's full name                                 |
| Email       | User's email address                             |
| Role        | Admin, Finance, Credit Card Holder, or Employee  |
| Status      | Active or Inactive                               |
| Date Added  | Date the user account was created                |
| Created By  | The admin who created this user account          |

### 7.2 Add User Form

An inline form (full-page view, no modal dialog):

| Field | Type                        | Notes                          |
|-------|-----------------------------|--------------------------------|
| Name  | Text input                  | User's full name               |
| Email | Text input (email format)   | User's email address           |
| Role  | Dropdown                    | Options: Admin, Finance, Credit Card Holder, Employee |

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

*(Visible to Admin only. Unchanged from v1. Note: the Currency field is retained but no longer used by receipts — see Section 5.6.4.)*

### 8.1 Entity List Table

| Column      | Description                                                  |
|-------------|--------------------------------------------------------------|
| Entity Code | Short identifier shown as a chip (e.g. `apd-my`, `apd-sg`, `apd-hk`). Lowercase, hyphen-separated. |
| Entity Name | Full legal name of the entity                                |
| Country     | Country the entity is based in                               |
| Currency    | The local currency for this entity (e.g. MYR, SGD, HKD). **Retained but unused in v2.** |
| Status      | Active or Inactive                                           |
| Date Added  | Date the entity was created                                  |
| Created By  | The admin who created this entity                            |

### 8.2 Add Entity Form

| Field       | Type                       | Notes                                          |
|-------------|----------------------------|------------------------------------------------|
| Entity Code | Text input                 | Lowercase, hyphen-separated. Used in claim IDs and dropdowns. |
| Entity Name | Text input                 | Full legal name                                |
| Country     | Dropdown                   | Select country                                 |
| Currency    | Dropdown (ISO 4217 codes)  | Retained for future use.                        |

### 8.3 Entity Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the entity form inline in Edit mode. Allows editing entity name, country, and currency. Entity Code is immutable (referenced by existing claim IDs). |
| Toggle Status | Switch between Active and Inactive (no hard deletes). Inactive entities do not appear in the claim creation dropdown. |

### 8.4 Table Features

- Search bar (searches across entity code, entity name).
- Filter dropdown for status.

---

## 9. Admin > Project Code *(new)*

The Project Code page exposes the list of project codes used on receipts. The list is **synced from a master Google Sheet** (a scheduled/triggered sync job), so **Add / Edit / Delete are not available in the portal**. What the portal **does** control is each code's **Active/Inactive status** via an Activate/Deactivate toggle. It is referenced by the Receipt add/edit form.

> **Visibility:** Admin and Finance. **Sync note:** codes and names come from the Google Sheet; the sync only ever **inserts new codes (as Active)** and **updates names** — it never deactivates or deletes. **Deactivation is a manual portal action.**

### 9.1 Project Code List Table

| Column       | Description                                            |
|--------------|--------------------------------------------------------|
| Project Code | Short identifier shown as a chip (uppercase, e.g. `PRJ-100`). |
| Project Name | Full project name.                                     |
| Status       | Active or Inactive — the code's own status, toggled per row (see 9.2). Only **Active** codes appear in the receipt form dropdown. *(new)* |

> Add / Edit / Delete remain unavailable — the Google Sheet is the source of truth for the code list. Only **status** is managed here.

### 9.2 Actions

| Action                | Description                                              |
|-----------------------|----------------------------------------------------------|
| Deactivate / Activate | Toggles the project code's own status. **A confirmation popup is shown first** — e.g. *"Are you sure you want to deactivate/activate this project code?"* — and the toggle only applies on confirm. There is no hard delete/Remove (consistent with the "no hard deletes" principle, Section 14). Inactive codes do not appear in the receipt form dropdown. |

> No Add / Edit / Delete — those are owned by the Google-Sheet sync.

### 9.3 Table Features

- Search bar (searches across project code, project name).
- Filter dropdown for status (Active / Inactive).
- No add/edit/delete controls (status toggle only).

### 9.4 Use on the Receipt Form

- Project Code appears as a **mandatory, searchable dropdown** on the Add/Edit Receipt form (Section 5.6.2). **Only Active project codes are selectable**; the field supports **type-to-search by code or name** (the list can be large — 1000+ codes). When editing a receipt whose linked code was later deactivated, that code is still shown (labelled "(inactive)") and preserved on save, but it cannot be newly selected.

---

## 10. Admin > Departments

*(Visible to Admin only. Unchanged from v1.)*

### 10.1 Department List Table

| Column          | Description                                                  |
|-----------------|--------------------------------------------------------------|
| Department Code | Short identifier shown as a chip (e.g. `eng`, `sales`). Lowercase, hyphen-separated. Immutable once created. |
| Department Name | Full name (e.g. "Engineering", "Sales & Marketing").         |
| Status          | Active or Inactive                                           |
| Date Added      | Date the department was created                              |
| Created By      | The admin who created this department                        |

### 10.2 Add Department Form

| Field           | Type                       | Notes                                          |
|-----------------|----------------------------|------------------------------------------------|
| Department Code | Text input                 | Lowercase, hyphen-separated.                    |
| Department Name | Text input                 | Full department name                            |

### 10.3 Department Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the department form inline in Edit mode. Allows editing the name. Code is immutable. |
| Toggle Status | Switch between Active and Inactive. Inactive departments do not appear in the receipt form dropdown. |

### 10.4 Table Features

- Search bar (searches across department code, department name).
- Filter dropdown for status.
- Departments are a **single global list shared across all entities**.

---

## 11. Admin > Classes

*(Visible to Admin and Finance.)*

### 11.1 Class List Table

| Column     | Description                                                  |
|------------|--------------------------------------------------------------|
| Class Code | Short identifier shown as a chip (e.g. `travel`, `meals`, `office`). Lowercase, hyphen-separated. Immutable once created. |
| Class Name | Full name (e.g. "Travel & Transport", "Meals & Entertainment"). |
| Status     | Active or Inactive                                           |
| Date Added | Date the class was created                                   |
| Created By | The admin who created this class                             |

### 11.2 Add Class Form

| Field      | Type                       | Notes                                          |
|------------|----------------------------|------------------------------------------------|
| Class Code | Text input                 | Lowercase, hyphen-separated.                    |
| Class Name | Text input                 | Full class name                                 |

### 11.3 Class Actions

| Action        | Description                                              |
|---------------|----------------------------------------------------------|
| Edit          | Opens the **Class edit page** (`/admin/classes/<classId>/edit`). Allows editing the name (Code is immutable) **and managing the Class's Team Splits** — see Section 11.5 / Section 12. |
| Toggle Status | Switch between Active and Inactive. Inactive classes — and therefore all of their Team Splits — do not appear in the receipt form dropdowns. |

### 11.4 Table Features

- Search bar (searches across class code, class name).
- Filter dropdown for status.
- Classes are a **single global list shared across all entities**.

### 11.5 Class Edit Page

Reached from the Class row Edit action at `/admin/classes/<classId>/edit`. The page has two parts:

1. **Class fields** — editable **Name** (Code immutable), following the inline no-modal pattern.
2. **Team Splits panel** — the list of Team Splits belonging to this Class, an **"Add Team Split"** button, and per-row **Edit** and **Deactivate/Activate** actions. See Section 12 for the full behaviour.

---

## 12. Team Splits (managed within a Class)

A **Team Split belongs to exactly one Class**. One Class can have many Team Splits; some Classes have none. Team Splits are **not** a standalone Admin page — they are managed **inside the Class edit page** (`/admin/classes/<classId>/edit`, Section 11.5). Whoever can open a Class (Admin, Finance) can manage its Team Splits. Team Splits are referenced by the Receipt add/edit form (class-dependent).

### 12.1 Team Splits List (on the Class edit page)

Scoped to the current Class (no Class column — the parent Class is implicit from the page).

| Column          | Description                                                  |
|-----------------|--------------------------------------------------------------|
| Team Split Code | Short identifier shown as a chip. Lowercase, hyphen-separated. **Unique within its parent Class** (the same code may exist under a different class). Immutable once created. |
| Team Split Name | Full name.                                                   |
| Status          | Active or Inactive — the Team Split's **own** status, toggled per row (see 12.3). A Team Split is offered on the receipt form only when it is Active **and** its parent Class is Active. |
| Date Added      | Date the team split was created                              |
| Created By      | The admin who created this team split                        |

An **"Add Team Split"** button sits at the top of the list; each row has **Edit** and **Deactivate/Activate** actions.

### 12.2 Add Team Split Form (inline, no modal)

Opened by the "Add Team Split" button on the Class edit page. The parent Class is the Class being edited — there is **no Class dropdown**.

| Field           | Type                       | Notes                                                     |
|-----------------|----------------------------|-----------------------------------------------------------|
| Team Split Code | Text input                 | Lowercase, hyphen-separated. Must be unique within this Class. |
| Team Split Name | Text input                 | Full name.                                                |

New Team Splits are created **Active**.

### 12.3 Team Split Actions

| Action              | Description                                              |
|---------------------|----------------------------------------------------------|
| Edit                | Opens the form inline in Edit mode. **Only the Name is editable.** Team Split Code and parent Class are immutable. |
| Deactivate / Activate | Toggles the Team Split's own status. **A confirmation popup is shown first** — e.g. *"Are you sure you want to deactivate/activate this team split from the class?"* — and the toggle only applies on confirm. There is no hard delete/Remove (consistent with the "no hard deletes" principle, Section 14). Inactive Team Splits do not appear in the receipt form dropdown. |

### 12.4 List Features

- Search bar (searches across team split code, team split name) — optional for a small per-class list.
- Filter dropdown for status (the Team Split's own Active/Inactive).
- *(No "filter by Class" — the list is already scoped to one Class.)*

### 12.5 Use on the Receipt Form

- Team Split appears on the Add/Edit Receipt form as a **class-dependent dropdown** (Section 5.6.2):
  - Disabled until a Class is selected; then populated with the **Active** Team Splits of that Class (Active = the Team Split's own status is Active and the Class is Active).
  - **Mandatory** when the selected Class has at least one active Team Split.
  - **Optional** when the selected Class has no active Team Splits.
  - Resets and must be re-selected whenever the Class changes.

---

## 13. Empty States

- When a table has no data (e.g. no claims, no statements, no users, no team splits), display a **friendly empty state** with:
  - A relevant icon/illustration.
  - A contextual message (e.g. "No claims yet").
  - A call-to-action button where applicable (e.g. "Create your first claim"). Sync-managed lists with no manual create (e.g. Project Code) show the message without a create CTA. **The empty-state CTA respects role permissions** — e.g. the claims "Create your first claim" button is shown only to Admin/Finance (hidden for CCH/Employee), matching Section 5.2.
- Do not show a blank or broken-looking table.

---

## 14. General UI Principles

- **Mobile responsive:** Yes — all views must work on mobile devices.
- **CSS framework:** Tailwind CSS.
- **No hard deletes:** Users, entities, departments, classes, and team splits are deactivated, not deleted.
- **No modal dialogs:** All Add and Edit interactions use full-page inline forms with a "Back to ..." link, never modal pop-ups. (A lightweight **confirmation prompt** — e.g. a browser-native confirm — is allowed for destructive/state-changing toggles, such as receipt delete and Team Split Deactivate/Activate.)
- **File types accepted for statements and receipts:** PDF, JPG, PNG.
- **One-to-one linking:** Each statement links to exactly one claim. Each claim can have at most one statement.
- **Claim assignment:** Claims can be created without a claimant. Finance assigns the Claimant later by editing the claim. The claimant can be any active user. The Employee-role claimant determines what an Employee can see in Receipts.
- **Receipts carry no amount in v2:** Amount/currency/FX are handled by a separate system. Receipt fields are File, Department, Class, Team Split, Project Code.

---

## 15. Verification Flow (Background — Not UI)

> Included for context. This flow combines manual user action with automated schedulers.

1. Statement uploaded → status = `Pending Verification`.
2. User (CCH / Finance / Admin) clicks **Start Verification** → status = `Queued`.
3. Scheduler picks up `Queued` records → sends to Opus → receives `JOB_EXECUTION_ID` → status = `In Progress`.
4. Separate scheduler checks `In Progress` records → queries Opus for completion.
5. On completion → status = `Success` or `Failed`.
6. From `Success` or `Failed`, the user can click **Retry Verification** to send the statement back through the flow (returns to `Queued`).

---

## Appendix A — Decisions & Deferred Items

Confirmed during the v2 review:

1. **CCH "My Pending Actions" scope** (§4.2) — **Confirmed:** scoped to the CCH's own statements that need Start/Retry Verification.
2. **Statement linkage without a claimant** (§6.1) — **Confirmed:** the v1 "claimant must be assigned first" rule is relaxed; a statement can be linked to any `Awaiting Statement` claim.

3. **Team Split relocation** (§11.5, §12) — **Confirmed:** Team Split is no longer a standalone Admin menu/page. It is managed **within the Class edit page** (`/admin/classes/<classId>/edit`): a list of the Class's Team Splits with an "Add Team Split" button and per-row **Edit** and **Deactivate/Activate** (with a confirmation popup). Team Splits now have their **own** Active/Inactive status (toggled per row); there is **no Remove/hard-delete**. Effective availability on the receipt form requires the Team Split to be Active **and** its Class to be Active.

Deferred (out of scope for v2):

4. **Delete Statement** (§6.8) — behavior (Drive file removal, reverting the claim to `Awaiting Statement`, verification-history handling, trigger location) to be specified in a later revision.
