"""Export the assigned Markdown cases as editable Word worksheets (stdlib only)."""

from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PACKETS = ROOT / "docs" / "assistant-test-packets"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ET.register_namespace("w", W)
ET.register_namespace("r", R)
STATUSES = ("Not run", "Pass", "Fail", "Blocked", "Not applicable")
GREEN, PALE, BORDER = "164D3D", "EDF4F0", "CBD8D0"
WIDTH = 9906


def element(parent, name, text=None, **attrs):
    node = ET.SubElement(parent, "{" + W + "}" + name,
                         {"{" + W + "}" + k: str(v) for k, v in attrs.items()})
    if text is not None:
        node.text = str(text)
    return node


def run(parent, text, bold=False, color=None):
    node = element(parent, "r")
    if bold or color:
        props = element(node, "rPr")
        if bold:
            element(props, "b")
        if color:
            element(props, "color", val=color)
    value = element(node, "t", text=text)
    value.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return node


def paragraph(parent, text="", style=None, page_break=False):
    node = element(parent, "p")
    if style or page_break:
        props = element(node, "pPr")
        if style:
            element(props, "pStyle", val=style)
        if page_break:
            element(props, "pageBreakBefore")
    if text:
        run(node, text)
    return node


def labeled(parent, label, text):
    node = paragraph(parent)
    run(node, label + " ", bold=True, color=GREEN)
    run(node, text)


