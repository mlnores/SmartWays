import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce, shareReplay } from 'rxjs';

const SMARTWAYS_CONFIG = globalThis as typeof globalThis & {
  SMARTWAYS_CONFIG?: {
    apiBaseUrl?: string;
  };
};
const API_BASE_URL = SMARTWAYS_CONFIG.SMARTWAYS_CONFIG?.apiBaseUrl || 'http://127.0.0.1:8000/api';
const PHOTON_BASE_URL = 'https://photon.komoot.io';

export interface ApiPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BufferPoiLookupResult {
  id: number | string;
}

export interface CountryBounds {
  country: string;
  bounds: [[number, number], [number, number]];
}

export interface Translation {
  id?: number;
  language_code: string;
  title?: string;
  name?: string;
  description?: string;
  slug?: string;
  is_reference?: boolean;
}

export interface Itinerary {
  id: number;
  enabled: boolean;
  route: number | null;
  route_title: string | null;
  route_slug: string | null;
  stage_number: number | null;
  route_memberships: ItineraryRouteMembership[];
  itinerary_json: unknown;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  translations: Translation[];
  media: MediaAsset[];
}

export interface ItineraryIsochrone {
  id: number;
  itinerary: number;
  minutes: number;
  mode: string;
  provider: string;
  geometry: unknown;
  source_route_hash: string;
  source_segment_count: number;
  sample_distance_meters: number;
  simplify_tolerance_meters: number;
  smooth_iterations: number;
  generated_at: string;
}

export interface ItineraryIsochroneJob {
  id: number;
  itinerary: number;
  itinerary_title: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  priority: number;
  mode: string;
  minutes: number[];
  source_route_hash: string;
  sample_distance_meters: number;
  simplify_tolerance_meters: number;
  smooth_iterations: number;
  estimated_request_count: number;
  provider_request_count: number;
  attempts: number;
  requested_manually: boolean;
  last_error: string;
  not_before: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItineraryRouteMembership {
  route: number;
  route_title: string | null;
  route_slug: string | null;
  stage_number: number;
}

export interface ItineraryPayload {
  enabled: boolean;
  route?: number | null;
  stage_number?: number | null;
  itinerary_json: unknown;
  translations: Array<{
    language_code: string;
    title: string;
    description?: string;
    is_reference?: boolean;
  }>;
  media?: MediaAsset[];
}

export interface Route {
  id: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  itinerary_count: number;
  translations: Translation[];
  media: MediaAsset[];
}

export interface RoutePayload {
  enabled: boolean;
  translations: Array<{
    language_code: string;
    title: string;
    description?: string;
    is_reference?: boolean;
  }>;
  media?: MediaAsset[];
}

export interface ItineraryStageAssignment {
  id: number;
  stage_number: number;
}

export interface Category {
  id: number;
  slug: string;
  name: string | null;
  translations: Translation[];
}

export interface CategoryPayload {
  slug: string;
  translations: Array<{
    language_code: string;
    name: string;
  }>;
}

export interface PoiImage {
  id?: number;
  image_url: string;
  position: number;
  is_primary: boolean;
}

export interface MediaAsset {
  id?: number;
  media_type: 'image' | 'video' | 'audio' | 'document' | 'link' | 'other';
  url: string;
  file_url?: string;
  image_url?: string;
  original_filename?: string;
  content_type?: string;
  size?: number | null;
  position: number;
  is_primary: boolean;
  translations?: PoiMediaTranslation[];
}

export type PoiMedia = MediaAsset;

export interface PoiMediaTranslation {
  id?: number;
  language_code: string;
  caption: string;
}

export interface Poi {
  id: number;
  enabled: boolean;
  country_code: string;
  gps_latitude: number;
  gps_longitude: number;
  website: string;
  phone: string;
  email: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  categories: Array<{ id: number; slug: string; name: string | null }>;
  translations: Translation[];
  media: PoiMedia[];
  images: PoiImage[];
  itinerary_inclusions: PoiItineraryInclusion[];
}

export interface PoiItineraryInclusion {
  itinerary: number;
  itinerary_title: string | null;
  route: number | null;
  route_title: string | null;
  stage_number: number | null;
}

export interface PoiPayload {
  enabled: boolean;
  country_code?: string;
  gps_latitude?: number;
  gps_longitude?: number;
  website?: string;
  phone?: string;
  email?: string;
  category_ids?: number[];
  translations?: Array<{
    language_code: string;
    title: string;
    description?: string;
    slug?: string;
    is_reference?: boolean;
  }>;
  media?: PoiMedia[];
  images?: PoiImage[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private countryBoundsCache = new Map<string, Observable<CountryBounds>>();

  constructor(private readonly http: HttpClient) {}

  listItineraries(query = '', language = '', route?: number | 'null'): Observable<ApiPage<Itinerary>> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    if (route !== undefined) {
      params = params.set('route', String(route));
    }
    return this.http.get<ApiPage<Itinerary>>(`${API_BASE_URL}/itineraries/`, { params });
  }

