import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function getDriveClient(): drive_v3.Drive {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return google.drive({ version: "v3", auth });
}

async function createFolder(drive: drive_v3.Drive, name: string, parentId: string): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error(`Drive folder "${name}" was created but no ID returned.`);
  return res.data.id;
}

async function grantEditorPermission(drive: drive_v3.Drive, fileId: string, email: string): Promise<void> {
  await drive.permissions.create({
    fileId,
    requestBody: { type: "user", role: "writer", emailAddress: email },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });
}

export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}

function getFolderWebUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export type ClaimFolderHandles = {
  parentId: string;
  receiptsId: string;
  statementsId: string;
  netsuiteId: string;
  receiptsUrl: string;
};

export async function createClaimFolders(displayId: string): Promise<ClaimFolderHandles> {
  const drive = getDriveClient();
  const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;
  const authorizedUsers = (process.env.AUTHORIZED_USERS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  let parentId: string | null = null;
  try {
    parentId = await createFolder(drive, displayId, root);
    const [receiptsId, statementsId, netsuiteId] = await Promise.all([
      createFolder(drive, "receipts", parentId),
      createFolder(drive, "statements", parentId),
      createFolder(drive, "netsuite", parentId),
    ]);

    await Promise.all(
      authorizedUsers.map((email) =>
        grantEditorPermission(drive, parentId!, email).catch((err) => {
          console.warn(`Failed to grant Drive access to ${email}:`, err);
        })
      )
    );

    return {
      parentId,
      receiptsId,
      statementsId,
      netsuiteId,
      receiptsUrl: getFolderWebUrl(receiptsId),
    };
  } catch (err) {
    if (parentId) {
      try {
        await drive.files.delete({ fileId: parentId, supportsAllDrives: true });
      } catch (cleanupErr) {
        console.error(
          `Orphan Drive folder ${parentId} for claim ${displayId} — manual cleanup needed.`,
          cleanupErr
        );
      }
    }
    throw err;
  }
}