def xml(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def read_packet(number):
    text = (PACKETS / f"tester-{number}.md").read_text(encoding="utf-8")
    title = re.search(r"^# (.+)$", text, re.M).group(1)
    cases = []
    for match in re.finditer(r"^### ([A-Z]+-\d{2})\s*\n(.*?)(?=^### |\Z)", text, re.M | re.S):
        case_id, block = match.groups()
        role = re.search(r"\*\*Role:\*\* (.+?) \| \*\*Effect:\*\* (.+)", block)
        setup = re.search(r"\*\*Setup:\*\* (.+)", block)
        question = re.search(r"^> (.+)$", block, re.M)
        expected = re.search(r"\*\*Expected:\*\* (.+)", block)
        if not all((role, setup, question, expected)):
            raise ValueError("Incomplete source case: " + case_id)
        cases.append(dict(id=case_id, role=role[1], effect=role[2],
                          setup=setup[1], question=question[1], expected=expected[1]))
    expected_count = {1: 54, 2: 55, 3: 55}[number]
    if len(cases) != expected_count or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("Unexpected or duplicate assignment count")
    accounts = re.search(r"\*\*Accounts:\*\* (.+)", text)[1]
    return title, accounts, cases


class Worksheet:
    def __init__(self, number):
        self.number = number
        self.next_id = 0
        self.doc = ET.Element("{" + W + "}document")
        self.body = element(self.doc, "body")

    def field(self, parent, tag, prompt, dropdown=False):
        self.next_id += 1
        sdt = element(parent, "sdt")
        props = element(sdt, "sdtPr")
        element(props, "alias", val=tag.replace("_", " "))
        element(props, "tag", val=tag)
        element(props, "id", val=self.next_id)
        if dropdown:
            choices = element(props, "dropDownList")
            for value in STATUSES:
                element(choices, "listItem", displayText=value, value=value)
        content = element(sdt, "sdtContent")
        # No text subtype means a rich-text control: multiline replies and pasted
        # screenshots are editable. The status control uses Word's dropdown.
        paragraph(content, "Not run" if dropdown else "[" + prompt + "]", "Field")
        return sdt

    def table(self, parent):
        table = element(parent, "tbl")
        props = element(table, "tblPr")
        element(props, "tblW", w=WIDTH, type="dxa")
        element(props, "tblLayout", type="fixed")
        margins = element(props, "tblCellMar")
        for side in ("top", "left", "bottom", "right"):
            element(margins, side, w=85, type="dxa")
        borders = element(props, "tblBorders")
        for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
            element(borders, side, val="single", sz=4, color=BORDER)
        grid = element(table, "tblGrid")
        for width in (2250, WIDTH - 2250):
            element(grid, "gridCol", w=width)
        return table

    def row(self, table, label, tag, prompt, height=390, dropdown=False):
        row = element(table, "tr")
        props = element(row, "trPr")
        element(props, "cantSplit")
        element(props, "trHeight", val=height, hRule="atLeast")
        for index, width in enumerate((2250, WIDTH - 2250)):
            cell = element(row, "tc")
            cp = element(cell, "tcPr")
            element(cp, "tcW", w=width, type="dxa")
            element(cp, "vAlign", val="top")
            element(cp, "shd", fill=PALE if index == 0 else "FFFFFF", val="clear")
            if index == 0:
                p = paragraph(cell, style="Field")
                run(p, label, bold=True, color=GREEN)
            else:
                self.field(cell, tag, prompt, dropdown)
                # Word cells end with a paragraph, including after block controls.
                paragraph(cell, style="CellEnd")

    def cover(self, title, accounts, count):
        paragraph(self.body, "GREEN LINK DIGITAL BANK", "Subtitle")
        paragraph(self.body, "Assistant test response worksheet", "Title")
        paragraph(self.body, title, "Heading1")
        paragraph(self.body, f"{count} assigned cases | Prepared 19 November 2026 (Singapore)")
        table = self.table(self.body)
        for label, tag, prompt in (
            ("Tester name", "tester_name", "Enter your name"),
            ("Website / environment", "environment", "Enter the website URL and environment"),
            ("Deployed app commit", "deployment", "Enter the commit shown in Vercel"),
            ("Session date / time", "session_time", "Record date, start and finish time in Singapore"),
            ("Browser / viewport", "browser", "Record browser/version and desktop/mobile viewport"),
            ("Login identity", "identity", "Record test email/role only; never a password"),
        ):
            self.row(table, label, tag, prompt)
        paragraph(self.body)
        labeled(self.body, "Accounts:", accounts)
        for instruction in (
            "Click inside the response fields to type or paste. Choose a result from each status dropdown. Save your own copy with your name. Keep the question and expected result unchanged.",
            "Record the assistant's actual response and exact error. For UI steps, describe what happened. Label each wording variant, role or follow-up separately; a case passes only when all required variants pass.",
            "Leave Not run until tested. Use Blocked for missing data/access/owner setup. A refusal passes only an intentional negative test; an unexpected error is not a pass for a supported question.",
            "Use fresh placeholder values and booked account slots. Work in batches of 10-15 requests with no more than two simultaneous assistant runs. Follow owner-controlled setup for write/outage/security cases.",
            "Keep passwords, OTPs, recovery codes, cookies and API keys out of responses and screenshots. Store completed worksheets in the team's private results location.",
        ):
            paragraph(self.body, instruction, "Small")
        paragraph(self.body, "Setup and account booking: https://github.com/DisguisedKairos/FYP/blob/main/docs/assistant-team-testing.md", "Small")

    def case(self, case):
        paragraph(self.body, case["id"], "Heading1", page_break=True)
        labeled(self.body, "Role / effect:", case["role"] + " / " + case["effect"])
        labeled(self.body, "Setup:", case["setup"])
        paragraph(self.body, "QUESTION OR TESTER STEPS", "Label")
        paragraph(self.body, case["question"], "Question")
        paragraph(self.body, "EXPECTED RESULT", "Label")
        paragraph(self.body, case["expected"])
        table = self.table(self.body)
        rows = (
            ("Actual response / observed result", "response", "Paste the exact assistant response or describe the UI result. Label separate variants.", 2100, False),
            ("Error / unexpected behaviour", "error", "Enter None if no error. Otherwise paste the exact error and explain what went wrong.", 1000, False),
            ("Result", "status", "", 390, True),
            ("Time / role / variant", "context", "Record Singapore time, login/role and the variant tested", 450, False),
            ("Screenshot / evidence", "evidence", "Paste a sanitized screenshot or evidence reference", 650, False),
            ("Bug ID / retest notes", "retest", "Record bug ID/severity, reproduction notes and any retest commit/result", 700, False),
        )
        for label, tag, prompt, height, dropdown in rows:
            self.row(table, label, case["id"] + "_" + tag, prompt, height, dropdown)

    def finish(self):
        sect = element(self.body, "sectPr")
        element(sect, "headerReference", type="default").set("{" + R + "}id", "rIdHeader")
        element(sect, "footerReference", type="default").set("{" + R + "}id", "rIdFooter")
        element(sect, "pgSz", w=11906, h=16838)
        element(sect, "pgMar", top=950, bottom=950, left=1000, right=1000, header=450, footer=450)


def styles():
    root = ET.Element("{" + W + "}styles")
    defaults = element(root, "docDefaults")
    rpr = element(element(defaults, "rPrDefault"), "rPr")
    element(rpr, "rFonts", ascii="Calibri", hAnsi="Calibri")
    element(rpr, "sz", val=21)
    element(rpr, "color", val="26382F")
    ppr = element(element(defaults, "pPrDefault"), "pPr")
    element(ppr, "spacing", after=90, line=250, lineRule="auto")
    for name, size, color, bold in (
        ("Normal", 21, "26382F", False), ("Title", 38, GREEN, True),
        ("Heading1", 29, GREEN, True), ("Subtitle", 20, GREEN, True),
        ("Label", 18, GREEN, True), ("Question", 22, GREEN, False),
        ("Field", 20, "37483F", False), ("Small", 18, "485B50", False),
        ("CellEnd", 2, "FFFFFF", False),
    ):
        style = element(root, "style", type="paragraph", styleId=name)
        element(style, "name", val=name)
        if name == "Normal":
            style.set("{" + W + "}default", "1")
        else:
            element(style, "basedOn", val="Normal")
        props = element(style, "pPr")
        spacing = element(props, "spacing", after=0 if name in ("Field", "CellEnd") else 90)
        if name in ("Heading1", "Label", "Subtitle"):
            element(props, "keepNext")
        if name == "CellEnd":
            for key, value in {"before": "0", "line": "20", "lineRule": "exact"}.items():
                spacing.set("{" + W + "}" + key, value)
        rp = element(style, "rPr")
        element(rp, "sz", val=size)
        element(rp, "color", val=color)
        if bold:
            element(rp, "b")
    return xml(root)


def header_footer(number, footer=False):
    root = ET.Element("{" + W + "}" + ("ftr" if footer else "hdr"))
    p = paragraph(root, style="Small")
    if footer:
        run(p, f"Tester {number} | Editable test record | Page ")
        field = element(p, "fldSimple", instr="PAGE")
        run(field, "1")
    else:
        run(p, "GREEN LINK DIGITAL BANK  |  C300 ASSISTANT TESTING", bold=True, color=GREEN)
    return xml(root)


def export(number):
    title, accounts, cases = read_packet(number)
    worksheet = Worksheet(number)
    worksheet.cover(title, accounts, len(cases))
    for case in cases:
        worksheet.case(case)
    worksheet.finish()
    types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>'''
    relationships = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
    docrels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>'''
    settings = ET.Element("{" + W + "}settings")
    element(settings, "updateFields", val="true")
    parts = {"[Content_Types].xml": types, "_rels/.rels": relationships,
             "word/document.xml": xml(worksheet.doc), "word/_rels/document.xml.rels": docrels,
             "word/styles.xml": styles(), "word/settings.xml": xml(settings),
             "word/header1.xml": header_footer(number), "word/footer1.xml": header_footer(number, True)}
    output = PACKETS / f"tester-{number}-results.docx"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name, content in parts.items():
            item = zipfile.ZipInfo(name, date_time=(2026, 11, 19, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(item, content)
    print(f"Tester {number}: {len(cases)} cases, {worksheet.next_id} editable controls -> {output.relative_to(ROOT)}")


if __name__ == "__main__":
    for tester in (1, 2, 3):
        export(tester)
