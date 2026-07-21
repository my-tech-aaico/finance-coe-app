project code to be updated to cover its whole characteristic. project code to be updated based on a google sheet form. there are more than 1000 project codes recorded for the moment. project code will not be removed from the form but we foresee a deactivation of it in the future.

reference to read
-@guidelines/spec/receipt.md
-@guidelines/spec/receipt-cr.md
-@guidelines/spec/project-code.md
-@guidelines/spec/scheduler.md

project code (project code page (admin/project-code), project code drop down in add receipt section (/claims/receipts/<claimId>?action=add-receipt) and project_code table) to have additional features below
-to have active/inactive status in database
-to have created_at for the date when it is created
-project code (admin/project-code) to have activate/deactivate button beside every project code
-project code (admin/project-code) to have status column to show it is active or inactive
-project code in receipt page (/claims/receipts/<claimId>?action=add-receipt), the drop down to show only active project code only.
-project code in receipt page (/claims/receipts/<claimId>?action=add-receipt) to have a search function for project code or project name.

to update the project code, to be provided an api that will be exposed to public domain. similar to verification-submit, to use the x-cron-secret as the authentication.
update project code steps:
- to read  a document in google drive https://docs.google.com/spreadsheets/d/1vBt-IcEZwQ_lyx03LvQF_T6GNYbieYRN8k2EKLwlqHk/edit?gid=1623170979#gid=1623170979 and take project code ref, timestamp, project name columns into a temporary object.
- query all project_code table
- compare the project code from document and table, if there is any new project code, mark it as new in the temporary object.
- compare the name of existing project with the one in the document. if there is any difference, to update the name based on the one in the document.
- for the new project code, read the details from the document and insert into the table and put it as active.
- active/inacitve status will remain for existing project code. the created_at also remain the same.