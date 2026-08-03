import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, map, of, switchMap, tap, throwError } from 'rxjs';

import { API_BASE_URL, isSmartWaysApiUrl } from './api-config';

let csrfTokenFromApi = '';

export type UserRole = 'admin' | 'editor';

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

export interface UserPayload {
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly currentUserSubject = new BehaviorSubject<CurrentUser | null>(null);
  private loaded = false;

  readonly currentUser$ = this.currentUserSubject.asObservable();
  readonly isLoggedIn$ = this.currentUser$.pipe(map(user => !!user));
  readonly isAdmin$ = this.currentUser$.pipe(map(user => user?.role === 'admin'));

  loadCurrentUser(): Observable<CurrentUser | null> {
    if (this.loaded) {
      return of(this.currentUserSubject.value);
    }
    return this.http.get<CurrentUser>(`${API_BASE_URL}/auth/me/`).pipe(
      tap(user => {
        this.loaded = true;
        this.currentUserSubject.next(user);
      }),
      map(user => user),
      catchError(error => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.loaded = true;
          this.currentUserSubject.next(null);
          return of(null);
        }
        return throwError(() => error);
      })
    );
  }

  login(username: string, password: string): Observable<CurrentUser> {
    return this.ensureCsrf().pipe(
      switchMap(() => this.http.post<CurrentUser>(`${API_BASE_URL}/auth/login/`, { username, password })),
      tap(user => {
        this.loaded = true;
        this.currentUserSubject.next(user);
      })
    );
  }

  logout(): Observable<void> {
    return this.ensureCsrf().pipe(
      switchMap(() => this.http.post<{ detail: string }>(`${API_BASE_URL}/auth/logout/`, {})),
      tap(() => {
        this.loaded = true;
        this.currentUserSubject.next(null);
      }),
      map(() => undefined)
    );
  }

  listUsers(): Observable<CurrentUser[]> {
    return this.http.get<{ results: CurrentUser[] } | CurrentUser[]>(`${API_BASE_URL}/users/`).pipe(
      map(response => Array.isArray(response) ? response : response.results)
    );
  }

  createUser(payload: UserPayload): Observable<CurrentUser> {
    return this.http.post<CurrentUser>(`${API_BASE_URL}/users/`, payload);
  }

  updateUser(userId: number, payload: Partial<UserPayload>): Observable<CurrentUser> {
    return this.http.patch<CurrentUser>(`${API_BASE_URL}/users/${userId}/`, payload);
  }

  deactivateUser(userId: number): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/users/${userId}/`);
  }

  private ensureCsrf(): Observable<{ detail: string; csrfToken: string }> {
    return this.http.get<{ detail: string; csrfToken: string }>(`${API_BASE_URL}/auth/csrf/`).pipe(
      tap(response => csrfTokenFromApi = response.csrfToken || csrfTokenFromApi)
    );
  }
}

export const authHttpInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isSmartWaysApiUrl(request.url)) {
    return next(request);
  }

  const csrfToken = getCookie('csrftoken') || csrfTokenFromApi;
  const isUnsafeMethod = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(request.method.toUpperCase());
  const setHeaders = csrfToken && isUnsafeMethod ? { 'X-CSRFToken': csrfToken } : undefined;
  return next(request.clone({ withCredentials: true, setHeaders }));
};

function getCookie(name: string): string {
  const cookie = document.cookie
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}
