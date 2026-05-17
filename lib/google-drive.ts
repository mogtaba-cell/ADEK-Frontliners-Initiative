import "server-only";

import { Readable } from "node:stream";
import { google } from "googleapis";

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function getGooglePrivateKey() {
  const key = process.env.GOOGLE_PRIVATE_KEY;

  if (!key) {
    throw new Error("Missing GOOGLE_PRIVATE_KEY in environment variables.");
  }

  return key.replace(/\\n/g, "\n");
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sanitizeDriveName(value: string) {
  return String(value || "updated-artwork")
    .trim()
    .replace(/[\\/:*?"<>|#{}%~&]/g, "-")
    .replace(/\s+/g, "-");
}

export function getGoogleDriveClient() {
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? process.env.GOOGLE_CLIENT_EMAIL;

  if (!clientEmail) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_CLIENT_EMAIL in environment variables."
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: getGooglePrivateKey(),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({
    version: "v3",
    auth,
  });
}

export function getExportParentFolderId() {
  const folderId =
    process.env.GOOGLE_DRIVE_EXPORT_PARENT_FOLDER_ID ??
    process.env.GOOGLE_SHARED_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error(
      "Missing GOOGLE_DRIVE_EXPORT_PARENT_FOLDER_ID or GOOGLE_SHARED_DRIVE_FOLDER_ID."
    );
  }

  return folderId;
}

export function googleDriveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export async function createDriveFolder({
  name,
  parentFolderId,
}: {
  name: string;
  parentFolderId: string;
}) {
  const drive = getGoogleDriveClient();

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: GOOGLE_FOLDER_MIME_TYPE,
      parents: [parentFolderId],
    },
    fields: "id,name,webViewLink",
  });

  if (!response.data.id) {
    throw new Error(`Google Drive folder creation failed for ${name}.`);
  }

  return {
    id: response.data.id,
    name: response.data.name ?? name,
    webViewLink:
      response.data.webViewLink ?? googleDriveFolderUrl(response.data.id),
  };
}

export async function findDriveFolderByName({
  name,
  parentFolderId,
}: {
  name: string;
  parentFolderId: string;
}) {
  const drive = getGoogleDriveClient();

  const safeName = escapeDriveQueryValue(name);
  const safeParent = escapeDriveQueryValue(parentFolderId);

  const response = await drive.files.list({
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    q: [
      `'${safeParent}' in parents`,
      `name = '${safeName}'`,
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}'`,
      "trashed = false",
    ].join(" and "),
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
  });

  const folder = response.data.files?.[0];

  if (!folder?.id) return null;

  return {
    id: folder.id,
    name: folder.name ?? name,
    webViewLink: folder.webViewLink ?? googleDriveFolderUrl(folder.id),
  };
}

export async function getOrCreateDriveFolder({
  name,
  parentFolderId,
}: {
  name: string;
  parentFolderId: string;
}) {
  const existing = await findDriveFolderByName({
    name,
    parentFolderId,
  });

  if (existing) return existing;

  return createDriveFolder({
    name,
    parentFolderId,
  });
}

export async function getDataExportFolder() {
  return getOrCreateDriveFolder({
    name: "Data export",
    parentFolderId: getExportParentFolderId(),
  });
}

export async function getUpdatedArtworksFolder() {
  return getOrCreateDriveFolder({
    name: "updated artworks",
    parentFolderId: getExportParentFolderId(),
  });
}

export async function createDatedExportFolder({
  folderName,
}: {
  folderName: string;
}) {
  const dataExportFolder = await getDataExportFolder();

  return createDriveFolder({
    name: folderName,
    parentFolderId: dataExportFolder.id,
  });
}

export async function uploadBufferToDrive({
  folderId,
  filename,
  mimeType,
  buffer,
}: {
  folderId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const drive = getGoogleDriveClient();

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id,name,webViewLink",
  });

  if (!response.data.id) {
    throw new Error(`Google Drive upload failed for ${filename}.`);
  }

  return {
    id: response.data.id,
    name: response.data.name ?? filename,
    webViewLink: response.data.webViewLink ?? null,
  };
}

