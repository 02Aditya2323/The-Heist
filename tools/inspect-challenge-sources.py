"""Read-only extraction of the supplied challenge book and tracker for implementation audit."""
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader
from openpyxl import load_workbook

root = Path(__file__).resolve().parents[1]
pdf = root / "The Heist Zero Hour Challenge Book (Final).pdf"
xlsx = root / "The_Heist_Challenge_Tracker_and_Money_Plan.xlsx"
out = root / ".codex-doc-review" / "challenge-sources"
out.mkdir(parents=True, exist_ok=True)
pages = [{"page": i + 1, "text": page.extract_text(extraction_mode="layout")} for i, page in enumerate(PdfReader(pdf).pages)]
values = load_workbook(xlsx, data_only=True, read_only=True)
formulas = load_workbook(xlsx, data_only=False, read_only=True)
sheets = []
for sheet in formulas:
    rows = []
    for row in sheet:
        cells = [{"cell": c.coordinate, "value": c.value, "cached": values[sheet.title][c.coordinate].value} for c in row if c.value is not None]
        if cells:
            rows.append(cells)
    sheets.append({"name": sheet.title, "rows": rows, "dimensions": sheet.calculate_dimension()})
data = {"sources": [{"file": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in [pdf, xlsx]], "pages": pages, "sheets": sheets}
(out / "extracted.json").write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
(out / "book.txt").write_text("\n\n".join(f"=== PAGE {p['page']} ===\n{p['text']}" for p in pages), encoding="utf-8")
(out / "workbook.txt").write_text("\n\n".join(f"=== SHEET {s['name']} / {s['dimensions']} ===\n" + "\n".join(" | ".join(f"{c['cell']}: {c['value']}" + (f" [cached={c['cached']}]" if str(c['value']).startswith('=') else '') for c in row) for row in s['rows']) for s in sheets), encoding="utf-8")
print(json.dumps({"pages": len(pages), "sheets": [{"name": s['name'], "dimensions": s['dimensions']} for s in sheets], "output": str(out)}, indent=2))
