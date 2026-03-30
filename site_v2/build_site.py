from __future__ import annotations

import csv
import json
import math
import re
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Iterable

from openpyxl import load_workbook


REPO_ROOT = Path(__file__).resolve().parents[1]
INPUT_XLSX = REPO_ROOT / "Copy of NJ AI Policies Schools List (3-30).xlsx"
POLICIES_JSON = REPO_ROOT / "data" / "policies.json"
SOURCE_GEOJSON = REPO_ROOT / "data" / "nj-school-districts.geojson"
OUTPUT_DIR = REPO_ROOT / "site_v2" / "data"

OUTPUT_JSON = OUTPUT_DIR / "district_dataset.json"
OUTPUT_CSV = OUTPUT_DIR / "district_dataset.csv"
OUTPUT_SUMMARY = OUTPUT_DIR / "build_summary.json"
OUTPUT_GEOJSON = OUTPUT_DIR / "nj-school-districts.geojson"


STOPWORDS = {
    "district",
    "school",
    "schools",
    "board",
    "education",
    "township",
    "city",
    "borough",
    "regional",
    "public",
    "of",
    "the",
    "county",
}

TEXT_FIXES = {
    "disrict": "district",
    "distrcit": "district",
    "irvngton": "irvington",
    "passsaic": "passaic",
}

FIELD_ALIASES = {
    "id": ["ID"],
    "district_name": ["District Name"],
    "county": ["County"],
    "minority_enrollment": ["Minority Enrollment"],
    "below_poverty": ["Below Poverty"],
    "district_size_class": [
        "District Size Class (small<2500, medium 2500-9999, large>=10000)"
    ],
    "population": ["NCES District Population (2024-2025)"],
    "snap": ["SNAP"],
    "district_website": ["District Website"],
    "relevant_policy_link": ["Relevant AI Policy Documents"],
    "policy_label_sheet": [None],
    "policy_label_notes": [None],
    "outside_search_documents": ["Outside Search Perameters Documents"],
}


def clean_cell(value):
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if text == "*":
            return None
        return text or None
    return value


def clean_text(value):
    value = clean_cell(value)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def to_number(value):
    value = clean_cell(value)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)

    text = str(value).strip()
    if not text:
        return None
    text = text.replace(",", "")
    text = text.replace("%%", "%")
    text = re.sub(r"%+$", "", text)
    try:
        return float(text)
    except ValueError:
        return None


def as_fraction(value):
    number = to_number(value)
    if number is None:
        return None
    return number / 100.0 if number > 1 else number


def looks_like_url(value):
    text = clean_text(value)
    if not text:
        return False
    text = text.lower()
    return text.startswith("http://") or text.startswith("https://")


def canonicalize_name(name):
    text = clean_text(name) or ""
    text = text.lower().replace("&", " and ")
    text = text.replace("distrcit", "district")
    for bad, good in TEXT_FIXES.items():
        text = re.sub(rf"\b{re.escape(bad)}\b", good, text)
    return text


def normalize_name(name):
    parts = re.sub(r"[^a-z0-9\s]", " ", canonicalize_name(name)).split()
    return " ".join(part for part in parts if part not in STOPWORDS)


def first_nonempty(*values):
    for value in values:
        cleaned = clean_text(value)
        if cleaned:
            return cleaned
    return None


def unique_in_order(values: Iterable[str]) -> list[str]:
    seen = OrderedDict()
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        key = text.lower()
        if key not in seen:
            seen[key] = text
    return list(seen.values())


def extract_policy_labels(*values):
    labels = []

    for value in values:
        if value is None:
            continue

        if isinstance(value, (int, float)) and not isinstance(value, bool):
            number = int(value)
            if 1000 <= number <= 9999:
                labels.append(str(number))
            continue

        text = clean_text(value)
        if not text:
            continue

        for match in re.findall(r"(?i)(?:policyid|regulationid)=([0-9]{3,4})", text):
            labels.append(match)

        if "policy" in text.lower() or "artificial" in text.lower() or "regulation" in text.lower():
            for match in re.findall(r"\b([0-9]{3,4}(?:-[0-9]{1,2})?)\b", text):
                if match.startswith("20") and len(match) == 4:
                    continue
                labels.append(match)

    return unique_in_order(labels)


def choose_policy_link(sheet_link, outside_docs, policy_record):
    if looks_like_url(sheet_link):
        return clean_text(sheet_link)
    if policy_record and looks_like_url(policy_record.get("source_url")):
        return clean_text(policy_record.get("source_url"))
    if looks_like_url(outside_docs):
        return clean_text(outside_docs)
    if looks_like_url(policy_record.get("policy_file") if policy_record else None):
        return clean_text(policy_record.get("policy_file"))
    return None


def load_policy_index():
    items = json.loads(POLICIES_JSON.read_text(encoding="utf-8"))
    index = {}
    for item in items:
        key = normalize_name(item.get("district"))
        if key and key not in index:
            index[key] = item
    return items, index


def resolve_policy_record(policy_index, district_name):
    key = normalize_name(district_name)
    if not key:
        return None
    if key in policy_index:
        return policy_index[key]
    for known_key, item in policy_index.items():
        if known_key in key or key in known_key:
            return item
    return None


