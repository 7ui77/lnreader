import { DriveFile } from '@api/drive/types';
import { sleep } from '@utils/sleep';
import { exists } from '@api/drive';
import { getString } from '@i18n/translations';
import NativeFile from '@modules/native-file';
import NativeZipArchive from '@modules/native-zip-archive';
import {
  CACHE_DIR_PATH,
  clearBackupCache,
  prepareBackupData,
  restoreData,
} from '../utils';
import {
  finalizeRestoredPlugins,
  getRestoreCompletionText,
} from '../restoreResult';
import { getBackupCompletionText } from '../backupResult';
import { download, updateMetadata, uploadMedia } from '@api/drive/request';
import { ZipBackupName } from '../types';
import type {
  DriveBackupData,
  TaskProgressUpdater,
} from '@services/backgroundTasks/contracts';
import {
  getLegacyFilesRestorePath,
  getNovelFilesRestorePath,
  getSelectedBackupFileSections,
  restoreLegacyFiles,
  restoreNovelFiles,
} from '../fileSections';
import { resolveBackupOptions } from '../options';

const uploadBackupSection = async (
  sourcePath: string,
  name: ZipBackupName,
  backupFolder: DriveFile,
) => {
  const file = await uploadMedia(sourcePath);
  await updateMetadata(
    file.id,
    {
      name,
      mimeType: 'application/zip',
      parents: [backupFolder.id],
    },
    file.parents[0],
  );
};

export const createDriveBackup = async (
  data: DriveBackupData,
  setMeta: TaskProgressUpdater,
) => {
  const backupFolder = 'backupFolder' in data ? data.backupFolder : data;
  const requestedOptions = 'backupFolder' in data ? data.options : undefined;
  const options = resolveBackupOptions(requestedOptions);
  setMeta(meta => ({
    ...meta,
    isRunning: true,
    progress: 0 / 3,
    progressText: getString('backupScreen.preparingData'),
  }));

  const backupResult = await prepareBackupData(CACHE_DIR_PATH, options);

  setMeta(meta => ({
    ...meta,
    progress: 1 / 3,
    progressText: getString('backupScreen.uploadingData'),
  }));

  await sleep(500);

  await uploadBackupSection(CACHE_DIR_PATH, ZipBackupName.DATA, backupFolder);

  setMeta(meta => ({
    ...meta,
    progress: 2 / 3,
    progressText: getString('backupScreen.uploadingSelectedFiles'),
  }));

  for (const section of getSelectedBackupFileSections(options)) {
    await uploadBackupSection(
      section.storagePath,
      section.archiveName,
      backupFolder,
    );
  }

  const completionText = getBackupCompletionText(backupResult);
  setMeta(meta => ({
    ...meta,
    progress: 3 / 3,
    isRunning: false,
    progressText: completionText,
    completionText,
  }));
};

