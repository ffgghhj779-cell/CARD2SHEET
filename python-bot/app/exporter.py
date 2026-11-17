import io

import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .store import HEADERS, KEYS, all_rows


def build_xlsx() -> bytes | None:
    rows = all_rows()
    if not rows:
        return None
    df = pd.DataFrame([[r[k] for k in KEYS] for r in rows], columns=HEADERS)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        df.to_excel(xw, index=False, sheet_name="Leads")
        ws = xw.sheets["Leads"]
        ws.sheet_view.rightToLeft = False
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        head_fill = PatternFill("solid", fgColor="1F4E78")
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(horizontal="center", vertical="center")
        for i, col in enumerate(df.columns, start=1):
            width = max(len(str(col)), *(len(str(v)) for v in df[col])) + 3
            ws.column_dimensions[get_column_letter(i)].width = min(width, 50)
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.number_format = "@"  # keep phones as text
                c.alignment = Alignment(vertical="top", wrap_text=True)
    return buf.getvalue()