export async function listFilesInFolderByNamePrefix({
  folderId,
  namePrefix,
}: {
  folderId: string;
  namePrefix: string;
}) {
  const drive = getGoogleDriveClient();

  const safeParent = escapeDriveQueryValue(folderId);
  const safePrefix = escapeDriveQueryValue(namePrefix);

  const response = await drive.files.list({
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    q: [
      `'${safeParent}' in parents`,
      `name contains '${safePrefix}'`,
      "trashed = false",
    ].join(" and "),
    fields: "files(id,name,webViewLink,mimeType,size)",
    pageSize: 100,
  });

  return response.data.files ?? [];
}

function fileExtension(originalFilename: string) {
  if (!originalFilename.includes(".")) return "";
  return `.${originalFilename.split(".").pop()}`;
}

function baseNameWithoutExtension(originalFilename: string) {
  const cleaned = sanitizeDriveName(originalFilename);
  const extension = fileExtension(cleaned);

  if (!extension) return cleaned;

  return cleaned.slice(0, -extension.length);
}

async function uniqueFilenameInFolder({
  folderId,
  desiredFilename,
}: {
  folderId: string;
  desiredFilename: string;
}) {
  const extension = fileExtension(desiredFilename);
  const baseName = extension
    ? desiredFilename.slice(0, -extension.length)
    : desiredFilename;

  const existingFiles = await listFilesInFolderByNamePrefix({
    folderId,
    namePrefix: baseName,
  });

  const existingNames = new Set(
    existingFiles.map((file) => file.name).filter(Boolean)
  );

  if (!existingNames.has(desiredFilename)) return desiredFilename;

  let index = 2;

  while (existingNames.has(`${baseName}-${index}${extension}`)) {
    index += 1;
  }

  return `${baseName}-${index}${extension}`;
}

export async function uploadUpdatedArtworkToDrive({
  referenceId,
  originalFilename,
  mimeType,
  buffer,
}: {
  referenceId: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const updatedArtworksFolder = await getUpdatedArtworksFolder();

  const extension = fileExtension(originalFilename);

  const safeReferenceId = sanitizeDriveName(referenceId);

  const existingFiles = await listFilesInFolderByNamePrefix({
    folderId: updatedArtworksFolder.id,
    namePrefix: safeReferenceId,
  });

  const existingMatchingCount = existingFiles.filter((file) => {
    const name = file.name ?? "";

    return (
      name === `${safeReferenceId}${extension}` ||
      name.startsWith(`${safeReferenceId}-`)
    );
  }).length;

  const finalFilename =
    existingMatchingCount === 0
      ? `${safeReferenceId}${extension}`
      : `${safeReferenceId}-${existingMatchingCount + 1}${extension}`;

  return uploadBufferToDrive({
    folderId: updatedArtworksFolder.id,
    filename: finalFilename,
    mimeType,
    buffer,
  });
}

export async function uploadMultipleUpdatedArtworksToDrive({
  referenceId,
  files,
}: {
  referenceId: string;
  files: {
    originalFilename: string;
    mimeType: string;
    buffer: Buffer;
  }[];
}) {
  const updatedArtworksFolder = await getUpdatedArtworksFolder();
  const safeReferenceId = sanitizeDriveName(referenceId);

  const submissionFolder = await getOrCreateDriveFolder({
    name: safeReferenceId,
    parentFolderId: updatedArtworksFolder.id,
  });

  const uploadedFiles = [];

  for (const file of files) {
    const extension = fileExtension(file.originalFilename);
    const baseName = baseNameWithoutExtension(file.originalFilename);
    const desiredFilename = `${baseName || safeReferenceId}${extension}`;

    const finalFilename = await uniqueFilenameInFolder({
      folderId: submissionFolder.id,
      desiredFilename,
    });

    const uploadedFile = await uploadBufferToDrive({
      folderId: submissionFolder.id,
      filename: finalFilename,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    uploadedFiles.push(uploadedFile);
  }

  return {
    folder: submissionFolder,
    files: uploadedFiles,
  };
}