  listAllItineraries(query = '', language = '', route?: number | 'null'): Observable<Itinerary[]> {
    return this.collectPages(this.listItineraries(query, language, route));
  }

  createItinerary(payload: ItineraryPayload): Observable<Itinerary> {
    return this.http.post<Itinerary>(`${API_BASE_URL}/itineraries/`, payload);
  }

  updateItinerary(id: number, payload: Partial<ItineraryPayload>): Observable<Itinerary> {
    return this.http.patch<Itinerary>(`${API_BASE_URL}/itineraries/${id}/`, payload);
  }

  uploadItineraryMedia(
    itineraryId: number,
    file: File,
    mediaType: MediaAsset['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<MediaAsset> {
    const formData = this.mediaFormData(file, mediaType, position, isPrimary, translations);
    formData.append('itinerary', String(itineraryId));
    return this.http.post<MediaAsset>(`${API_BASE_URL}/itinerary-media/`, formData);
  }

  updateItineraryMedia(
    mediaId: number,
    file: File,
    mediaType: MediaAsset['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<MediaAsset> {
    return this.http.patch<MediaAsset>(
      `${API_BASE_URL}/itinerary-media/${mediaId}/`,
      this.mediaFormData(file, mediaType, position, isPrimary, translations)
    );
  }

  getItinerary(id: number | string, language = ''): Observable<Itinerary> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    return this.http.get<Itinerary>(`${API_BASE_URL}/itineraries/${encodeURIComponent(String(id))}/`, { params });
  }

  getItineraryIsochrones(id: number | string, mode = 'foot'): Observable<{ results: ItineraryIsochrone[] }> {
    const params = new HttpParams().set('mode', mode);
    return this.http.get<{ results: ItineraryIsochrone[] }>(
      `${API_BASE_URL}/itineraries/${encodeURIComponent(String(id))}/isochrones/`,
      { params }
    );
  }

  requestItineraryIsochrones(id: number | string): Observable<{ detail: string; job: ItineraryIsochroneJob | null }> {
    return this.http.post<{ detail: string; job: ItineraryIsochroneJob | null }>(
      `${API_BASE_URL}/itineraries/${encodeURIComponent(String(id))}/request-isochrones/`,
      { force: true }
    );
  }

  listItineraryIsochroneJobs(params: { status?: string; pending?: boolean; itinerary?: number | string } = {}): Observable<ApiPage<ItineraryIsochroneJob>> {
    let httpParams = new HttpParams();
    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.pending !== undefined) {
      httpParams = httpParams.set('pending', String(params.pending));
    }
    if (params.itinerary !== undefined) {
      httpParams = httpParams.set('itinerary', String(params.itinerary));
    }
    return this.http.get<ApiPage<ItineraryIsochroneJob>>(`${API_BASE_URL}/itinerary-isochrone-jobs/`, { params: httpParams });
  }

