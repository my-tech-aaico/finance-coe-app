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
