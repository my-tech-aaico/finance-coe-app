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

export async function uploadReceiptFile(
  parentFolderId: string,
  filename: string,
  file: File,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentFolderId],
    },
    media: {
      mimeType: file.type,
      body: bufferToStream(buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  if (!res.data.id || !res.data.webViewLink) {
    throw new Error("Drive returned an incomplete response (missing id or webViewLink).");
  }
  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}

function bufferToStream(buffer: Buffer) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require("node:stream");
  return Readable.from(buffer);
}

export async function downloadDriveFile(
  fileId: string,
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string }> {
  const drive = getDriveClient();

  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType ?? "application/octet-stream";

  const fileResp = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" },
  );

  const nodeStream = fileResp.data as unknown as NodeJS.ReadableStream;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: Error) => controller.error(err));
    },
    cancel() {
      (nodeStream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    },
  });

  return { stream, mimeType };
}

export async function downloadDriveFileAsBuffer(
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Buffer the file (≤10MB) so the presigned PUT has a known Content-Length and
  // we avoid duplex/streaming pitfalls. See opus-api.md §4.
  const { stream, mimeType } = await downloadDriveFile(fileId);
  const buffer = Buffer.from(await new Response(stream).arrayBuffer());
  return { buffer, mimeType };
}

function escapeDriveQueryValue(value: string): string {
  // Escape backslashes and single quotes for a Drive `q` string literal.
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function uploadDriveFileFromBuffer(
  parentFolderId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();

  // Overwrite-by-name (opus-api.md §8.2): the result filename is deterministic and
  // Opus reuses it across retries, so update the existing file's content in place
  // rather than creating duplicates.
  const existing = await drive.files.list({
    q: `name = '${escapeDriveQueryValue(filename)}' and '${escapeDriveQueryValue(
      parentFolderId,
    )}' in parents and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });

  const existingId = existing.data.files?.[0]?.id;

  if (existingId) {
    const res = await drive.files.update({
      fileId: existingId,
      media: { mimeType, body: bufferToStream(buffer) },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    if (!res.data.id || !res.data.webViewLink) {
      throw new Error("Drive returned an incomplete response on update (missing id or webViewLink).");
    }
    return { fileId: res.data.id, webViewLink: res.data.webViewLink };
  }

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentFolderId] },
    media: { mimeType, body: bufferToStream(buffer) },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  if (!res.data.id || !res.data.webViewLink) {
    throw new Error("Drive returned an incomplete response (missing id or webViewLink).");
  }
  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: { trashed: true },
  });
}

export async function uploadStatementFile(
  parentFolderId: string,
  filename: string,
  file: File,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentFolderId],
    },
    media: {
      mimeType: file.type,
      body: bufferToStream(buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  if (!res.data.id || !res.data.webViewLink) {
    throw new Error("Drive returned an incomplete response (missing id or webViewLink).");
  }
  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}

export async function moveStatementFile(
  fileId: string,
  fromFolderId: string,
  toFolderId: string,
): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: "id, parents",
    supportsAllDrives: true,
  });
}
