# SPEC: scheduler

## Goal
This is for a new implementation of the scheduled workflow and the update of verification history table.
- The workflow will fetch the inserted records from claim, receipt and statement and call OPUS api to create new verification or check the status of the verification.
- The verification history table will show the ongoing, failed and success verification under claims-statement.

## In scope
- submission of verification
- update of verification status
- verification history table under claims-statement

## Out of scope (do NOT do)
- 

## Files to read first
- @guidelines\spec\receipt.md
- @guidelines\spec\receipt-cr.md
- @guidelines\spec\statement.md
- @guidelines\spec\statement.md
- For ui/ux details please refer to the @guidelines/ui/COE_Finance_Claims_Portal_UI_Spec.md and @guidelines/ui/COE_Finance_Claims_Portal_UI_Mock.html 

### Data / API contract
url: opus.com
verification API path: /submission
check status API path: /checkStatus

## Requirements
1.Submission workflow
Submission workflow will be triggered every period of time, for example every 3 minutes.
It fetches from statement_verification_attempt, receipt, statement table, to get the top 5 earliest records in QUEUED status.
Then it updates the statement_verification_attempt table using the IDs, to update the status to IN-PROGRESS and MODIFIED_DATE to current date.
Using the information from statement and receipt table regarding the folder and file, it will pull the statement file and receipt files from Google Drive.
It will then call opus.com verification API with the files and get the job details in response to be updated into statement_verification_attempt table.
Any error related to either statement file not found or gdrive folder not found, it will update the submission with FAILED status and REMARKS with “File/Folder is not found, please check in Google Drive.” and the MODIFIED_DATE as current date.
Any error from OPUS response (for example timeout), update the submission with FAILED status and REMARKS column with “Error from OPUS, please check in OPUS or retry”
2.Update workflow
Update workflow will be triggered every 10 minutes
It fetches from statement_verification_attempt table, to get the top 5 earliest records IN-PROGRESS status.
It call opus.com check status API and will update the job details in statement_verification_attempt table.
3. Verification history table
verification history table will be under claims - statement page. please refer to @guidelines/ui/COE_Finance_Claims_Portal_UI_Spec.md and @guidelines/ui/COE_Finance_Claims_Portal_UI_Mock.html about where and how it should look like.
