# COE Finance claims portal
> **Goal**: Create a portal that allows users to manage their finance claims.
> **Source environments must remain fully operational throughout.**

---
## Product Goal
The goal of this project is to develop a centralized finance claims portal that streamlines the expense claim submission and verification process for both employees and the finance team.

The system will allow the finance team to create and manage claim line items. Upon creation of a claim line item, the system will automatically generate a dedicated Google Drive folder for that claim. A Google Drive link to the folder will then be made accessible through the portal, allowing users to upload their supporting receipts directly to the designated folder.

After uploading the receipts, the claimant will be required to upload their corresponding credit card statement and link it to the previously created claim line item to verify the transaction amount being claimed.

The platform aims to improve transparency, reduce manual processing, ensure proper documentation, and simplify the overall finance claim workflow.

## Core technologies
- **Frontend** && **Backend**: Next.js (App Router)
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Cloud**: railway (https://railway.com/)
- **Git**: gitlab
    - **CI/CD**: gitlab
- **CSS**: tailwindcss
- **Auth**: better-auth (Google SSO)
- **mobile responsive**: yes

## UI Overview
The portal should include a side navigation menu with the following sections and functionalities:
- Login screen - user must log in to access any of the other sections.
- **Dashboard**
    - Coming soon.
    - This section will be developed in a later phase after the initial MVP release.
- **Claims**
    - **Receipts**
        - Allows users to create a new claim line item.
        - Upon creation, the system will automatically generate a dedicated folder in Google Drive for the claim.
        - Users can access the generated Google Drive link, which will redirect them to Google Drive to upload supporting receipts directly into the designated folder.
    - **Statements**
        - Allows users to upload their credit card statements.
        - Users must link the uploaded statement to an existing claim line item created in the Receipts section.
        - The uploaded statement will be used to verify the transaction amount being claimed.
- **Admin**
    - **User Management**
        - Allows administrators to add and manage users who can log in to the system.
        - Includes functionality to assign user access and roles where applicable.

## User roles
- **Finance**:
    - **Receipts** – can access this section.
    - **Statements** – can access this section.
- **Employee**:
    - **Statements** – can access this section.
- **Admin**:
    - can access all sections.

## High-Level Flow

1. **User Authentication**
    - Any user accessing the portal will be redirected to the login screen.
    - Users must be authenticated before they can access any section of the portal.

2. **Claim Creation**
    - The Finance team will navigate to the **Claims Submission** section and create a new claim line item.
    - The Finance team will fill in a form with the claim description and any required claim details.
    - Upon creation, the system will automatically create a dedicated Google Drive folder for the claim.
    - The Google Drive folder path should follow a structure similar to:

      ```text
      /<claim_id>/receipts
      ```

    - The claim details and Google Drive folder information will be saved in the database.

3. **Receipt Upload**
    - The Finance team will contact the claimant and request the supporting receipts.
    - The claimant will access the generated Google Drive link from the portal.
    - The link will redirect the claimant to Google Drive, where they can upload all supporting receipts directly into the claim's dedicated receipt folder.

4. **Credit Card Statement Upload**
    - Once the Finance team has received the receipts, they will contact the claimant and request the relevant credit card statement.
    - The claimant will upload the credit card statement through the portal.
    - During upload, the claimant must provide the statement date and select the related claim line item created earlier.
    - The uploaded statement will be linked to the selected claim line item.
    - The statement file will be saved in Google Drive under:

      ```text
      /<claim_id>/statement
      ```

    - The statement details and file path will be saved in the database.

5. **Verification Queue Creation**
    - Upon successful submission of the credit card statement, the system will create a new verification queue record in the database.
    - The initial queue status will be:

      ```text
      Pending Verification
      ```

6. **Start Automated Verification**
    - A scheduler will periodically check the verification queue for records with `Pending Verification` status.
    - Eligible records will be sent to the Applied AI Opus system.
    - Opus will run an automated workflow to verify the transaction details.
    - Once Opus accepts the request, it will return a `JOB_EXECUTION_ID`.
    - The system will save the `JOB_EXECUTION_ID` and update the queue status to:

      ```text
      In Progress
      ```

7. **Check Verification Status**
    - A separate scheduler will periodically check records with `In Progress` status.
    - The scheduler will use the `JOB_EXECUTION_ID` to check whether the Opus verification workflow has completed.

8. **Verification Completion**
    - Once the Opus workflow is completed, the system will update the verification status based on the result.
    - The final status will be either:

      ```text
      Success
      ```

      or

      ```text
      Failed
      ```