#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import string
from collections import defaultdict
from pathlib import Path

import fitz
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from pypdf import PdfReader
from scipy.cluster.hierarchy import fcluster, leaves_list, linkage
from scipy.spatial.distance import squareform
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

matplotlib.use("Agg")


PDF_FOLDER = "output/ai_policy_collection/pdfs"
OUTPUT_FOLDER = "outputs"
TOP_N = 100
TOP_CLUSTER_PAIRS_N = 50
CLUSTER_THRESHOLD = 0.75


STOPWORDS = set(ENGLISH_STOP_WORDS)
PUNCT_TRANSLATION = str.maketrans("", "", string.punctuation)


def extract_text_pypdf(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n".join(pages)


def extract_text_fitz(pdf_path: Path) -> str:
    doc = fitz.open(pdf_path)
    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    return "\n".join(pages)


def extract_pdf_text(pdf_path: Path) -> tuple[str, str]:
    try:
        text = extract_text_pypdf(pdf_path)
        if text and text.strip():
            return text, "pypdf"
    except Exception:
        pass

    try:
        text = extract_text_fitz(pdf_path)
        if text and text.strip():
            return text, "fitz"
    except Exception:
        pass

    return "", "unreadable"


def clean_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\s+", " ", text)
    text = text.translate(PUNCT_TRANSLATION)
    tokens = [token for token in text.split() if token not in STOPWORDS]
    return " ".join(tokens)


def build_pairs_df(filenames: list[str], similarity_matrix) -> pd.DataFrame:
    rows = []
    total_docs = len(filenames)
    for i in range(total_docs):
        for j in range(i + 1, total_docs):
            rows.append(
                {
                    "doc_1": filenames[i],
                    "doc_2": filenames[j],
                    "cosine_similarity": float(similarity_matrix[i, j]),
                }
            )
    pairs_df = pd.DataFrame(rows)
    if not pairs_df.empty:
        pairs_df = pairs_df.sort_values("cosine_similarity", ascending=False, ignore_index=True)
    return pairs_df


def similarity_groups(filenames: list[str], similarity_matrix, threshold: float) -> list[list[str]]:
    graph = defaultdict(set)
    total_docs = len(filenames)
    for i in range(total_docs):
        for j in range(i + 1, total_docs):
            if similarity_matrix[i, j] >= threshold:
                graph[i].add(j)
                graph[j].add(i)

    seen = set()
    groups = []
    for node in range(total_docs):
        if node in seen or not graph[node]:
            continue
        stack = [node]
        component = []
        seen.add(node)
        while stack:
            current = stack.pop()
            component.append(filenames[current])
            for neighbor in graph[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    stack.append(neighbor)
        groups.append(sorted(component))

    groups.sort(key=lambda group: (-len(group), group[0]))
    return groups


def save_heatmap(matrix_df: pd.DataFrame, output_path: Path) -> None:
    n_docs = len(matrix_df)
    fig_width = max(12, min(36, n_docs * 0.22))
    fig_height = max(10, min(32, n_docs * 0.22))
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    im = ax.imshow(matrix_df.values, cmap="YlOrRd", vmin=0, vmax=1, aspect="auto")
    ax.set_xticks(range(n_docs))
    ax.set_yticks(range(n_docs))
    ax.set_xticklabels(matrix_df.columns, rotation=90, fontsize=6)
    ax.set_yticklabels(matrix_df.index, fontsize=6)
    ax.set_title("Cosine Similarity Heatmap")
    fig.colorbar(im, ax=ax, fraction=0.02, pad=0.02, label="Cosine similarity")
    plt.tight_layout()
    fig.savefig(output_path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def hierarchical_order_and_clusters(similarity_matrix, threshold: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    distance_matrix = 1 - np.asarray(similarity_matrix, dtype=float)
    distance_matrix = np.clip(distance_matrix, 0.0, 1.0)
    np.fill_diagonal(distance_matrix, 0.0)
    condensed = squareform(distance_matrix, checks=False)
    linkage_matrix = linkage(condensed, method="average")
    order = leaves_list(linkage_matrix)
    cluster_ids = fcluster(linkage_matrix, t=1 - threshold, criterion="distance")
    return order, cluster_ids, linkage_matrix


def save_clustered_heatmaps(matrix_df: pd.DataFrame, output_labeled: Path, output_simple: Path) -> None:
    n_docs = len(matrix_df)

    fig_width = max(16, min(44, n_docs * 0.26))
    fig_height = max(14, min(40, n_docs * 0.26))
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    im = ax.imshow(matrix_df.values, cmap="YlOrRd", vmin=0, vmax=1, aspect="auto", interpolation="nearest")
    ax.set_xticks(range(n_docs))
    ax.set_yticks(range(n_docs))
    ax.set_xticklabels(matrix_df.columns, rotation=90, fontsize=5)
    ax.set_yticklabels(matrix_df.index, fontsize=5)
    ax.set_title("Clustered Cosine Similarity Heatmap")
    fig.colorbar(im, ax=ax, fraction=0.02, pad=0.02, label="Cosine similarity")
    plt.tight_layout()
    fig.savefig(output_labeled, dpi=240, bbox_inches="tight")
    plt.close(fig)

    fig2, ax2 = plt.subplots(figsize=(12, 10))
    im2 = ax2.imshow(matrix_df.values, cmap="YlOrRd", vmin=0, vmax=1, aspect="auto", interpolation="nearest")
    ax2.set_xticks([])
    ax2.set_yticks([])
    ax2.set_title("Clustered Cosine Similarity Heatmap (Simplified)")
    fig2.colorbar(im2, ax=ax2, fraction=0.03, pad=0.02, label="Cosine similarity")
    plt.tight_layout()
    fig2.savefig(output_simple, dpi=220, bbox_inches="tight")
    plt.close(fig2)


def build_cluster_df(filenames: list[str], cluster_ids: np.ndarray) -> pd.DataFrame:
    cluster_df = pd.DataFrame({"document": filenames, "cluster_id": cluster_ids})
    cluster_sizes = cluster_df["cluster_id"].value_counts().to_dict()
    cluster_df["cluster_size"] = cluster_df["cluster_id"].map(cluster_sizes)
    cluster_df = cluster_df.sort_values(
        by=["cluster_size", "cluster_id", "document"],
        ascending=[False, True, True],
        ignore_index=True,
    )
    return cluster_df


def build_dashboard_html(
    filenames: list[str],
    pairs_df: pd.DataFrame,
    top_25_df: pd.DataFrame,
    groups: list[list[str]],
    unreadable_docs: list[str],
    output_path: Path,
) -> None:
    pair_records = pairs_df.to_dict(orient="records")
    top_records = top_25_df.to_dict(orient="records")
    groups_payload = [
        {"group_size": len(group), "documents": group}
        for group in groups[:25]
    ]
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PDF Similarity Dashboard</title>
  <style>
    :root {{
      --bg: #f4f1e8;
      --panel: #fffdfa;
      --ink: #1f2933;
      --muted: #6b7280;
      --line: #d8d1c2;
      --accent: #a63d40;
      --low: #e8f3e8;
      --mid: #f8e6a8;
      --high: #e68873;
    }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background: linear-gradient(180deg, #efe9da 0%, var(--bg) 100%);
    }}
    main {{
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
    }}
    h1, h2 {{
      margin: 0 0 12px;
      font-weight: 700;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(66, 46, 26, 0.07);
    }}
    .controls {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }}
    input[type="search"], select {{
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      min-width: 220px;
      background: white;
    }}
    input[type="range"] {{
      width: 240px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 14px;
      overflow: hidden;
    }}
    th, td {{
      padding: 10px 12px;
      border-bottom: 1px solid #eee7da;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }}
    th {{
      position: sticky;
      top: 0;
      background: #f6efe2;
      cursor: pointer;
    }}
    .table-wrap {{
      max-height: 640px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: white;
    }}
    .score {{
      font-weight: 700;
      border-radius: 999px;
      display: inline-block;
      min-width: 78px;
      text-align: center;
      padding: 6px 10px;
    }}
    .group-list {{
      display: grid;
      gap: 12px;
    }}
    .group {{
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      background: white;
    }}
    .small {{
      color: var(--muted);
      font-size: 13px;
    }}
    .pill {{
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      background: #f1ece2;
      margin: 4px 6px 0 0;
      font-size: 12px;
    }}
  </style>
</head>
<body>
<main>
  <h1>PDF Similarity Dashboard</h1>
  <p class="small">Documents: __DOC_COUNT__ | Pairwise comparisons: __PAIR_COUNT__ | Unreadable PDFs: __UNREADABLE_COUNT__</p>

  <section class="grid">
    <div class="card"><h2>Top 25 Pairs</h2><div id="top25"></div></div>
    <div class="card"><h2>Highly Similar Groups</h2><p class="small">Connected components where cosine similarity is at least __CLUSTER_THRESHOLD__.</p><div id="groups"></div></div>
    <div class="card"><h2>Unreadable PDFs</h2><div id="unreadable"></div></div>
  </section>

  <section class="card">
    <h2>All Document Pairs</h2>
    <div class="controls">
      <input id="searchBox" type="search" placeholder="Search filenames">
      <label>Minimum similarity <span id="thresholdValue">0.00</span></label>
      <input id="thresholdSlider" type="range" min="0" max="1" step="0.01" value="0">
      <select id="sortSelect">
        <option value="desc">Highest similarity first</option>
        <option value="asc">Lowest similarity first</option>
      </select>
      <span class="small" id="rowCount"></span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-sort="doc_1">Document 1</th>
            <th data-sort="doc_2">Document 2</th>
            <th data-sort="cosine_similarity">Cosine similarity</th>
          </tr>
        </thead>
        <tbody id="pairsTableBody"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
const pairData = __PAIR_DATA__;
const topData = __TOP_DATA__;
const groupsData = __GROUP_DATA__;
const unreadableData = __UNREADABLE_DATA__;

const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdValue = document.getElementById("thresholdValue");
const searchBox = document.getElementById("searchBox");
const sortSelect = document.getElementById("sortSelect");
const rowCount = document.getElementById("rowCount");
const pairsTableBody = document.getElementById("pairsTableBody");

function scoreClass(score) {{
  if (score >= 0.85) return "var(--high)";
  if (score >= 0.6) return "var(--mid)";
  return "var(--low)";
}}

function renderTop25() {{
  const rows = topData.map(row => `
    <tr>
      <td>${{row.doc_1}}</td>
      <td>${{row.doc_2}}</td>
      <td><span class="score" style="background:${{scoreClass(row.cosine_similarity)}}">${{row.cosine_similarity.toFixed(4)}}</span></td>
    </tr>
  `).join("");
  document.getElementById("top25").innerHTML = `
    <div class="table-wrap" style="max-height:360px">
      <table><thead><tr><th>Document 1</th><th>Document 2</th><th>Similarity</th></tr></thead><tbody>${{rows}}</tbody></table>
    </div>
  `;
}}

function renderGroups() {{
  if (!groupsData.length) {{
    document.getElementById("groups").innerHTML = '<p class="small">No groups met the similarity threshold.</p>';
    return;
  }}
  document.getElementById("groups").innerHTML = `
    <div class="group-list">
      ${groupsData.map(group => `
        <div class="group">
          <strong>${{group.group_size}} documents</strong>
          <div>${group.documents.map(doc => `<span class="pill">${{doc}}</span>`).join("")}</div>
        </div>
      `).join("")}
    </div>
  `;
}}

function renderUnreadable() {{
  if (!unreadableData.length) {{
    document.getElementById("unreadable").innerHTML = '<p class="small">All PDFs were readable with the available parsers.</p>';
    return;
  }}
  document.getElementById("unreadable").innerHTML = unreadableData.map(doc => `<div class="pill">${{doc}}</div>`).join("");
}}

function renderPairs() {{
  const threshold = parseFloat(thresholdSlider.value);
  thresholdValue.textContent = threshold.toFixed(2);
  const query = searchBox.value.trim().toLowerCase();
  const sortDir = sortSelect.value;
  let rows = pairData.filter(row => row.cosine_similarity >= threshold);
  if (query) {{
    rows = rows.filter(row => row.doc_1.toLowerCase().includes(query) || row.doc_2.toLowerCase().includes(query));
  }}
  rows = rows.sort((a, b) => sortDir === "desc" ? b.cosine_similarity - a.cosine_similarity : a.cosine_similarity - b.cosine_similarity);
  rowCount.textContent = `${{rows.length}} pairs shown`;
  pairsTableBody.innerHTML = rows.map(row => `
    <tr>
      <td>${{row.doc_1}}</td>
      <td>${{row.doc_2}}</td>
      <td><span class="score" style="background:${{scoreClass(row.cosine_similarity)}}">${{row.cosine_similarity.toFixed(4)}}</span></td>
    </tr>
  `).join("");
}}

thresholdSlider.addEventListener("input", renderPairs);
searchBox.addEventListener("input", renderPairs);
sortSelect.addEventListener("change", renderPairs);
document.querySelectorAll("th[data-sort]").forEach(th => {{
  th.addEventListener("click", () => {{
    if (th.dataset.sort === "cosine_similarity") {{
      sortSelect.value = sortSelect.value === "desc" ? "asc" : "desc";
      renderPairs();
    }}
  }});
}});

renderTop25();
renderGroups();
renderUnreadable();
renderPairs();
</script>
</body>
</html>
"""
    html = (
        html.replace("__DOC_COUNT__", str(len(filenames)))
        .replace("__PAIR_COUNT__", str(len(pair_records)))
        .replace("__UNREADABLE_COUNT__", str(len(unreadable_docs)))
        .replace("__CLUSTER_THRESHOLD__", f"{CLUSTER_THRESHOLD:.2f}")
        .replace("__PAIR_DATA__", json.dumps(pair_records))
        .replace("__TOP_DATA__", json.dumps(top_records))
        .replace("__GROUP_DATA__", json.dumps(groups_payload))
        .replace("__UNREADABLE_DATA__", json.dumps(unreadable_docs))
    )
    output_path.write_text(html, encoding="utf-8")


def main() -> None:
    pdf_dir = Path(PDF_FOLDER)
    output_dir = Path(OUTPUT_FOLDER)
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_paths = sorted(pdf_dir.glob("*.pdf"))
    if not pdf_paths:
        raise SystemExit(f"No PDFs found in {pdf_dir}")

    records = []
    unreadable_docs = []

    for idx, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{idx}/{len(pdf_paths)}] Processing {pdf_path.name}")
        raw_text, parser_used = extract_pdf_text(pdf_path)
        cleaned_text = clean_text(raw_text) if raw_text else ""
        if not cleaned_text.strip():
            unreadable_docs.append(pdf_path.name)
        records.append(
            {
                "filename": pdf_path.name,
                "parser_used": parser_used,
                "raw_text": raw_text,
                "cleaned_text": cleaned_text,
            }
        )

    docs_df = pd.DataFrame(records)
    readable_df = docs_df[docs_df["cleaned_text"].str.len() > 0].copy()
    if readable_df.empty:
        raise SystemExit("No readable PDFs were found.")

    vectorizer = TfidfVectorizer()
    tfidf_matrix = vectorizer.fit_transform(readable_df["cleaned_text"])
    similarity = cosine_similarity(tfidf_matrix)

    filenames = readable_df["filename"].tolist()
    matrix_df = pd.DataFrame(similarity, index=filenames, columns=filenames)
    pairs_df = build_pairs_df(filenames, similarity)
    top_pairs_df = pairs_df.head(TOP_N).copy()
    top_50_pairs_df = pairs_df.head(TOP_CLUSTER_PAIRS_N).copy()
    top_25_df = pairs_df.head(25).copy()
    groups = similarity_groups(filenames, similarity, CLUSTER_THRESHOLD)
    order, cluster_ids, _ = hierarchical_order_and_clusters(similarity, CLUSTER_THRESHOLD)
    ordered_filenames = [filenames[i] for i in order]
    clustered_matrix_df = matrix_df.iloc[order, order]
    cluster_df = build_cluster_df(filenames, cluster_ids)

    matrix_df.to_csv(output_dir / "cosine_similarity_matrix.csv")
    pairs_df.to_csv(output_dir / "cosine_similarity_pairs.csv", index=False)
    top_pairs_df.to_csv(output_dir / "top_similar_pairs.csv", index=False)
    top_50_pairs_df.to_csv(output_dir / "top_50_similar_pairs.csv", index=False)
    cluster_df.to_csv(output_dir / "document_clusters.csv", index=False)
    save_heatmap(matrix_df, output_dir / "cosine_similarity_heatmap.png")
    save_clustered_heatmaps(
        clustered_matrix_df,
        output_dir / "clustered_similarity_heatmap.png",
        output_dir / "clustered_similarity_heatmap_simplified.png",
    )
    build_dashboard_html(
        filenames=filenames,
        pairs_df=pairs_df,
        top_25_df=top_25_df,
        groups=groups,
        unreadable_docs=unreadable_docs,
        output_path=output_dir / "similarity_dashboard.html",
    )

    if pairs_df.empty:
        score_min = score_max = 0.0
    else:
        score_min = float(pairs_df["cosine_similarity"].min())
        score_max = float(pairs_df["cosine_similarity"].max())

    lines = [
        f"PDFs processed: {len(pdf_paths)}",
        f"Readable PDFs used for similarity: {len(filenames)}",
        f"Unreadable PDFs: {len(unreadable_docs)}",
        "",
        "Top 10 most similar pairs:",
    ]
    for _, row in pairs_df.head(10).iterrows():
        lines.append(
            f"- {row['doc_1']} <> {row['doc_2']}: {row['cosine_similarity']:.4f}"
        )
    lines.extend(
        [
            "",
            f"Cosine similarity range across non-self pairs: {score_min:.4f} to {score_max:.4f}",
            f"Highly similar groups at threshold {CLUSTER_THRESHOLD:.2f}: {len(groups)}",
        ]
    )
    if unreadable_docs:
        lines.extend(["", "Unreadable PDFs:"])
        lines.extend(f"- {doc}" for doc in unreadable_docs)

    (output_dir / "summary.txt").write_text("\n".join(lines), encoding="utf-8")

    cluster_counts = cluster_df.groupby("cluster_id", as_index=False)["document"].count().rename(columns={"document": "cluster_size"})
    cluster_counts = cluster_counts.sort_values(["cluster_size", "cluster_id"], ascending=[False, True], ignore_index=True)
    large_clusters = cluster_counts.head(10)
    duplicate_like = cluster_counts[cluster_counts["cluster_size"] >= 2]
    cluster_lines = [
        f"Readable PDFs clustered: {len(filenames)}",
        f"Clusters found at similarity threshold {CLUSTER_THRESHOLD:.2f}: {len(cluster_counts)}",
        "",
        "Largest clusters:",
    ]
    for _, row in large_clusters.iterrows():
        docs = cluster_df[cluster_df["cluster_id"] == row["cluster_id"]]["document"].tolist()[:8]
        cluster_lines.append(
            f"- Cluster {int(row['cluster_id'])}: {int(row['cluster_size'])} documents | examples: {', '.join(docs)}"
        )
    cluster_lines.extend(
        [
            "",
            f"Clusters with 2+ documents: {len(duplicate_like)}",
            "Near-duplicate/template signal: "
            + (
                "Yes. Multiple multi-document clusters and several cosine scores near 1.0 suggest template-based or reused policy text."
                if len(duplicate_like) > 0 and (pairs_df["cosine_similarity"].head(20) >= 0.95).any()
                else "Limited. Most documents do not appear to form strong near-duplicate groups."
            ),
            "",
            "Interpretation notes:",
            "- Cluster IDs are derived from hierarchical clustering on TF-IDF cosine distance.",
            "- Documents in the same cluster meet the distance cut implied by the similarity threshold.",
            "- The labeled clustered heatmap preserves document names; the simplified version emphasizes block structure.",
        ]
    )
    (output_dir / "cluster_summary.txt").write_text("\n".join(cluster_lines), encoding="utf-8")
    print(f"Saved outputs to {output_dir.resolve()}")


if __name__ == "__main__":
    main()
