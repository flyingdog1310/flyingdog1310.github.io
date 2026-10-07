"""從考選部下載律師第一試試題與標準答案，轉成 bar-exam/data/<年>.json。

用法（需要 PyMuPDF：python3 -m venv .venv && .venv/bin/pip install pymupdf）：
    .venv/bin/python bar-exam/tools/build_data.py

換年度時改下面的 YEAR、EXAM_DATE、MOEX_CODE（考選部「考試代碼」）與 PAPERS 最後一欄（阿摩試卷編號，
在 yamol.tw 搜尋該年「司法官特種考試_三等_司法官及律師」可找到，四科各一個）。
題目是考選部公告的試題（依著作權法第 9 條不受著作權保護）；詳解不轉載，只連到阿摩的題目頁。
"""

import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

import pymupdf

YEAR = 115
MOEX_CODE = '115110'
MOEX_CLASS = '302'  # 高等考試_律師
EXAM_DATE = '2026-08-01'
OUT = Path(__file__).resolve().parent.parent / 'data' / f'{YEAR}.json'

# (考選部科目代碼, id, 名稱, 範圍, 阿摩試卷編號)
PAPERS = [
    ('0101', 'public', '綜合法學(一)', '憲法、行政法、國際公法、國際私法', 143019),
    ('0301', 'criminal', '綜合法學(一)', '刑法、刑事訴訟法、法律倫理', 143018),
    ('0201', 'civil', '綜合法學(二)', '民法、民事訴訟法', 143022),
    ('0202', 'commercial', '綜合法學(二)', '公司法、保險法、票據法、證券交易法、強制執行法、法學英文', 143020),
]

# 試題 PDF 裡選項 (A)~(D) 與 ①② 是私人造字區的字
OPTION_GLYPHS = {'\ue18c': 'A', '\ue18d': 'B', '\ue18e': 'C', '\ue18f': 'D'}
CIRCLED = {chr(0xE129 + i): chr(0x2460 + i) for i in range(10)}
# 頁首（代號、頁次）在這個 y 座標以上；第一頁另以「第 1 題出現前都略過」處理
PAGE_TOP = 85


def fetch(url, dest):
    # 考選部的憑證缺 Subject Key Identifier，Python 3.13+ 的嚴格驗證會拒絕，所以用 curl 下載
    subprocess.run(['curl', '-sSfL', '-A', 'Mozilla/5.0', '-o', str(dest), url], check=True)
    return dest


def is_wide(ch):
    return ord(ch) >= 0x2E80


def join_line(a, b):
    if not a:
        return b
    # 英文跨行時補空白；中文直接接起來
    if not is_wide(a[-1]) and b[:1] and not is_wide(b[0]) and a[-1] not in ' (' and b[0] not in ' ),.;:':
        if a[-1].isalnum() or a[-1] in ',.;:’”' or b[0].isalnum():
            return a + ' ' + b
    return a + b


def tidy(text):
    text = re.sub(r'\s+', ' ', text).strip()
    # 中英數之間的排版空白拿掉（「2 個月」→「2個月」）
    text = re.sub(r'(?<=[⺀-￿])\s+(?=[0-9A-Za-z])|(?<=[0-9A-Za-z%])\s+(?=[⺀-￿])', '', text)
    text = re.sub(r'(?<=s’)(?=[a-z])', ' ', text)
    return text


def page_items(page):
    """回傳依閱讀順序排列的 (bbox, font, text)；填空的底線轉成「____」。"""
    items = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                items.append((span['bbox'], span['font'], ''.join(c['c'] for c in span['chars'])))
    for drawing in page.get_drawings():
        r = drawing['rect']
        if r.y0 > PAGE_TOP and r.height < 2 and r.width > 8:
            items.append(((r.x0, r.y0 - 11, r.x1, r.y0 + 1), 'blank', ' ____ '))
    # 以底端座標分行，同一行內由左到右
    items.sort(key=lambda it: it[0][3])
    rows = []
    for it in items:
        if rows and abs(it[0][3] - rows[-1][0][0][3]) < 4:
            rows[-1].append(it)
        else:
            rows.append([it])
    return [it for row in rows for it in sorted(row, key=lambda it: it[0][0])]


