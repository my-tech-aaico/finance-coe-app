there is a new requirement about the verification-submit. there is a new part of the payload sample like this.

{
    "jobExecutionId": "67007",
    "jobPayloadSchemaInstance": {
      "workflow_input_2b3t71ss6": {
			"value": "https://files.opus.com/media/private/uploaded/media_d4b50bc7-b788-4a7b-bf72-aafad99e6bc1.pdf",
			"type": "file",
			"displayName": "Statement File"
		},
      "wworkflow_input_635kk6x2s": {
        "value": "17-n9AiysGM54lYPRVrwL3j9tS2bX2Zow",
        "type": "str",
        "displayName": "Google Folder Id"
      },
      "workflow_input_mwkb503th": {
			"value": [
				"https://files.opus.com/media/private/uploaded/media_89387f05-a56f-4383-8ac5-e42e9c28b799.png",
				"https://files.opus.com/media/private/uploaded/media_70dd78b6-e672-47f5-a868-9ebf1beba060.pdf"
			],
			"type": "array",
			"displayName": "Supporting Receipts"
		},
        "workflow_input_2l05z7zw6": {
            "value": "netsuite",
            "type": "str",
            "displayName": "netsuite folder name"
        },
        "workflow_input_bz12gc3wp": {
      "value": "{\"file\":[{\"filename\":\"media_4cf2d6b9-ac9f-485a-8af8-69874e1c4a02.pdf\",\"department\":\"crt-celcomdigi\",\"class\":\"testing\",\"projectCode\":\"AIA/APDMY/00013\",\"team-split\":\"team-split-a\"},{\"filename\":\"media_9f63afa2-8002-47b0-80b0-6999042d82fb.pdf\",\"department\":\"crt-aia\",\"class\":\"testing-aia\",\"projectCode\":\"AIA/APDMY/00015\",\"team-split\":\"team-split-b\"}]}",
      "type": "str",
      "displayName": "metadata"
        }
    }
}

workflow_input_bz12gc3wp is a new input. the value will be list of file metadata from the uploaded files. it consists of
filename: the filename in fileUrl in the response of https://operator.opus.com/job/file/upload, for example if it is "fileUrl":"https://files.opus.com/media/private/uploaded/media_487b5def-aa64-4f31-979c-888de6f0e90e.pdf", then the filename is media_487b5def-aa64-4f31-979c-888de6f0e90e.pdf
department: is the department of the receipt
class: is the class of the receipt
projectCode: is the project code of the receipt
team-split: is the team-split of the receipt