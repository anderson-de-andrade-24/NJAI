# Site v2

This version keeps the original site intact and builds a separate map/dashboard pair from the finalized workbook:

- Source workbook: `Copy of NJ AI Policies Schools List (3-30).xlsx`
- Build script: `site_v2/build_site.py`
- Self-contained static site folder: `site_v2/`
- Output dataset: `site_v2/data/district_dataset.json`
- Output CSV: `site_v2/data/district_dataset.csv`
- Copied map boundaries: `site_v2/data/nj-school-districts.geojson`

Policy label rule:
- Prefer the unlabeled workbook column immediately after `Relevant AI Policy Documents`
- Fall back to extracting labels from policy URLs or text such as `policyid=5701` or AI-policy filenames with numbers

Run:

```bash
python3 "/Users/anderson/Desktop/AI Policies folder/site_v2/build_site.py"
cd "/Users/anderson/Desktop/AI Policies folder" && python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/site_v2/`
- `http://localhost:8000/site_v2/dashboard/`

Public deployment:

- `site_v2/` is now self-contained and can be deployed directly to any static host
- A GitHub Pages workflow can publish this folder automatically from the repository
