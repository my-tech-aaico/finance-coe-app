# COE Finance claims portal
> **Goal**: Create a portal that allows users to manage their finance claims.
> **Source environments must remain fully operational throughout.**

---
## Product Goal
The goal of this project is to develop a centralized finance claims portal that streamlines the expense claim submission and verification process for both employees and the finance team.

The system will allow the finance team to create and manage claim line items. Upon creation of a claim line item, 
the system will automatically generate a dedicated Google Drive folder for that claim. The system will allow users 
to upload receipts for the claim line item. The uploaded receipts will be stored in the Google Drive folder.

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