def parse_questions(path):
    questions = []
    cur, key = None, None
    for page in pymupdf.open(path):
        prev_bottom = None
        for (x0, y0, x1, y1), font, text in page_items(page):
            if y0 < PAGE_TOP:
                continue
            new_line = prev_bottom is None or abs(y1 - prev_bottom) > 4
            prev_bottom = y1
            # 題號：左側邊界的數字
            if x0 < 66 and font.startswith('TimesNewRoman') and text.strip().isdigit():
                n = int(text.strip())
                assert n == len(questions) + 1, (path, n)
                cur, key = {'n': n, 'stem': '', 'options': {}}, 'stem'
                questions.append(cur)
                continue
            if cur is None:
                continue
            if text in OPTION_GLYPHS:
                key = OPTION_GLYPHS[text]
                cur['options'][key] = ''
                continue
            text = ''.join(CIRCLED.get(c, c) for c in text)
            before = cur['stem'] if key == 'stem' else cur['options'][key]
            after = join_line(before, text) if new_line else before + text
            if key == 'stem':
                cur['stem'] = after
            else:
                cur['options'][key] = after
    for q in questions:
        q['stem'] = tidy(q['stem'])
        q['options'] = {k: tidy(v) for k, v in q['options'].items()}
        assert list(q['options']) == ['A', 'B', 'C', 'D'], q
    return questions


def parse_answers(path):
    """標準答案 PDF 是表格：每個「第N題」下方對到一個答案。"""
    heads, letters = [], []
    for block in pymupdf.open(path)[0].get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                text = span['text'].strip()
                m = re.fullmatch(r'第(\d+)題', text)
                if m:
                    heads.append((int(m.group(1)), span['bbox']))
                elif re.fullmatch(r'[A-D#＃]+(或[A-D]+)*', text):
                    letters.append((text, span['bbox']))
    answers = {}
    for text, (x0, y0, x1, y1) in letters:
        cx = (x0 + x1) / 2
        n, _ = min(
            (h for h in heads if h[1][3] <= y0 + 2),
            key=lambda h: (abs((h[1][0] + h[1][2]) / 2 - cx) > 15, y0 - h[1][3]),
        )
        assert n not in answers
        answers[n] = text
    return answers


def yamol_items(exam_id, tmp):
    html = fetch(f'https://yamol.tw/exam-x-{exam_id}.htm', tmp / f'y{exam_id}.html').read_text(errors='ignore')
    ids = {}
    for href in re.findall(r'href="(/item-[^"]+)"', html):
        m = re.match(r'/item-\s*(\d+).*-(\d+)\.htm$', urllib.parse.unquote_plus(href), re.S)
        if m and int(m.group(2)) not in ids.values():
            # 題號後可能緊接數字（如「31甲1」），依出現順序編號並檢查前綴
            n = len(ids) + 1
            assert m.group(1).startswith(str(n)), (exam_id, n, href)
            ids[n] = int(m.group(2))
    return ids


def main():
    tmp = Path(tempfile.mkdtemp())
    base = 'https://wwwq.moex.gov.tw/exam/wHandExamQandA_File.ashx'
    papers = []
    for code, pid, title, scope, yamol_exam in PAPERS:
        q_pdf = fetch(f'{base}?t=Q&code={MOEX_CODE}&c={MOEX_CLASS}&s={code}&q=1', tmp / f'Q{code}.pdf')
        s_pdf = fetch(f'{base}?t=S&code={MOEX_CODE}&c={MOEX_CLASS}&s={code}&q=1', tmp / f'S{code}.pdf')
        questions = parse_questions(q_pdf)
        answers = parse_answers(s_pdf)
        links = yamol_items(yamol_exam, tmp)
        assert sorted(answers) == list(range(1, len(questions) + 1)), pid
        assert sorted(links) == list(range(1, len(questions) + 1)), pid
        for q in questions:
            q['answer'] = answers[q['n']]
            q['yamol'] = links[q['n']]
        papers.append({
            'id': pid,
            'title': title,
            'scope': scope,
            'source': f'{base}?t=Q&code={MOEX_CODE}&c={MOEX_CLASS}&s={code}&q=1',
            'questions': questions,
        })
        print(pid, len(questions), file=sys.stderr)
    data = {
        'year': YEAR,
        'title': f'{YEAR}年專門職業及技術人員高等考試律師考試（第一試）',
        'date': EXAM_DATE,
        'papers': papers,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(OUT, file=sys.stderr)


if __name__ == '__main__':
    main()
