# SmartWays Frontend

The frontend is an Angular 18 application for browsing, editing, previewing, and publishing SmartWays routes, itineraries, and POIs.

It is intentionally operational rather than public-facing: the UI is for curators and project operators who manage route data, POI metadata, translations, linked media, publication state, and map-based workflows.

## Main Responsibilities

The frontend provides:

- route list and route detail pages;
- itinerary list and itinerary editor;
- POI list and POI viewer/editor;
- map previews for routes, itineraries, and POIs;
- draft/public state controls;
- media management for routes, itineraries, and POIs;
- category management for POIs;
- route construction tools for adding/importing itineraries;
- search, sorting, map-area filtering, selection, and bulk actions.

## Requirements

- Node.js 20+ recommended.
- npm.
- Backend API running locally or available through Docker/Nginx.

Install dependencies:

```bash
npm install
```

## Running Locally

Start the Angular development server:

```bash
npm start
```

Open:

```text
http://localhost:4200/
```

In development, the Angular app talks to the backend API configured by the runtime frontend config. For direct local development, the expected backend is normally:

```text
http://127.0.0.1:8000/api/
```

Start the backend separately from `../backend`:

```bash
cd ../backend
python manage.py runserver
```

## Build and Checks

Production build:

```bash
npm run build
```

Type/template check used during development:

```bash
npm exec tsc -- --noEmit --project tsconfig.app.json
```

Unit tests:

```bash
npm test
```

## Runtime Configuration

The Docker image writes a runtime config file:

```text
/smartways-config.js
```

This allows the same frontend build to use different backend API locations. In Docker, the default is:

```text
SMARTWAYS_API_BASE_URL=/api
```

The Nginx container serves Angular and proxies `/api/` to the backend.

## External Map Libraries

The editor and preview maps currently rely on global CDN-loaded libraries from `src/index.html`:

- Leaflet
- Leaflet MarkerCluster
- Turf

This was kept deliberately to reduce dependency churn during the iframe-to-Angular migration. Components expect these libraries on `window`.

## Application Routes

```text
/routes                         Route list
/route/:slug                    Itineraries/stages for one route

/itineraries                    Itinerary list
/itineraries/new                New itinerary editor
/itineraries/:id/edit           Itinerary editor
/itineraries/:id/pois           POIs included in and near an itinerary

/pois                           POI list
/pois/new                       Create draft POI
/pois/:id/edit                  POI viewer/editor
```

## Route Pages

`/routes` shows route rows and a map preview. Users can:

- select one or more routes;
- sort by title, stages, or draft state;
- preview selected route lines;
- fit the map to the current selection;
- turn selected routes public/draft;
- delete draft routes;
- manage metadata, media, and translations for a single selected draft route.

`/route/:slug` shows the itineraries of one route. For draft routes, users can:

- drag rows to reorder stages;
- create a new itinerary for the route;
- add existing itineraries;
- import itineraries from another route or from unassigned itineraries;
- manage route metadata, translations, and media;
- remove or delete draft itinerary memberships as allowed by the backend.

Public routes are read-only. Their controls remain visible where useful, but disabled.

## Itinerary Pages

`/itineraries` supports:

- plain list and grouped-by-route views;
- initially folded route groups;
- selection and bulk actions;
- map preview of selected itineraries;
- filtering the list to the visible map area;
- route inclusion badges;
- sorting by title, length, and draft state;
- managing metadata, media, and translations for one selected draft itinerary.

`/itineraries/:id/edit` is the map-based itinerary editor. It supports:

- adding waypoints and POIs;
- converting waypoints into draft POIs;
- editing segment/path definitions;
- viewing buffer regions;
- searching backend POIs;
- showing buffer POIs with category filters;
- adding POIs to the itinerary;
- undo/redo shortcuts;
- unsaved-change protection;
- returning to the caller route/list while preserving navigation context.

`/itineraries/:id/pois` lists:

- POIs included directly in the itinerary;
- nearby POIs found in segment buffer zones.

The page includes a map preview with the itinerary line and POI markers.

## POI Pages

`/pois` supports:

- search by title or category;
- category and country filters;
- map-area filter;
- paginated `Load more`;
- selection and map preview;
- sorting by title, country, and draft state;
- category management;
- creating new draft POIs;
- viewing public POIs;
- managing metadata, media, and translations for draft POIs.

`/pois/:id/edit` and `/pois/new` share the POI viewer/editor.

The editor includes:

- basic information in the reference language;
- title refresh from geocoder;
- map-based location picking;
- automatic country code lookup;
- category chooser with available/chosen panes;
- translation tabs;
- media tab with local file upload, remote URL support, primary media, and translatable captions;
- draft/public state switch;
- unsaved-change protection.

Public POIs are read-only except for state changes allowed by backend rules.

## Shared Components and Styles

Important files:

```text
src/app/api.service.ts                    Main backend REST client
src/app/editor-api.service.ts             Itinerary editor API wrapper
src/app/app.routes.ts                     Angular routes
src/app/resource-list.css                 Shared list/preview styling
src/app/media-manager-dialog.component.ts Route/itinerary metadata-media dialog
src/app/route-list.component.ts           Route list and route detail behavior
src/app/itinerary-list.component.ts       Itinerary list and route itinerary list
src/app/poi-list.component.ts             POI list and itinerary POI list
src/app/poi-editor.component.ts           POI viewer/editor
src/app/itinerary-editor.component.ts     Itinerary editor shell
src/app/itinerary-editor.runtime.js       Legacy editor runtime ported into Angular
```

The itinerary editor is still partly a large runtime-oriented implementation. New behavior should prefer Angular bindings and services, but avoid large refactors unless the feature needs them.

## Draft/Public Semantics

The frontend labels `enabled=False` as draft and `enabled=True` as public.

UI rules mirror backend rules:

- draft content can be edited;
- public content is read-only;
- destructive and edit actions are hidden or disabled for public content;
- publication state changes require confirmation;
- cascades are performed by the backend and reflected after reload.

Backend validation is authoritative.

## Navigation Context

Several routes pass `returnTo`, `returnLabel`, `highlight`, and segment-related query params. This preserves user context when navigating between:

- route detail and itinerary editor;
- itinerary editor and POI editor;
- POI list and POI editor;
- itinerary list and itinerary POI list.

When adding new navigation to an editor/detail page, preserve these query parameters where possible.

## Development Notes

- Prefer editing shared list behavior in `resource-list.css` only when it applies to routes, itineraries, and POIs.
- Keep map initialization resilient to hidden tabs/dialogs by invalidating Leaflet size after visibility changes.
- For route and itinerary metadata/media dialogs, use the shared `MediaManagerDialogComponent`.
- For POI metadata/media/translations, use `PoiEditorComponent`; POI translation is not managed from list action dialogs.
- Avoid exposing slugs in operational list UIs unless they are needed for debugging.

## Docker

The frontend Docker image builds Angular and serves the result with Nginx. The container also writes runtime config for the API base URL.

For local Docker deployment from the repo root:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:4200/
```