def get_column_map(headers):
    normalized_headers = [clean_text(header) for header in headers]
    blank_positions = [idx for idx, header in enumerate(normalized_headers) if header is None]
    column_map = {}
    for field, aliases in FIELD_ALIASES.items():
        if aliases == [None]:
            column_map[field] = None
            continue
        for alias in aliases:
            if alias in normalized_headers:
                column_map[field] = normalized_headers.index(alias)
                break
        else:
            column_map[field] = None

    if blank_positions:
        column_map["policy_label_sheet"] = blank_positions[0]
    if len(blank_positions) > 1:
        column_map["policy_label_notes"] = blank_positions[1]
    return column_map


def make_row_dict(row, column_map):
    def value_for(field):
        idx = column_map.get(field)
        if idx is None or idx >= len(row):
            return None
        return clean_cell(row[idx])

    return {field: value_for(field) for field in column_map}


def build_records():
    _, policy_index = load_policy_index()
    workbook = load_workbook(INPUT_XLSX, data_only=True, read_only=True)
    sheet = workbook.active

    headers = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
    column_map = get_column_map(headers)

    records = []
    missing_star_count = 0
    for raw_row in sheet.iter_rows(min_row=2, values_only=True):
        district_name = clean_text(raw_row[column_map["district_name"]])
        if not district_name:
            continue

        row = make_row_dict(raw_row, column_map)
        missing_star_count += sum(1 for value in raw_row if value == "*")

        policy_record = resolve_policy_record(policy_index, district_name)
        sheet_policy_link = row["relevant_policy_link"]
        outside_docs = row["outside_search_documents"]

        policy_labels = extract_policy_labels(
            row["policy_label_sheet"],
            row["policy_label_notes"],
            sheet_policy_link,
            outside_docs,
            policy_record.get("source_url") if policy_record else None,
            policy_record.get("notes") if policy_record else None,
        )

        policy_link = choose_policy_link(sheet_policy_link, outside_docs, policy_record)
        has_ai_policy = bool(
            policy_link
            or policy_labels
            or (policy_record and policy_record.get("policy_file"))
        )

        district_website = clean_text(row["district_website"])
        if district_website and not looks_like_url(district_website):
            district_website = None

        record = {
            "id": clean_text(row["id"]),
            "district_name": district_name,
            "county": clean_text(row["county"]) or "Unknown",
            "normalized_name": normalize_name(district_name),
            "district_website": district_website,
            "minority_enrollment": as_fraction(row["minority_enrollment"]),
            "below_poverty": as_fraction(row["below_poverty"]),
            "snap": as_fraction(row["snap"]),
            "population": to_number(row["population"]),
            "district_size_class": clean_text(row["district_size_class"]) or "unknown",
            "has_ai_policy": has_ai_policy,
            "policy_label": ", ".join(policy_labels) if policy_labels else None,
            "policy_link": policy_link,
            "policy_file": clean_text(policy_record.get("policy_file")) if policy_record else None,
            "policy_status": clean_text(policy_record.get("status")) if policy_record else None,
            "policy_notes": first_nonempty(
                row["policy_label_notes"],
                policy_record.get("notes") if policy_record else None,
            ),
            "outside_search_documents": clean_text(outside_docs),
        }
        records.append(record)

    records.sort(key=lambda item: item["district_name"])
    return records, missing_star_count


def summary_payload(records, missing_star_count):
    with_policy = sum(1 for row in records if row["has_ai_policy"])
    with_labels = sum(1 for row in records if row["policy_label"])
    with_map_demographics = {
        "minority_enrollment": sum(1 for row in records if row["minority_enrollment"] is not None),
        "below_poverty": sum(1 for row in records if row["below_poverty"] is not None),
        "snap": sum(1 for row in records if row["snap"] is not None),
        "population": sum(1 for row in records if row["population"] is not None),
    }

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source_workbook": INPUT_XLSX.name,
        "record_count": len(records),
        "districts_with_ai_policy": with_policy,
        "districts_with_policy_label": with_labels,
        "star_cells_converted_to_missing": missing_star_count,
        "demographic_non_missing_counts": with_map_demographics,
        "policy_label_rule": (
            "Policy labels prefer the unlabeled workbook column after "
            "'Relevant AI Policy Documents', then fall back to label extraction from "
            "policy URLs/text such as policyid=5701 or filenames containing AI policy numbers."
        ),
    }


def write_outputs(records, summary):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps({"summary": summary, "records": records}, indent=2),
        encoding="utf-8",
    )

    fieldnames = [
        "id",
        "district_name",
        "county",
        "normalized_name",
        "minority_enrollment",
        "below_poverty",
        "snap",
        "population",
        "district_size_class",
        "district_website",
        "has_ai_policy",
        "policy_label",
        "policy_link",
        "policy_file",
        "policy_status",
        "policy_notes",
        "outside_search_documents",
    ]
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)

    OUTPUT_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    OUTPUT_GEOJSON.write_text(SOURCE_GEOJSON.read_text(encoding="utf-8"), encoding="utf-8")


def main():
    records, missing_star_count = build_records()
    summary = summary_payload(records, missing_star_count)
    write_outputs(records, summary)
    print(f"Wrote {len(records)} records to {OUTPUT_JSON}")
    print(f"Wrote CSV to {OUTPUT_CSV}")
    print(f"Converted '*' cells to missing: {missing_star_count}")


if __name__ == "__main__":
    main()
