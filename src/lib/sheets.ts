import { google, sheets_v4 } from "googleapis";

// Read-only Google Sheets client, kept separate from drive.ts so the Drive client
// stays Drive-scoped. Uses the same service-account JWT credentials.
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function getSheetsClient(): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * Read all rows of a tab as a 2-D string grid (row 0 is the header row).
 * `tab` is the sheet/tab NAME (the Sheets API addresses ranges by name, not gid).
 * Empty trailing cells are returned as "" so every row has a stable shape.
 */
export async function readSheetRows(spreadsheetId: string, tab: string): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tab, // whole tab
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = (res.data.values ?? []) as unknown[][];
  return rows.map((r) => r.map((cell) => (cell == null ? "" : String(cell))));
}
