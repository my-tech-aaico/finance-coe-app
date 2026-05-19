Objective: This is for a new implementation for the statement section of the claim portal. We are only going to 
implement everything about the statement section except for the verification history which will be handled later by 
out scheduler implementation.

Dependencies: 
- For ui/ux details please refer to the @guidelines/ui/COE_Finance_Claims_Portal_UI_Spec.md and @guidelines/ui/COE_Finance_Claims_Portal_UI_Mock.html 
- This implementation has correlation to @guidelines/spec/receipt.md and @guidelines/spec/receipt-cr.md

Requirements:

Upload Statement:
1. [Finanace/Employee/Admin] are allowed to uploade statements
2. The link to claim section should show only unassigned claims and claims tied to the user
3. The uploaded file will be stored in our google drive under <claim-id>/statement folder
4. Start verification checkbox should be unchecked by default. If chechked should include it into the verification 
   history table.
5. The information should stored into 2 different tables: 
   - claim statement - stores the basic information about the statement such statement date, upload date... etc etc, 
     please refer to the @guidelines/ui/COE_Finance_Claims_Portal_UI_Spec.md and @guidelines/ui/COE_Finance_Claims_Portal_UI_Mock.html
     -claim statement verification history - this is the table that will integrate with opus later for ai ingestion 
     and verification. If the user check the start verification checkbox, the item should be stored in QUEUE status, 
     else uncheked it should be stored as Pending verification.

