import { create, list } from './request';
import { DriveCreateRequestData, DriveFile } from './types';

const LNREADER_DRIVE_MARK = '(Do not change this!) LNReader-Drive';

const escapeQueryValue = (value: string) => {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

export const exists = async (
  fileName: string,
  isFolder?: boolean,
  parentId?: string,
  marked?: boolean,
) => {
  let q = `name = '${escapeQueryValue(fileName)}' and trashed = false`;
  if (isFolder) {
    q += " and mimeType = 'application/vnd.google-apps.folder'";
  }
  if (parentId) {
    q += ` and '${escapeQueryValue(parentId)}' in parents`;
  }
  const res = await list({ q });
  const files = res.files || [];
  if (files.length === 0) {
    return undefined;
  }
  if (marked) {
    const markedFile = files.find(
      file =>
        file.name === fileName && file.description === LNREADER_DRIVE_MARK,
    );
    if (markedFile) {
      return markedFile;
    }
  }
  return files.find(file => file.name === fileName);
};

export const makeDir = async (fileName: string, parentId?: string) => {
  const existedDir = await exists(fileName, true, parentId);
  if (existedDir) {
    return existedDir;
  }
  const data: DriveCreateRequestData = {
    metadata: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.folder',
      description: LNREADER_DRIVE_MARK,
    },
  };
  if (parentId) {
    data.metadata.parents = [parentId];
  }
  return create(data);
};

export const createFile = async (
  fileName: string,
  mimeType: string,
  content: string,
  parentId?: string,
) => {
  const existedFile = await exists(fileName, false, parentId);
  if (existedFile) {
    return existedFile;
  }
  const data: DriveCreateRequestData = {
    metadata: {
      name: fileName,
      mimeType: mimeType,
      description: LNREADER_DRIVE_MARK,
    },
    content: content,
  };
  if (parentId) {
    data.metadata.parents = [parentId];
  }
  return create(data);
};

export const getBackups = async (parentId?: string, marked?: boolean) => {
  let q = `trashed = false and (name contains '.backup' or name contains '.zip')`;
  if (parentId) {
    q += ` and '${escapeQueryValue(parentId)}' in parents`;
  }
  const res = await list({ q, orderBy: 'createdTime desc' });
  const files = res.files || [];
  if (marked) {
    const markedFiles = files.filter(
      file => file.description === LNREADER_DRIVE_MARK,
    );
    if (markedFiles.length > 0) {
      return markedFiles;
    }
  }
  return files;
};

export const readDir = async (parentId: string, marked?: boolean) => {
  let fileList: DriveFile[] = [];
  let pageToken = '';
  const q = `trashed = false and mimeType != 'application/vnd.google-apps.folder' and '${escapeQueryValue(
    parentId,
  )}' in parents`;
  let hasNextPage = true;
  while (hasNextPage) {
    const { nextPageToken, files } = await list({
      q,
      pageToken: pageToken || undefined,
    });
    if (!nextPageToken) {
      hasNextPage = false;
    } else {
      pageToken = nextPageToken;
    }
    if (files) {
      const filtered = marked
        ? files.filter(file => file.description === LNREADER_DRIVE_MARK)
        : files;
      fileList = fileList.concat(filtered);
    }
  }
  return fileList;
};
