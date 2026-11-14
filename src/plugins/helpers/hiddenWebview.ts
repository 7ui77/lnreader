export interface HiddenWebviewFetchOptions {
  waitForSelector?: string;
  timeoutMs?: number;
  settleMs?: number;
  userAgent?: string;
}

export interface HiddenWebviewResponse {
  ok: boolean;
  url: string;
  html: string;
  title: string;
}

export interface HiddenWebviewRequest {
  id: number;
  url: string;
  allowedOrigin: string;
  waitForSelector?: string;
  timeoutMs: number;
  settleMs: number;
  userAgent?: string;
  resolve: (res: HiddenWebviewResponse) => void;
  reject: (err: Error) => void;
}

type Listener = (req: HiddenWebviewRequest | null) => void;

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SETTLE_MS = 300;

let nextId = 1;
let activeRequest: HiddenWebviewRequest | null = null;
const queue: HiddenWebviewRequest[] = [];
const listeners = new Set<Listener>();

const notify = () => {
  listeners.forEach(listener => listener(activeRequest));
};

const pump = () => {
  if (activeRequest || queue.length === 0) {
    return;
  }
  activeRequest = queue.shift() || null;
  notify();
};

export const subscribeHiddenWebview = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(activeRequest);
  return () => {
    listeners.delete(listener);
  };
};

const settleActiveRequest = (
  id: number,
  settle: (req: HiddenWebviewRequest) => void,
) => {
  if (!activeRequest || activeRequest.id !== id) {
    return;
  }
  const req = activeRequest;
  activeRequest = null;
  notify();
  settle(req);
  pump();
};

export const completeHiddenWebviewRequest = (
  id: number,
  result: HiddenWebviewResponse,
) => {
  settleActiveRequest(id, req => req.resolve(result));
};

export const failHiddenWebviewRequest = (id: number, error: Error) => {
  settleActiveRequest(id, req => req.reject(error));
};

export const validateSameOriginUrl = (url: string, site?: string): string => {
  if (!site) {
    throw new Error('fetchViaWebview: plugin site is not configured');
  }
  let targetUrl: URL;
  let siteUrl: URL;
  try {
    targetUrl = new URL(url);
    siteUrl = new URL(site);
  } catch {
    throw new Error('fetchViaWebview: invalid URL');
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    throw new Error('fetchViaWebview: unsupported protocol');
  }

  if (targetUrl.origin !== siteUrl.origin) {
    throw new Error(
      `fetchViaWebview: cross-origin URL (${targetUrl.origin}) is not allowed for ${siteUrl.origin}`,
    );
  }

  return targetUrl.toString();
};

export const fetchViaWebviewForSite = (
  url: string,
  site?: string,
  options?: HiddenWebviewFetchOptions,
): Promise<HiddenWebviewResponse> => {
  const validatedUrl = validateSameOriginUrl(url, site);
  if (listeners.size === 0) {
    return Promise.reject(
      new Error('fetchViaWebview: HiddenWebViewHost is not mounted'),
    );
  }

  return new Promise<HiddenWebviewResponse>((resolve, reject) => {
    const req: HiddenWebviewRequest = {
      id: nextId++,
      url: validatedUrl,
      allowedOrigin: new URL(validatedUrl).origin,
      waitForSelector: options?.waitForSelector,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      settleMs: options?.settleMs ?? DEFAULT_SETTLE_MS,
      userAgent: options?.userAgent,
      resolve,
      reject,
    };
    queue.push(req);
    pump();
  });
};
