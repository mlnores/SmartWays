const SMARTWAYS_CONFIG = globalThis as typeof globalThis & {
  SMARTWAYS_CONFIG?: {
    apiBaseUrl?: string;
  };
};

export const API_BASE_URL = SMARTWAYS_CONFIG.SMARTWAYS_CONFIG?.apiBaseUrl || 'http://127.0.0.1:8000/api';
export const PHOTON_BASE_URL = 'https://photon.komoot.io';
export const WALKING_ROUTE_BASE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export function isSmartWaysApiUrl(url: string): boolean {
  const origin = globalThis.location?.origin || 'http://localhost';
  const requestUrl = new URL(url, origin);
  const apiUrl = new URL(API_BASE_URL, origin);
  return requestUrl.origin === apiUrl.origin && requestUrl.pathname.startsWith(apiUrl.pathname);
}
