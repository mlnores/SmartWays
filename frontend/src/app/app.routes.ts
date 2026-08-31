import { Routes } from '@angular/router';

import { adminGuard, authGuard } from './auth.guard';
import { ItineraryEditorComponent } from './itinerary-editor.component';
import { ItineraryListComponent } from './itinerary-list.component';
import { FestEditorComponent } from './fest-editor.component';
import { FestListComponent } from './fest-list.component';
import { LoginComponent } from './login.component';
import { PoiEditorComponent } from './poi-editor.component';
import { PoiListComponent } from './poi-list.component';
import { RouteListComponent } from './route-list.component';
import { unsavedChangesGuard } from './unsaved-changes.guard';
import { UserManagementComponent } from './user-management.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'itineraries' },
  { path: 'login', component: LoginComponent },
  { path: 'users', component: UserManagementComponent, canActivate: [adminGuard] },
  { path: 'itineraries', component: ItineraryListComponent, canActivate: [authGuard] },
  { path: 'itineraries/new', component: ItineraryEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: 'itineraries/:id/edit', component: ItineraryEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: 'itineraries/:id/pois', component: PoiListComponent, canActivate: [authGuard] },
  { path: 'routes', component: RouteListComponent, canActivate: [authGuard] },
  { path: 'route/:slug', component: ItineraryListComponent, canActivate: [authGuard] },
  { path: 'pois', component: PoiListComponent, canActivate: [authGuard] },
  { path: 'pois/new', component: PoiEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: 'pois/:id/edit', component: PoiEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: 'fests', component: FestListComponent, canActivate: [authGuard] },
  { path: 'fests/new', component: FestEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: 'fests/:id/edit', component: FestEditorComponent, canActivate: [authGuard], canDeactivate: [unsavedChangesGuard] },
  { path: '**', redirectTo: 'itineraries' }
];