  deleteItinerary(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/itineraries/${id}/`);
  }

  listRoutes(query = '', language = ''): Observable<ApiPage<Route>> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Route>>(`${API_BASE_URL}/routes/`, { params });
  }

  listAllRoutes(query = '', language = ''): Observable<Route[]> {
    return this.collectPages(this.listRoutes(query, language));
  }

  createRoute(payload: RoutePayload): Observable<Route> {
    return this.http.post<Route>(`${API_BASE_URL}/routes/`, payload);
  }

  updateRoute(id: number, payload: Partial<RoutePayload>): Observable<Route> {
    return this.http.patch<Route>(`${API_BASE_URL}/routes/${id}/`, payload);
  }

  uploadRouteMedia(
    routeId: number,
    file: File,
    mediaType: MediaAsset['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<MediaAsset> {
    const formData = this.mediaFormData(file, mediaType, position, isPrimary, translations);
    formData.append('route', String(routeId));
    return this.http.post<MediaAsset>(`${API_BASE_URL}/route-media/`, formData);
  }

  updateRouteMedia(
    mediaId: number,
    file: File,
    mediaType: MediaAsset['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<MediaAsset> {
    return this.http.patch<MediaAsset>(
      `${API_BASE_URL}/route-media/${mediaId}/`,
      this.mediaFormData(file, mediaType, position, isPrimary, translations)
    );
  }

  deleteRoute(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/routes/${id}/`);
  }

  reorderRouteItineraries(routeId: number, itineraries: ItineraryStageAssignment[]): Observable<Itinerary[]> {
    return this.http.post<Itinerary[]>(`${API_BASE_URL}/routes/${routeId}/reorder-itineraries/`, { itineraries });
  }

  removeItineraryFromRoute(routeId: number, itineraryId: number): Observable<Itinerary> {
    return this.http.post<Itinerary>(`${API_BASE_URL}/routes/${routeId}/remove-itinerary/`, { itinerary: itineraryId });
  }

  addItinerariesToRoute(routeId: number, itineraryIds: number[]): Observable<Itinerary[]> {
    return this.http.post<Itinerary[]>(`${API_BASE_URL}/routes/${routeId}/add-itineraries/`, { itineraries: itineraryIds });
  }

