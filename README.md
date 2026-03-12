# NJ School District AI Policy Dashboard

This dashboard gives you a map-first workflow for tracking AI policies by district.

## What is implemented
- Interactive Leaflet map scaffold centered on New Jersey
- Hover and click behavior for district polygons (when boundary GeoJSON is present)
- District detail panel with policy PDF and source link slots
- Search box for district names
- Auto-populated `data/policies.json` from your current PDF filenames
- Fallback mode that still lists policy PDFs if the district boundary file is not loaded yet

## Files
- `index.html` - dashboard layout
- `styles.css` - dashboard styling
- `app.js` - map and interaction logic
- `data/policies.json` - policy records you can keep enriching
- `data/nj-school-districts.geojson` - boundary placeholder (replace with real district boundaries)

## Next data step
1. District boundaries are now sourced from NJ Office of GIS/NJGIN ArcGIS services and merged:
   - `School_Districts___Elementary` (171)
   - `School_Districts___Secondary` (46)
   - `School_Districts___Unified` (339)
2. Refresh boundaries anytime:

```bash
./scripts/fetch_nj_district_geojson.sh
```

3. Use the dashboard dropdown to filter district type (`All`, `Unified`, `Secondary`, `Elementary`).
4. Ensure each feature has one of these fields for district name matching:
   - `DISTRICT`, `DIST_NAME`, `DISTRICT_NAME`, `NAME`, `name`, or `district`
5. Open `data/policies.json` and fill each record's:
   - `source_url` (school board page where policy was found)
   - `notes` (optional)
   - `status` (for example: `collected`, `verified`, `needs_review`)

## Run locally
From this folder, run a local static server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