export const driveRestore = async (
  backupFolder: DriveFile,
  setMeta: TaskProgressUpdater,
) => {
  setMeta(meta => ({
    ...meta,
    isRunning: true,
    progress: 0 / 3,
    progressText: getString('backupScreen.downloadingData'),
  }));

  const isFolder =
    backupFolder.mimeType === 'application/vnd.google-apps.folder';

  let zipDataFile: DriveFile | undefined;
  if (isFolder) {
    zipDataFile = await exists(ZipBackupName.DATA, false, backupFolder.id);
  }

  if (!zipDataFile && !isFolder) {
    await clearBackupCache();
    await download(backupFolder, CACHE_DIR_PATH);
    await sleep(500);

    const dataArchive = CACHE_DIR_PATH + '/' + ZipBackupName.DATA;
    if (await NativeFile.exists(dataArchive)) {
      await NativeZipArchive.unzip(dataArchive, CACHE_DIR_PATH);
    }

    setMeta(meta => ({
      ...meta,
      progress: 1 / 3,
      progressText: getString('backupScreen.restoringData'),
    }));

    const restoreResult = await restoreData(CACHE_DIR_PATH, setMeta);
    await sleep(500);

    setMeta(meta => ({
      ...meta,
      progress: 2 / 3,
      progressText: getString('backupScreen.restoringSelectedFiles'),
    }));

    if (restoreResult.manifest.formatVersion === 1) {
      const legacyArchive = CACHE_DIR_PATH + '/' + ZipBackupName.DOWNLOAD;
      if (!(await NativeFile.exists(legacyArchive))) {
        throw new Error(getString('backupScreen.invalidBackupFolder'));
      }
      const legacyFilesRestorePath = getLegacyFilesRestorePath(CACHE_DIR_PATH);
      await NativeZipArchive.unzip(legacyArchive, legacyFilesRestorePath);
      await restoreLegacyFiles(
        legacyFilesRestorePath,
        restoreResult.novelMappings,
      );
    } else {
      const novelFilesRestorePath = getNovelFilesRestorePath(CACHE_DIR_PATH);
      for (const section of getSelectedBackupFileSections(
        restoreResult.manifest.sections,
      )) {
        const archivePath = `${CACHE_DIR_PATH}/${section.archiveName}`;
        if (!(await NativeFile.exists(archivePath))) {
          throw new Error(getString('backupScreen.invalidBackupFolder'));
        }
        await NativeZipArchive.unzip(
          archivePath,
          section.archiveName === ZipBackupName.NOVEL_FILES
            ? novelFilesRestorePath
            : section.storagePath,
        );
      }
      if (restoreResult.manifest.sections.downloadedFiles) {
        await restoreNovelFiles(
          novelFilesRestorePath,
          restoreResult.novelMappings,
        );
      }
    }
    const missingPluginIds = await finalizeRestoredPlugins(restoreResult);
    const completionText = getRestoreCompletionText(
      restoreResult,
      missingPluginIds,
    );

    setMeta(meta => ({
      ...meta,
      progress: 3 / 3,
      isRunning: false,
      progressText: completionText,
      completionText,
    }));
    return;
  }

  if (!zipDataFile) {
    throw new Error(getString('backupScreen.invalidBackupFolder'));
  }

  await clearBackupCache();
  await download(zipDataFile, CACHE_DIR_PATH);
  await sleep(500);

  setMeta(meta => ({
    ...meta,
    progress: 1 / 3,
    progressText: getString('backupScreen.restoringData'),
  }));

  const restoreResult = await restoreData(CACHE_DIR_PATH, setMeta);
  await sleep(500);

  setMeta(meta => ({
    ...meta,
    progress: 2 / 3,
    progressText: getString('backupScreen.restoringSelectedFiles'),
  }));

  if (restoreResult.manifest.formatVersion === 1) {
    const legacyFile = await exists(
      ZipBackupName.DOWNLOAD,
      false,
      backupFolder.id,
    );
    if (!legacyFile) {
      throw new Error(getString('backupScreen.invalidBackupFolder'));
    }
    const legacyFilesRestorePath = getLegacyFilesRestorePath(CACHE_DIR_PATH);
    await download(legacyFile, legacyFilesRestorePath);
    await restoreLegacyFiles(
      legacyFilesRestorePath,
      restoreResult.novelMappings,
    );
  } else {
    const novelFilesRestorePath = getNovelFilesRestorePath(CACHE_DIR_PATH);
    for (const section of getSelectedBackupFileSections(
      restoreResult.manifest.sections,
    )) {
      const file = await exists(section.archiveName, false, backupFolder.id);
      if (!file) {
        throw new Error(getString('backupScreen.invalidBackupFolder'));
      }
      await download(
        file,
        section.archiveName === ZipBackupName.NOVEL_FILES
          ? novelFilesRestorePath
          : section.storagePath,
      );
    }
    if (restoreResult.manifest.sections.downloadedFiles) {
      await restoreNovelFiles(
        novelFilesRestorePath,
        restoreResult.novelMappings,
      );
    }
  }
  const missingPluginIds = await finalizeRestoredPlugins(restoreResult);
  const completionText = getRestoreCompletionText(
    restoreResult,
    missingPluginIds,
  );

  setMeta(meta => ({
    ...meta,
    progress: 3 / 3,
    isRunning: false,
    progressText: completionText,
    completionText,
  }));
};
