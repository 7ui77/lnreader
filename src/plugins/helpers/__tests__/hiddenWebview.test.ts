import {
  completeHiddenWebviewRequest,
  fetchViaWebviewForSite,
  subscribeHiddenWebview,
  validateSameOriginUrl,
} from '../hiddenWebview';

describe('hiddenWebview', () => {
  it('validates same-origin URLs and rejects cross-origin or invalid URLs', () => {
    expect(
      validateSameOriginUrl(
        'https://fenrirealm.com/series/test/16',
        'https://fenrirealm.com',
      ),
    ).toBe('https://fenrirealm.com/series/test/16');

    expect(() =>
      validateSameOriginUrl('https://evil.com/steal', 'https://fenrirealm.com'),
    ).toThrow('cross-origin');

    expect(() =>
      validateSameOriginUrl('javascript:alert(1)', 'https://fenrirealm.com'),
    ).toThrow('unsupported protocol');

    expect(() =>
      validateSameOriginUrl('https://fenrirealm.com/a', undefined),
    ).toThrow('plugin site is not configured');
  });

  it('queues requests sequentially and resolves when completed', async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeHiddenWebview(req => {
      if (req) {
        seen.push(req.id);
        Promise.resolve().then(() => {
          completeHiddenWebviewRequest(req.id, {
            ok: true,
            url: req.url,
            html: '<html><body>ok</body></html>',
            title: 'Test',
          });
        });
      }
    });

    try {
      const [r1, r2] = await Promise.all([
        fetchViaWebviewForSite(
          'https://fenrirealm.com/1',
          'https://fenrirealm.com',
        ),
        fetchViaWebviewForSite(
          'https://fenrirealm.com/2',
          'https://fenrirealm.com',
        ),
      ]);
      expect(r1.ok).toBe(true);
      expect(r2.url).toBe('https://fenrirealm.com/2');
      expect(seen.length).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
