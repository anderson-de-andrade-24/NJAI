# Site v2

This site now reads the district-level 2025-2026 workbook and builds a self-contained static map plus dashboard experience.

- Source workbook default: `~/Downloads/5-25_with_ai_policy (1).xlsx`
- Override workbook path: set `NJAI_WORKBOOK=/full/path/to/workbook.xlsx`
- Build script: `build_site.py`
- Output dataset: `data/district_dataset.json`
- Output CSV: `data/district_dataset.csv`
- Map boundaries: `data/nj-school-districts.geojson`

The generated dataset keeps the table views compact while preserving richer sections for:

- policy and revision dates
- race composition
- grade distribution
- student support indicators such as FRPL, multilingual learners, migrant, military, and homeless
- district profile fields such as urbanicity, school count, and district type

Run:

```bash
python3 build_site.py
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`
- `http://localhost:8000/dashboard/`
