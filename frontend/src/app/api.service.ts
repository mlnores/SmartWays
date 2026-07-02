import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';

const API_BASE_URL = 'http://127.0.0.1:8000/api';

export interface ApiPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Translation {
  id?: number;
  language_code: string;
  title?: string;
  name?: string;
  description?: string;
  slug?: string;
}

export interface Itinerary {
  id: number;
  enabled: boolean;
  route: number | null;
  route_title: string | null;
  route_slug: string | null;
  stage_number: number | null;
  itinerary_json: unknown;
  created_at: string;
  updated_at: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  translations: Translation[];
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
  }>;
}

export interface Poi {
  id: number;
  enabled: boolean;
  gps_latitude: number;
  gps_longitude: number;
  title: string | null;
  description: string | null;
  slug: string | null;
  categories: Array<{ id: number; slug: string; name: string | null }>;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  listItineraries(query = '', language = 'en', route?: number | 'null'): Observable<ApiPage<Itinerary>> {
    let params = new HttpParams().set('language', language);
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    if (route !== undefined) {
      params = params.set('route', String(route));
    }
    return this.http.get<ApiPage<Itinerary>>(`${API_BASE_URL}/itineraries/`, { params });
  }

  listAllItineraries(query = '', language = 'en', route?: number | 'null'): Observable<Itinerary[]> {
    return this.collectPages(this.listItineraries(query, language, route));
  }

  createItinerary(payload: ItineraryPayload): Observable<Itinerary> {
    return this.http.post<Itinerary>(`${API_BASE_URL}/itineraries/`, payload);
  }

  updateItinerary(id: number, payload: Partial<ItineraryPayload>): Observable<Itinerary> {
    return this.http.patch<Itinerary>(`${API_BASE_URL}/itineraries/${id}/`, payload);
  }

  listRoutes(query = '', language = 'en'): Observable<ApiPage<Route>> {
    let params = new HttpParams().set('language', language);
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Route>>(`${API_BASE_URL}/routes/`, { params });
  }

  listAllRoutes(query = '', language = 'en'): Observable<Route[]> {
    return this.collectPages(this.listRoutes(query, language));
  }

  createRoute(payload: RoutePayload): Observable<Route> {
    return this.http.post<Route>(`${API_BASE_URL}/routes/`, payload);
  }

  updateRoute(id: number, payload: Partial<RoutePayload>): Observable<Route> {
    return this.http.patch<Route>(`${API_BASE_URL}/routes/${id}/`, payload);
  }

  listPois(query = '', language = 'en'): Observable<ApiPage<Poi>> {
    let params = new HttpParams()
      .set('language', language)
      .set('enabled', 'true');
    if (query.trim()) {
      params = params.set('q', query.trim());
    }
    return this.http.get<ApiPage<Poi>>(`${API_BASE_URL}/pois/`, { params });
  }

  private collectPages<T>(firstPage: Observable<ApiPage<T>>): Observable<T[]> {
    return firstPage.pipe(
      expand(page => page.next ? this.http.get<ApiPage<T>>(page.next) : EMPTY),
      map(page => page.results),
      reduce((items, pageItems) => [...items, ...pageItems], [] as T[])
    );
  }
}
