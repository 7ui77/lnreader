import { exists, getBackups, makeDir, readDir } from '../index';
import { list, create } from '../request';

jest.mock('../request', () => ({
  list: jest.fn(),
  create: jest.fn(),
}));

describe('drive API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exists', () => {
    it('queries Google Drive without fullText contains and matches by name', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'folder-1',
            name: 'LNReader',
            description: '(Do not change this!) LNReader-Drive',
            parents: ['root'],
            kind: 'drive#file',
          },
        ],
      });

      const result = await exists('LNReader', true, undefined, true);

      expect(result).toBeDefined();
      expect(result?.id).toBe('folder-1');
      expect(jest.mocked(list)).toHaveBeenCalledWith({
        q: "name = 'LNReader' and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
      });
      // Ensure fullText contains is NOT in the query
      expect(jest.mocked(list).mock.calls[0][0].q).not.toContain(
        'fullText contains',
      );
    });

    it('returns marked folder when marked is true', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'unmarked-folder',
            name: 'LNReader',
            parents: ['root'],
            kind: 'drive#file',
          },
          {
            id: 'marked-folder',
            name: 'LNReader',
            description: '(Do not change this!) LNReader-Drive',
            parents: ['root'],
            kind: 'drive#file',
          },
        ],
      });

      const result = await exists('LNReader', true, undefined, true);
      expect(result?.id).toBe('marked-folder');
    });

    it('falls back to matching by name if no item is marked', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'user-created-folder',
            name: 'LNReader',
            parents: ['root'],
            kind: 'drive#file',
          },
        ],
      });

      const result = await exists('LNReader', true, undefined, true);
      expect(result?.id).toBe('user-created-folder');
    });

    it('returns undefined when no files are returned', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [],
      });

      const result = await exists('NonExistent', true);
      expect(result).toBeUndefined();
    });

    it('paginates through multiple pages until marked file is found', async () => {
      jest
        .mocked(list)
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: 'page-2-token',
          files: [
            {
              id: 'unmarked-1',
              name: 'OtherFolder',
              kind: 'drive#file',
              parents: ['root'],
            },
          ],
        })
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: undefined,
          files: [
            {
              id: 'marked-target',
              name: 'LNReader',
              description: '(Do not change this!) LNReader-Drive',
              kind: 'drive#file',
              parents: ['root'],
            },
          ],
        });

      const result = await exists('LNReader', true, undefined, true);
      expect(result).toBeDefined();
      expect(result?.id).toBe('marked-target');
      expect(list).toHaveBeenCalledTimes(2);
      expect(jest.mocked(list).mock.calls[1][0].pageToken).toBe('page-2-token');
    });
  });

  describe('getBackups', () => {
    it('queries backups without fullText contains and filters by parent', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'backup-1',
            name: 'my_backup.backup',
            description: '(Do not change this!) LNReader-Drive',
            parents: ['parent-123'],
            kind: 'drive#file',
          },
        ],
      });

      const backups = await getBackups('parent-123', true);

      expect(backups).toHaveLength(1);
      expect(backups[0].id).toBe('backup-1');
      const query = jest.mocked(list).mock.calls[0][0].q;
      expect(query).toContain("'parent-123' in parents");
      expect(query).toContain(
        "mimeType = 'application/vnd.google-apps.folder'",
      );
      expect(query).not.toContain('fullText contains');
    });

    it('queries backups across drive when parentId is undefined', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'backup-root',
            name: 'drive_root.backup',
            parents: ['root'],
            kind: 'drive#file',
          },
        ],
      });

      const backups = await getBackups(undefined, false);

      expect(backups).toHaveLength(1);
      expect(backups[0].id).toBe('backup-root');
      const query = jest.mocked(list).mock.calls[0][0].q;
      expect(query).not.toContain('in parents');
      expect(query).not.toContain('fullText contains');
    });

    it('paginates across multiple pages to collect all backups', async () => {
      jest
        .mocked(list)
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: 'token-page-2',
          files: [
            {
              id: 'backup-page-1',
              name: 'backup1.backup',
              description: '(Do not change this!) LNReader-Drive',
              parents: ['root'],
              kind: 'drive#file',
            },
          ],
        })
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: undefined,
          files: [
            {
              id: 'backup-page-2',
              name: 'backup2.backup',
              description: '(Do not change this!) LNReader-Drive',
              parents: ['root'],
              kind: 'drive#file',
            },
          ],
        });

      const backups = await getBackups(undefined, true);
      expect(backups).toHaveLength(2);
      expect(backups.map(b => b.id)).toEqual([
        'backup-page-1',
        'backup-page-2',
      ]);
      expect(list).toHaveBeenCalledTimes(2);
      expect(jest.mocked(list).mock.calls[1][0].pageToken).toBe('token-page-2');
    });
  });

  describe('makeDir', () => {
    it('returns existing directory if exists', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [
          {
            id: 'existing-dir',
            name: 'LNReader',
            parents: ['root'],
            kind: 'drive#file',
          },
        ],
      });

      const dir = await makeDir('LNReader');
      expect(dir.id).toBe('existing-dir');
      expect(jest.mocked(create)).not.toHaveBeenCalled();
    });

    it('creates new directory if not exists', async () => {
      jest.mocked(list).mockResolvedValueOnce({
        kind: 'drive#fileList',
        incompleteSearch: false,
        files: [],
      });
      jest.mocked(create).mockResolvedValueOnce({
        id: 'new-dir',
        name: 'LNReader',
        parents: ['root'],
        kind: 'drive#file',
      });

      const dir = await makeDir('LNReader');
      expect(dir.id).toBe('new-dir');
      expect(jest.mocked(create)).toHaveBeenCalled();
    });
  });

  describe('readDir', () => {
    it('reads all files with pagination without fullText contains', async () => {
      jest
        .mocked(list)
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: 'page-2-token',
          files: [
            {
              id: 'file-1',
              name: 'file1.json',
              parents: ['parent-1'],
              kind: 'drive#file',
            },
          ],
        })
        .mockResolvedValueOnce({
          kind: 'drive#fileList',
          incompleteSearch: false,
          nextPageToken: undefined,
          files: [
            {
              id: 'file-2',
              name: 'file2.json',
              parents: ['parent-1'],
              kind: 'drive#file',
            },
          ],
        });

      const files = await readDir('parent-1');
      expect(files).toHaveLength(2);
      expect(files[0].id).toBe('file-1');
      expect(files[1].id).toBe('file-2');
      expect(jest.mocked(list).mock.calls[0][0].q).not.toContain(
        'fullText contains',
      );
    });
  });
});
