import { driveRestore } from '../drive';
import { exists } from '@api/drive';
import { download } from '@api/drive/request';
import NativeFile from '@modules/native-file';
import NativeZipArchive from '@modules/native-zip-archive';
import { finalizeRestoredPlugins } from '../restoreResult';
import { restoreData } from '../utils';
import { ZipBackupName } from '../types';

jest.mock('@api/drive', () => ({
  exists: jest.fn(),
  getBackups: jest.fn(),
  makeDir: jest.fn(),
}));

jest.mock('@api/drive/request', () => ({
  download: jest.fn().mockResolvedValue(undefined),
  updateMetadata: jest.fn().mockResolvedValue(undefined),
  uploadMedia: jest
    .fn()
    .mockResolvedValue({ id: 'uploaded-1', parents: ['root'] }),
}));

jest.mock('../utils', () => ({
  CACHE_DIR_PATH: '/cache/BackupData',
  clearBackupCache: jest.fn().mockResolvedValue(undefined),
  prepareBackupData: jest.fn(),
  restoreData: jest.fn(),
}));

jest.mock('../restoreResult', () => ({
  finalizeRestoredPlugins: jest.fn().mockResolvedValue([]),
  getRestoreCompletionText: jest.fn(() => 'Restore completed'),
}));

jest.mock('../backupResult', () => ({
  getBackupCompletionText: jest.fn(() => 'Backup created'),
}));

jest.mock('../fileSections', () => ({
  getLegacyFilesRestorePath: jest.fn(() => '/cache/BackupData/legacy'),
  getNovelFilesRestorePath: jest.fn(() => '/cache/BackupData/novel_files'),
  getSelectedBackupFileSections: jest.fn(() => []),
  restoreLegacyFiles: jest.fn().mockResolvedValue(undefined),
  restoreNovelFiles: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@utils/sleep', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@i18n/translations', () => ({
  getString: (key: string) => key,
}));

describe('driveRestore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores backup folder with data.zip and sections', async () => {
    const backupFolder = {
      id: 'folder-123',
      name: 'my_backup.backup',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
      kind: 'drive#file',
    };

    jest.mocked(exists).mockImplementation(async (name, isFolder, parentId) => {
      if (name === ZipBackupName.DATA && parentId === 'folder-123') {
        return {
          id: 'data-zip-id',
          name: 'data.zip',
          parents: ['folder-123'],
          kind: 'drive#file',
        };
      }
      return undefined;
    });

    jest.mocked(restoreData).mockResolvedValueOnce({
      novelCount: 1,
      failedNovelCount: 0,
      categoryCount: 0,
      failedCategoryCount: 0,
      settingsRestored: true,
      failedSectionCount: 0,
      pluginIds: [],
      novelMappings: [],
      manifest: {
        appVersion: '2.1.4',
        formatVersion: 2 as const,
        sections: {
          library: true,
          settings: true,
          plugins: false,
          downloadedFiles: false,
        },
      },
    });

    const setMeta = jest.fn();
    await driveRestore(backupFolder, setMeta);

    expect(exists).toHaveBeenCalledWith(
      ZipBackupName.DATA,
      false,
      'folder-123',
    );
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'data-zip-id' }),
      '/cache/BackupData',
    );
    expect(restoreData).toHaveBeenCalledWith('/cache/BackupData', setMeta);
    expect(finalizeRestoredPlugins).toHaveBeenCalled();
  });

  it('restores standalone zip backup file', async () => {
    const zipBackupFile = {
      id: 'zip-file-123',
      name: 'lnreader_backup_2026.zip',
      mimeType: 'application/zip',
      parents: ['root'],
      kind: 'drive#file',
    };

    jest.mocked(NativeFile.exists).mockResolvedValue(true);
    jest.mocked(NativeZipArchive.unzip).mockResolvedValue(undefined);

    jest.mocked(restoreData).mockResolvedValueOnce({
      novelCount: 2,
      failedNovelCount: 0,
      categoryCount: 0,
      failedCategoryCount: 0,
      settingsRestored: true,
      failedSectionCount: 0,
      pluginIds: [],
      novelMappings: [],
      manifest: {
        appVersion: '2.1.4',
        formatVersion: 2 as const,
        sections: {
          library: true,
          settings: true,
          plugins: false,
          downloadedFiles: false,
        },
      },
    });

    const setMeta = jest.fn();
    await driveRestore(zipBackupFile, setMeta);

    expect(download).toHaveBeenCalledWith(zipBackupFile, '/cache/BackupData');
    expect(NativeZipArchive.unzip).toHaveBeenCalledWith(
      '/cache/BackupData/data.zip',
      '/cache/BackupData',
    );
    expect(restoreData).toHaveBeenCalledWith('/cache/BackupData', setMeta);
    expect(finalizeRestoredPlugins).toHaveBeenCalled();
  });

  it('rejects standalone restore when required section archive is missing', async () => {
    const zipBackupFile = {
      id: 'zip-file-123',
      name: 'lnreader_backup_2026.zip',
      mimeType: 'application/zip',
      parents: ['root'],
      kind: 'drive#file',
    };

    jest.mocked(NativeFile.exists).mockImplementation(async path => {
      if (path.endsWith('data.zip')) {
        return true;
      }
      return false; // section archive missing
    });

    const { getSelectedBackupFileSections } =
      jest.requireMock('../fileSections');
    jest.mocked(getSelectedBackupFileSections).mockReturnValueOnce([
      {
        archiveName: 'novel-files.zip',
        storagePath: '/storage/novel_files',
      },
    ]);

    jest.mocked(restoreData).mockResolvedValueOnce({
      novelCount: 1,
      failedNovelCount: 0,
      categoryCount: 0,
      failedCategoryCount: 0,
      settingsRestored: true,
      failedSectionCount: 0,
      pluginIds: [],
      novelMappings: [],
      manifest: {
        appVersion: '2.1.4',
        formatVersion: 2 as const,
        sections: {
          library: true,
          settings: true,
          plugins: false,
          downloadedFiles: true,
        },
      },
    });

    const setMeta = jest.fn();
    await expect(driveRestore(zipBackupFile, setMeta)).rejects.toThrow(
      'backupScreen.invalidBackupFolder',
    );
  });
});