  listPois(
    query = '',
    language = '',
    enabled?: boolean,
    category?: number | string,
    country?: string,
    ids?: Array<number | string>,
    bbox?: string,
    page?: number
  ): Observable<ApiPage<Poi>> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    if (enabled !== undefined) {
      params = params.set('enabled', String(enabled));
    }
    if (category !== undefined && category !== null && String(category).trim()) {
      params = params.set('category', String(category).trim());
    }
    const countryFilter = (country || '').trim();
    if (countryFilter) {
      params = params.set('country', countryFilter.toUpperCase());
    }
    if (ids && ids.length > 0) {
      params = params.set('ids', ids.map(id => String(id)).join(','));
    }
    if (bbox) {
      params = params.set('bbox', bbox);
    }
    if (page && page > 1) {
      params = params.set('page', String(page));
    }
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Poi>>(`${API_BASE_URL}/pois/`, { params });
  }

  listAllPois(
    query = '',
    language = '',
    enabled?: boolean,
    category?: number | string,
    country?: string,
    ids?: Array<number | string>,
    bbox?: string
  ): Observable<Poi[]> {
    return this.collectPages(this.listPois(query, language, enabled, category, country, ids, bbox));
  }

  findBufferPois(buffer: unknown, segmentIndex: number, limit = 200, language = ''): Observable<{ results: BufferPoiLookupResult[] }> {
    return this.http.post<{ results: BufferPoiLookupResult[] }>(`${API_BASE_URL}/buffer-pois/`, {
      buffer,
      segmentIndex,
      limit,
      language
    });
  }

  createPoi(payload: PoiPayload): Observable<Poi> {
    return this.http.post<Poi>(`${API_BASE_URL}/pois/`, payload);
  }

  getPoi(id: number | string, language = ''): Observable<Poi> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    return this.http.get<Poi>(`${API_BASE_URL}/pois/${encodeURIComponent(String(id))}/`, { params });
  }

  updatePoi(id: number, payload: Partial<PoiPayload>): Observable<Poi> {
    return this.http.patch<Poi>(`${API_BASE_URL}/pois/${id}/`, payload);
  }

  deletePoi(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/pois/${id}/`);
  }

  uploadPoiMedia(
    poiId: number,
    file: File,
    mediaType: PoiMedia['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<PoiMedia> {
    const formData = new FormData();
    formData.append('poi', String(poiId));
    formData.append('file', file);
    formData.append('media_type', mediaType);
    formData.append('position', String(position));
    formData.append('is_primary', String(isPrimary));
    formData.append('translations', JSON.stringify(translations));
    return this.http.post<PoiMedia>(`${API_BASE_URL}/poi-media/`, formData);
  }

  updatePoiMedia(
    mediaId: number,
    file: File,
    mediaType: PoiMedia['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[] = []
  ): Observable<PoiMedia> {
    return this.http.patch<PoiMedia>(
      `${API_BASE_URL}/poi-media/${mediaId}/`,
      this.mediaFormData(file, mediaType, position, isPrimary, translations)
    );
  }

  listPoiCountries(): Observable<string[]> {
    return this.http.get<{ results: string[] }>(`${API_BASE_URL}/pois/countries/`).pipe(
      map(response => response.results)
    );
  }

  getCountryBounds(countryCode: string, latLng?: number[]): Observable<CountryBounds> {
    const country = countryCode.trim().toUpperCase();
    const cacheKey = latLng ? `${country}:${latLng[0].toFixed(5)},${latLng[1].toFixed(5)}` : country;
    const cached = this.countryBoundsCache.get(cacheKey);
    if (cached) return cached;

    let params = new HttpParams().set('country', country);
    if (latLng) {
      params = params.set('lat', String(latLng[0]));
      params = params.set('lng', String(latLng[1]));
    }
    const request = this.http.get<CountryBounds>(`${API_BASE_URL}/pois/country-bounds/`, {
      params
    }).pipe(shareReplay(1));
    this.countryBoundsCache.set(cacheKey, request);
    return request;
  }

  getCountryAt(latitude: number, longitude: number): Observable<{ country: string }> {
    const params = new HttpParams()
      .set('lat', String(latitude))
      .set('lng', String(longitude));
    return this.http.get<{ country: string }>(`${API_BASE_URL}/pois/country-at/`, { params });
  }

  reverseGeocode(latitude: number, longitude: number): Observable<{ features?: unknown[] }> {
    const params = new HttpParams()
      .set('lat', latitude.toFixed(6))
      .set('lon', longitude.toFixed(6));
    return this.http.get<{ features?: unknown[] }>(`${PHOTON_BASE_URL}/reverse`, { params });
  }

  listCategories(query = '', language = ''): Observable<ApiPage<Category>> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Category>>(`${API_BASE_URL}/categories/`, { params });
  }

  listAllCategories(query = '', language = ''): Observable<Category[]> {
    return this.collectPages(this.listCategories(query, language));
  }

  createCategory(payload: CategoryPayload): Observable<Category> {
    return this.http.post<Category>(`${API_BASE_URL}/categories/`, payload);
  }

  updateCategory(id: number, payload: Partial<CategoryPayload>): Observable<Category> {
    return this.http.patch<Category>(`${API_BASE_URL}/categories/${id}/`, payload);
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/categories/${id}/`);
  }

  mergeCategory(sourceId: number, targetId: number): Observable<Category> {
    return this.http.post<Category>(`${API_BASE_URL}/categories/${sourceId}/merge/`, { target: targetId });
  }

  private collectPages<T>(firstPage: Observable<ApiPage<T>>): Observable<T[]> {
    return firstPage.pipe(
      expand(page => page.next ? this.http.get<ApiPage<T>>(this.apiPageUrl(page.next)) : EMPTY),
      map(page => page.results),
      reduce((items, pageItems) => [...items, ...pageItems], [] as T[])
    );
  }

  private apiPageUrl(nextUrl: string): string {
    try {
      const parsedNextUrl = new URL(nextUrl, globalThis.location?.origin || 'http://localhost');
      const parsedApiBaseUrl = new URL(API_BASE_URL, globalThis.location?.origin || 'http://localhost');
      return `${parsedApiBaseUrl.origin}${parsedNextUrl.pathname}${parsedNextUrl.search}`;
    } catch {
      return nextUrl;
    }
  }

  private mediaFormData(
    file: File,
    mediaType: MediaAsset['media_type'],
    position: number,
    isPrimary: boolean,
    translations: PoiMediaTranslation[]
  ): FormData {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('media_type', mediaType);
    formData.append('position', String(position));
    formData.append('is_primary', String(isPrimary));
    formData.append('translations', JSON.stringify(translations));
    return formData;
  }
}
