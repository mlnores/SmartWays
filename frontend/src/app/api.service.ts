import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce, shareReplay } from 'rxjs';

const API_BASE_URL = 'http://127.0.0.1:8000/api';

export interface ApiPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
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
}

export interface RoutePayload {
  enabled: boolean;
  translations: Array<{
    language_code: string;
    title: string;
    description?: string;
    is_reference?: boolean;
  }>;
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

export interface Poi {
  id: number;
  enabled: boolean;
  country_code: string;
  gps_latitude: number;
  gps_longitude: number;
  website: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  categories: Array<{ id: number; slug: string; name: string | null }>;
  translations: Translation[];
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
  category_ids?: number[];
  translations?: Array<{
    language_code: string;
    title: string;
    description?: string;
    slug?: string;
    is_reference?: boolean;
  }>;
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

  getItinerary(id: number | string, language = ''): Observable<Itinerary> {
    let params = new HttpParams();
    if (language) {
      params = params.set('language', language);
    }
    return this.http.get<Itinerary>(`${API_BASE_URL}/itineraries/${encodeURIComponent(String(id))}/`, { params });
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

  createPoi(payload: PoiPayload): Observable<Poi> {
    return this.http.post<Poi>(`${API_BASE_URL}/pois/`, payload);
  }

  updatePoi(id: number, payload: Partial<PoiPayload>): Observable<Poi> {
    return this.http.patch<Poi>(`${API_BASE_URL}/pois/${id}/`, payload);
  }

  deletePoi(id: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/pois/${id}/`);
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
      expand(page => page.next ? this.http.get<ApiPage<T>>(page.next) : EMPTY),
      map(page => page.results),
      reduce((items, pageItems) => [...items, ...pageItems], [] as T[])
    );
  }
}
