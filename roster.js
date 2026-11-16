// 生徒名簿(印刷・Excel)。「Excel・CSV ▼」→「生徒名簿(印刷・Excel)」で開く。
// 学校でよく使う名簿の形を、アプリの名簿から作る(パスワードなどのアカウントの情報は入れない)。
//   class … クラス名簿(1クラス1枚・A4縦)。出席番号・氏名(・ふりがな・性別)と、見出しを手書きできるチェック欄
//   two   … 2クラス横並び(A4横)。2クラスずつ並べたチェック欄つきの名簿
//   all   … 全クラス一覧(A4横)。全クラスの氏名を1枚に並べる(多いときは何枚かに分ける)
//   list  … 一覧表(A4縦)。学籍番号・Google ID・端末番号なども選んで載せる表
//
// 作り方: まず形ごとに「表の設計図」(grid)を作り、それを
//   ・印刷用の HTML(printDocument で印刷)
//   ・罫線つきの Excel(.xlsx)
// の2通りに書き出す。どちらも同じ設計図から作るので、印刷と Excel の見た目がそろう。
// 同梱の SheetJS(無料版)は罫線を書けないため、Excel は xlsx の中身(XML)をここで組み立て、
// SheetJS に入っている zip の道具(XLSX.CFB)で1つのファイルにまとめている。
(function () {
  "use strict";

  const A = window.AccountManager;
  const esc = A.escapeHtml;
  const $ = (id) => document.getElementById(id);

  // ===== 学校ごとに変えてよい設定 =====
  const ALL_CLASSES_PER_PAGE = 6;   // 全クラス一覧で、1枚に並べるクラスの数
  const PREFS_KEY = "accountManagerApp.studentRoster";  // 選んだ形と項目を、このパソコンに覚えておく

  // ---------- 画面 ----------

  const FORMS = ["class", "two", "all", "list"];
  const CHECKS = ["srKana", "srGender", "srStudentNo", "srGoogleId", "srDevice", "srByClass", "srNumberHeads"];
  const INPUTS = ["srTitle", "srBlanks", "srCheckCount", "srExtraRows", "srOrder"];

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* 覚えられなくても動く */ }
  }

  function currentForm() {
    const r = document.querySelector('input[name="srForm"]:checked');
    return r ? r.value : "class";
  }

  /** 形に合わない項目を隠す(data-forms="class two" のように、その形のときだけ出す) */
  function refreshFormFields() {
    const form = currentForm();
    for (const el of document.querySelectorAll("#studentRosterModal [data-forms]")) {
      el.hidden = !el.dataset.forms.split(" ").includes(form);
    }
  }

  $("btnStudentRoster").addEventListener("click", () => {
    const list = A.filteredStudents();
    if (list.length === 0) {
      alert("名簿に載せる生徒がいません。一覧の表示の切り替えや検索の条件を確かめてください。");
      return;
    }
    const p = loadPrefs();
    const classes = [...new Set(list.map((s) => s.className))];
    $("srTarget").textContent = `対象: ${list.length}人(${classes.length}クラス)`;
    const form = FORMS.includes(p.form) ? p.form : "class";
    document.querySelector(`input[name="srForm"][value="${form}"]`).checked = true;
    for (const id of CHECKS) if (typeof p[id] === "boolean") $(id).checked = p[id];
    for (const id of INPUTS) if (typeof p[id] === "string") $(id).value = p[id];
    refreshFormFields();
    $("studentRosterModal").hidden = false;
  });
  for (const r of document.querySelectorAll('input[name="srForm"]')) r.addEventListener("change", refreshFormFields);
  $("btnCancelStudentRoster").addEventListener("click", () => { $("studentRosterModal").hidden = true; });

  /** 画面の選択を読む(読んだものは覚えておく) */
  function readOptions() {
    const p = { form: currentForm() };
    for (const id of CHECKS) p[id] = $(id).checked;
    for (const id of INPUTS) p[id] = $(id).value;
    savePrefs(p);
    const num = (v, def, max) => { const n = parseInt(String(v).normalize("NFKC"), 10); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };
    return {
      form: p.form,
      title: p.srTitle.trim(),
      kana: p.srKana, gender: p.srGender, studentNo: p.srStudentNo, googleId: p.srGoogleId, device: p.srDevice,
      byClass: p.srByClass, numberHeads: p.srNumberHeads,
      byGender: p.srOrder === "gender",
      blanks: p.srBlanks.split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
      checkCount: num(p.srCheckCount, 15, 40),
      extraRows: num(p.srExtraRows, 2, 20),
    };
  }

  // ---------- 名簿のもと ----------

  /** 男女別のときは 男 → 女 → 未入力 の順(それぞれ出席番号の順)。一覧はもともとクラス・出席番号の順 */
  function genderRank(s) { return s.gender === "男" ? 0 : s.gender === "女" ? 1 : 2; }

  function classGroups(opt) {
    const list = A.filteredStudents();
    const names = [...new Set(list.map((s) => s.className))];
    return names.map((name) => {
      let students = list.filter((s) => s.className === name);
      if (opt.byGender) students = students.map((s, i) => ({ s, i })).sort((a, b) => genderRank(a.s) - genderRank(b.s) || a.i - b.i).map((x) => x.s);
      return { name, students, teacher: homeroomOf(name) };
    });
  }

  function homeroomOf(className) {
    const S = window.AccountManagerStaff;
    return S && S.homeroomOf ? S.homeroomOf(className) : "";
  }

  function schoolLine(count) {
    return `${A.sheetOptions().headerText || ""}　${A.todayString()} 現在${count !== undefined ? `　${count}人` : ""}`.trim();
  }

  // ---------- 表の設計図(grid) ----------
  // grid = { name: シート名, orientation, cols: [列の幅(文字数)], rows: [{ h: 高さ(pt), cells: [cell...] }] }
  // cell = { v: 文字, s: 見た目, cs: 横に何列つなぐか, rs: 縦に何行つなぐか }。つないだ先の場所は空(undefined)にする。
  // 見た目(s): title / titleC / sub / subR / head / cellC / cellL / blank。名前の後ろの T は、上の線を太くする(男女の境目)。

  function makeRows(n, width) {
    return Array.from({ length: n }, () => ({ h: 20, cells: new Array(width).fill(undefined) }));
  }
  function put(row, col, v, s, cs, rs) {
    row.cells[col] = { v: v == null ? "" : String(v), s, cs: cs || 1, rs: rs || 1 };
  }

  /** 1クラス分のブロック(列の並び)。start 列目から書く。戻り値は使った列の数 */
  function classBlockColumns(opt, { kana, gender, checks }) {
    return [
      { h: "番号", w: 5, s: "cellC", get: (s) => s.number },
      { h: "氏名", w: 15, s: "cellL", get: (s) => s.name },
      ...(kana ? [{ h: "ふりがな", w: 17, s: "cellL", get: (s) => s.kana || "" }] : []),
      ...(gender ? [{ h: "性別", w: 4.5, s: "cellC", get: (s) => s.gender || "" }] : []),
      ...Array.from({ length: checks }, (_, i) => ({ h: opt.numberHeads ? String(i + 1) : "", w: 4.2, s: "blank", get: () => "" })),
    ];
  }

  /** ブロックを rows の start 列目から書く(見出しの行・生徒の行・空の行) */
  function writeBlock(rows, start, cols, group, opt, { titleRow, headRow, firstRow, rowCount }) {
    const width = cols.length;
    // 1行目: クラス名と担任
    const nameSpan = Math.min(2, width);
    put(rows[titleRow], start, group.name, "title", nameSpan);
    if (width > nameSpan) put(rows[titleRow], start + nameSpan, group.teacher ? `担任　${group.teacher}` : "担任", "subR", width - nameSpan);
    cols.forEach((c, i) => put(rows[headRow], start + i, c.h, "head"));
    let prevGender = null;
    for (let r = 0; r < rowCount; r++) {
      const s = group.students[r];
      // 男女別のとき、女子の最初の行の上の線を太くする
      const thick = opt.byGender && s && r > 0 && prevGender !== null && genderRank(s) !== prevGender;
      cols.forEach((c, i) => put(rows[firstRow + r], start + i, s ? c.get(s) : "", c.s + (thick ? "T" : "")));
      if (s) prevGender = genderRank(s);
    }
  }

  /** クラス名簿(1クラス1枚・A4縦) */
  function gridsClass(opt) {
    return classGroups(opt).map((g) => {
      const cols = classBlockColumns(opt, { kana: opt.kana, gender: opt.gender, checks: opt.checkCount });
      const rowCount = g.students.length + opt.extraRows;
      const rows = makeRows(3 + rowCount, cols.length);
      rows[0].h = 26; rows[1].h = 14; rows[2].h = 64;   // 見出しの行は高くして、上に手書きできるようにする
      writeBlock(rows, 0, cols, g, opt, { titleRow: 0, headRow: 2, firstRow: 3, rowCount });
      // 題名は、クラス名と担任の間に入れる
      if (opt.title && cols.length >= 8) {
        rows[0].cells[2] = undefined;
        put(rows[0], 2, opt.title, "titleC", cols.length - 7);
        put(rows[0], cols.length - 5, g.teacher ? `担任　${g.teacher}` : "担任", "subR", 5);
      }
      put(rows[1], 0, schoolLine(g.students.length), "sub", cols.length);
      return { name: g.name, orientation: "portrait", cols: cols.map((c) => c.w), rows };
    });
  }

  /** 2クラス横並び(A4横) */
  function gridsTwo(opt) {
    const groups = classGroups(opt);
    const grids = [];
    for (let i = 0; i < groups.length; i += 2) {
      const pair = groups.slice(i, i + 2);
      const cols = classBlockColumns(opt, { kana: false, gender: opt.gender, checks: opt.checkCount });
      const width = cols.length * 2 + 1;
      const rowCount = Math.max(...pair.map((g) => g.students.length)) + opt.extraRows;
      const rows = makeRows(3 + rowCount, width);
      rows[0].h = 26; rows[1].h = 14; rows[2].h = 56;
      pair.forEach((g, k) => writeBlock(rows, k * (cols.length + 1), cols, g, opt, { titleRow: 0, headRow: 2, firstRow: 3, rowCount }));
      put(rows[1], 0, [opt.title, schoolLine()].filter(Boolean).join("　"), "sub", width);
      grids.push({ name: pair.map((g) => g.name).join("・"), orientation: "landscape", cols: [...cols.map((c) => c.w), 2, ...cols.map((c) => c.w)], rows });
    }
    return grids;
  }

  /** 全クラス一覧(A4横)。1枚に ALL_CLASSES_PER_PAGE クラスずつ */
  function gridsAll(opt) {
    const groups = classGroups(opt);
    const grids = [];
    for (let i = 0; i < groups.length; i += ALL_CLASSES_PER_PAGE) {
      const part = groups.slice(i, i + ALL_CLASSES_PER_PAGE);
      const cols = [
        { h: "番号", w: 4, s: "cellC", get: (s) => s.number },
        { h: "氏名", w: 13, s: "cellL", get: (s) => s.name },
        ...(opt.kana ? [{ h: "ふりがな", w: 14, s: "cellL", get: (s) => s.kana || "" }] : []),
        ...(opt.gender ? [{ h: "性別", w: 4, s: "cellC", get: (s) => s.gender || "" }] : []),
      ];
      const block = cols.length + 1;
      const width = block * part.length - 1;
      const rowCount = Math.max(...part.map((g) => g.students.length));
      const rows = makeRows(3 + rowCount, width);
      rows[0].h = 22; rows[1].h = 14; rows[2].h = 18;
      rows.slice(3).forEach((r) => { r.h = 16; });
      part.forEach((g, k) => writeBlock(rows, k * block, cols, g, opt, { titleRow: 0, headRow: 2, firstRow: 3, rowCount }));
      put(rows[1], 0, [opt.title, schoolLine()].filter(Boolean).join("　"), "sub", width);
      const colWidths = [];
      part.forEach((_, k) => { colWidths.push(...cols.map((c) => c.w)); if (k < part.length - 1) colWidths.push(1.5); });
      grids.push({ name: groups.length > ALL_CLASSES_PER_PAGE ? `全クラス(${i / ALL_CLASSES_PER_PAGE + 1})` : "全クラス", orientation: "landscape", cols: colWidths, rows });
    }
    return grids;
  }

  /** 一覧表(A4縦)。項目を選んで載せる表 */
  function gridsList(opt) {
    const groups = classGroups(opt);
    const parts = opt.byClass ? groups : [{ name: "", students: groups.flatMap((g) => g.students), teacher: "" }];
    return parts.map((g) => {
      const cols = [
        ...(opt.byClass ? [] : [{ h: "クラス", w: 9, s: "cellC", get: (s) => s.className }]),
        { h: "番号", w: 5, s: "cellC", get: (s) => s.number },
        { h: "氏名", w: 15, s: "cellL", get: (s) => s.name },
        ...(opt.kana ? [{ h: "ふりがな", w: 18, s: "cellL", get: (s) => s.kana || "" }] : []),
        ...(opt.gender ? [{ h: "性別", w: 4.5, s: "cellC", get: (s) => s.gender || "" }] : []),
        ...(opt.studentNo ? [{ h: "学籍番号", w: 11, s: "cellC", get: (s) => s.studentNo || "" }] : []),
        ...(opt.googleId ? [{ h: "Google ID", w: 28, s: "cellL", get: (s) => s.googleId || "" }] : []),
        ...(opt.device ? [{ h: "端末番号", w: 11, s: "cellC", get: (s) => s.deviceNo || "" }] : []),
        ...opt.blanks.map((b) => ({ h: b, w: 9, s: "blank", get: () => "" })),
      ];
      const rowCount = g.students.length;
      const rows = makeRows(3 + rowCount, cols.length);
      rows[0].h = 26; rows[1].h = 14; rows[2].h = 20;
      const title = (opt.title || "生徒名簿") + (g.name ? `　${g.name}` : "");
      put(rows[0], 0, title, "title", cols.length);
      put(rows[1], 0, schoolLine(rowCount) + (g.teacher ? `　担任　${g.teacher}` : ""), "sub", cols.length);
      cols.forEach((c, i) => put(rows[2], i, c.h, "head"));
      let prev = null;
      g.students.forEach((s, r) => {
        const thick = opt.byGender && r > 0 && prev !== null && genderRank(s) !== prev && opt.byClass;
        cols.forEach((c, i) => put(rows[3 + r], i, c.get(s), c.s + (thick ? "T" : "")));
        prev = genderRank(s);
      });
      return { name: g.name || "名簿", orientation: "portrait", cols: cols.map((c) => c.w), rows };
    });
  }

  function buildGrids(opt) {
    return { class: gridsClass, two: gridsTwo, all: gridsAll, list: gridsList }[opt.form](opt);
  }

  const FORM_LABELS = { class: "クラス名簿", two: "クラス名簿_2クラス", all: "全クラス一覧", list: "生徒名簿" };

  function fileTitle(opt) {
    return (opt.form === "list" && opt.title) ? opt.title : (opt.title ? `${FORM_LABELS[opt.form]}_${opt.title}` : FORM_LABELS[opt.form]);
  }

  // ---------- 印刷(HTML) ----------

  // 紙の中で使える大きさ(mm)。printDocument の余白 10mm を引いたもの
  const PAGE_MM = { portrait: { w: 190, h: 277 }, landscape: { w: 277, h: 190 } };
  const PT_TO_MM = 0.3528;

  function gridToHtml(grid) {
    const page = PAGE_MM[grid.orientation];
    const totalW = grid.cols.reduce((a, b) => a + b, 0);
    const totalH = grid.rows.reduce((a, r) => a + r.h * PT_TO_MM, 0);
    // 行が多くて入りきらないときは、行の高さを縮める(文字の大きさもいっしょに)
    const fit = Math.min(1, (page.h - 2) / totalH);
    const font = Math.max(7, Math.min(11, 11 * fit));
    let html = `<table class="rp-table" style="font-size:${font.toFixed(1)}pt"><colgroup>`
      + grid.cols.map((w) => `<col style="width:${(w / totalW * 100).toFixed(3)}%">`).join("") + "</colgroup>";
    grid.rows.forEach((row) => {
      html += `<tr style="height:${(row.h * PT_TO_MM * fit).toFixed(2)}mm">`;
      row.cells.forEach((c) => {
        if (!c) return;
        const span = (c.cs > 1 ? ` colspan="${c.cs}"` : "") + (c.rs > 1 ? ` rowspan="${c.rs}"` : "");
        html += `<td class="rp-${c.s}"${span}>${esc(c.v)}</td>`;
      });
      html += "</tr>";
    });
    return `<section class="rp-page">${html}</table></section>`;
  }

  $("btnStudentRosterPrint").addEventListener("click", () => {
    const opt = readOptions();
    const grids = buildGrids(opt);
    $("studentRosterModal").hidden = true;
    const pageSize = grids[0].orientation === "landscape" ? "A4 landscape" : "A4 portrait";
    A.printDocument(grids.map(gridToHtml).join(""), `${fileTitle(opt)}_${A.todayString()}`, pageSize);
  });

  // ---------- 罫線つきの Excel(.xlsx) ----------

  // 見た目(s)ごとの書式の番号(styles.xml の cellXfs の順番)
  const XF = { title: 1, titleC: 2, sub: 3, subR: 4, head: 5, cellC: 6, cellL: 7, blank: 8, cellCT: 9, cellLT: 10, blankT: 11 };

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="14"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><sz val="9"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
<font><b/><sz val="10"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="medium"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="49" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" shrinkToFit="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" shrinkToFit="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      // XML に入れられない制御文字を消す(改行とタブは残す)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  function colName(i) {
    let s = "";
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function sheetXml(grid) {
    const width = grid.cols.length;
    // つないだセル(結合)の範囲の中も、罫線が出るように同じ見た目で書く
    const styleAt = grid.rows.map(() => new Array(width).fill(0));
    const merges = [];
    grid.rows.forEach((row, r) => row.cells.forEach((c, col) => {
      if (!c) return;
      for (let dr = 0; dr < c.rs; dr++) for (let dc = 0; dc < c.cs; dc++) {
        if (styleAt[r + dr] && col + dc < width) styleAt[r + dr][col + dc] = XF[c.s] || 0;
      }
      if (c.cs > 1 || c.rs > 1) merges.push(`${colName(col)}${r + 1}:${colName(col + c.cs - 1)}${r + c.rs}`);
    }));
    const rowsXml = grid.rows.map((row, r) => {
      const cells = [];
      for (let col = 0; col < width; col++) {
        const c = row.cells[col];
        const ref = `${colName(col)}${r + 1}`;
        const s = styleAt[r][col];
        if (c && c.v !== "") cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`);
        else if (s) cells.push(`<c r="${ref}" s="${s}"/>`);
      }
      return `<row r="${r + 1}" ht="${row.h}" customHeight="1">${cells.join("")}</row>`;
    }).join("");
    const colsXml = grid.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w + 0.7}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(width - 1)}${grid.rows.length}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${colsXml}</cols>
<sheetData>${rowsXml}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="${grid.orientation}" fitToWidth="1" fitToHeight="1"/>
</worksheet>`;
  }

  /** シート名は 31 文字まで・使えない記号がある・同じ名前は使えない */
  function sheetNames(grids) {
    const used = new Set();
    return grids.map((g) => {
      const base = (g.name || "名簿").replace(/[\\/?*:[\]]/g, "_").slice(0, 27) || "名簿";
      let name = base;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}(${i})`;
      used.add(name.toLowerCase());
      return name;
    });
  }

  /** 設計図から .xlsx のファイルの中身(Uint8Array)を作る */
  function buildXlsx(grids) {
    const names = sheetNames(grids);
    const enc = new TextEncoder();
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${grids.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${grids.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${grids.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      "xl/styles.xml": STYLES_XML,
    };
    grids.forEach((g, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(g); });
    const zip = XLSX.CFB.utils.cfb_new();
    const now = new Date();
    for (const [path, text] of Object.entries(files)) {
      const entry = XLSX.CFB.utils.cfb_add(zip, "/" + path, enc.encode(text));
      if (entry) entry.mt = now;   // zip の中のファイルの日時(入れないと 1980年0月 という正しくない日付になる)
    }
    return XLSX.CFB.write(zip, { type: "array", fileType: "zip", compression: true });
  }

  $("btnStudentRosterExcel").addEventListener("click", () => {
    const opt = readOptions();
    const grids = buildGrids(opt);
    const data = buildXlsx(grids);
    $("studentRosterModal").hidden = true;
    A.downloadBlob(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${fileTitle(opt).replace(/[\\/:*?"<>|]/g, "_")}_${A.todayString()}.xlsx`);
  });

  // 動作確認用(見本で中身を確かめるときに使う)
  window.StudentRoster = { buildGrids, buildXlsx, readOptions };
})();
