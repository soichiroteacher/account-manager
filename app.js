(function () {
  "use strict";

  const STORAGE_KEY = "accountManagerApp.students.v1";
  const LAYOUT_KEY = "accountManagerApp.sheetLayout.v1";
  const META_KEY = "accountManagerApp.meta.v1";
  const SHEET_OPTIONS_KEY = "accountManagerApp.sheetOptions.v1";

  const DEFAULT_LAYOUT = [
    { key: "name", label: "氏名", visible: true },
    { key: "className", label: "クラス", visible: true },
    { key: "number", label: "出席番号", visible: true },
    { key: "googleId", label: "Google ID", visible: true },
    { key: "googlePassword", label: "Google 初期パスワード", visible: true },
    { key: "otherServices", label: "その他の学習サービス", visible: true },
  ];

  const FIXED_FIELD_LABELS = {
    name: "氏名",
    className: "クラス",
    number: "出席番号",
    googleId: "Google ID",
    googlePassword: "Google 初期パスワード",
  };

  const SAMPLE_STUDENT = {
    name: "山田 太郎",
    className: "1年2組",
    number: "5",
    googleId: "example@school.jp",
    googlePassword: "Init@1234",
    otherServices: [
      { name: "タイピング練習", fields: [{ label: "ID", value: "taro5" }, { label: "パスワード", value: "pw5" }] },
    ],
  };

  /** @type {Array<Object>} */
  let students = [];
  /** @type {Array<{key:string,label:string,visible:boolean}>} */
  let sheetLayout = [];

  function migrateOtherServices(list) {
    return (list || []).map((svc) => {
      if (Array.isArray(svc.fields)) return svc;
      const fields = [];
      if (svc.id !== undefined) fields.push({ label: "ID", value: svc.id || "" });
      if (svc.password !== undefined) fields.push({ label: "パスワード", value: svc.password || "" });
      return { name: svc.name || "", fields };
    });
  }

  function loadStudents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      students = raw ? JSON.parse(raw) : [];
      students.forEach((s) => { s.otherServices = migrateOtherServices(s.otherServices); });
    } catch (e) {
      console.error("読み込みに失敗しました", e);
      students = [];
    }
  }

  function saveStudents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
    meta.lastModifiedAt = Date.now();
    saveMeta();
    renderBackupStatus();
  }

  // ---------- Backup status ----------

  /** @type {{lastModifiedAt?: number, lastBackupAt?: number}} */
  let meta = {};
  const backupStatus = document.getElementById("backupStatus");

  function loadMeta() {
    try {
      meta = JSON.parse(localStorage.getItem(META_KEY)) || {};
    } catch (e) {
      meta = {};
    }
  }

  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function markBackedUp() {
    meta.lastBackupAt = Date.now();
    saveMeta();
    renderBackupStatus();
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  function renderBackupStatus() {
    if (students.length === 0) {
      backupStatus.hidden = true;
      return;
    }
    backupStatus.hidden = false;
    if (!meta.lastBackupAt) {
      backupStatus.className = "backup-status warn";
      backupStatus.textContent = "まだバックアップが書き出されていません。データはこのブラウザ内にしか保存されていないため、ブラウザのデータ削除などで消えることがあります。「バックアップ書き出し」または「Excel書き出し」で保存してください。";
    } else if ((meta.lastModifiedAt || 0) > meta.lastBackupAt) {
      backupStatus.className = "backup-status warn";
      backupStatus.textContent = `最終バックアップ(${formatDateTime(meta.lastBackupAt)})以降に変更があります。書き出して保存してください。`;
    } else {
      backupStatus.className = "backup-status";
      backupStatus.textContent = `最終バックアップ: ${formatDateTime(meta.lastBackupAt)}`;
    }
  }

  function loadLayout() {
    let stored = [];
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      stored = raw ? JSON.parse(raw) : [];
    } catch (e) {
      stored = [];
    }
    sheetLayout = DEFAULT_LAYOUT
      .map((def) => stored.find((i) => i.key === def.key) || { ...def })
      .map((item, idx) => ({ ...item, _order: idx }));

    if (stored.length) {
      const orderedKeys = stored.map((i) => i.key).filter((k) => sheetLayout.some((i) => i.key === k));
      sheetLayout.sort((a, b) => {
        const ai = orderedKeys.indexOf(a.key);
        const bi = orderedKeys.indexOf(b.key);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    }
    sheetLayout = sheetLayout.map(({ _order, ...rest }) => rest);
  }

  function saveLayout() {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(sheetLayout));
  }

  const DEFAULT_NOTICE = [
    "【個人情報の取り扱いについて】",
    "・この用紙には、あなた専用のアカウント情報(IDとパスワード)が書かれています。",
    "・他の人に見せたり、貸したり、写真に撮って送ったりしないでください。",
    "・パスワードは、友だちも含めて、だれにも教えないでください。",
    "・なくさないように大切に保管し、なくしたときはすぐに先生に知らせてください。",
  ].join("\n");

  const DEFAULT_SHEET_OPTIONS = { title: "アカウントシート", headerText: "", message: "", notice: DEFAULT_NOTICE };
  let sheetOptions = { ...DEFAULT_SHEET_OPTIONS };

  function loadSheetOptions() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(SHEET_OPTIONS_KEY)) || {};
    } catch (e) {
      stored = {};
    }
    // Earlier versions kept the free text in "footerText".
    if (stored.footerText && !stored.message) stored.message = stored.footerText;
    sheetOptions = { ...DEFAULT_SHEET_OPTIONS };
    for (const key of Object.keys(DEFAULT_SHEET_OPTIONS)) {
      if (typeof stored[key] === "string") sheetOptions[key] = stored[key];
    }
  }

  function saveSheetOptions() {
    localStorage.setItem(SHEET_OPTIONS_KEY, JSON.stringify(sheetOptions));
  }

  function generateId() {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  // ---------- Table rendering ----------

  const tableBody = document.getElementById("studentTableBody");
  const emptyMessage = document.getElementById("emptyMessage");
  const searchBox = document.getElementById("searchBox");

  function matchesSearch(student, query) {
    if (!query) return true;
    const haystack = [student.name, student.className, student.number].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function sortedFiltered() {
    const query = searchBox.value.trim();
    return students
      .filter((s) => matchesSearch(s, query))
      .slice()
      .sort((a, b) => {
        if (a.className !== b.className) return a.className.localeCompare(b.className, "ja", { numeric: true });
        return (Number(a.number) || 0) - (Number(b.number) || 0);
      });
  }

  function renderTable() {
    const list = sortedFiltered();
    tableBody.innerHTML = "";
    emptyMessage.hidden = list.length > 0;
    emptyMessage.textContent = students.length === 0
      ? "登録された生徒がいません。「生徒を追加」から登録してください。"
      : "検索条件に一致する生徒がいません。";

    for (const student of list) {
      const tr = document.createElement("tr");

      const otherServicesHtml = (student.otherServices || [])
        .map((svc) => `<span class="other-service-tag">${escapeHtml(svc.name)}</span>`)
        .join("");

      tr.innerHTML = `
        <td>${escapeHtml(student.className)}</td>
        <td>${escapeHtml(student.number)}</td>
        <td>${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.googleId || "")}</td>
        <td>${otherServicesHtml}</td>
        <td class="row-actions">
          <button class="btn btn-small" data-action="edit" data-id="${student.id}">編集</button>
          <button class="btn btn-small" data-action="sheet" data-id="${student.id}">シート出力</button>
          <button class="btn btn-small btn-danger" data-action="delete" data-id="${student.id}">削除</button>
        </td>
      `;
      tableBody.appendChild(tr);
    }
  }

  tableBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const student = students.find((s) => s.id === id);
    if (!student) return;

    if (btn.dataset.action === "edit") {
      openModal(student);
    } else if (btn.dataset.action === "delete") {
      if (confirm(`${student.name} さんのデータを削除しますか？`)) {
        students = students.filter((s) => s.id !== id);
        saveStudents();
        renderTable();
      }
    } else if (btn.dataset.action === "sheet") {
      downloadStudentSheetPdf(student);
    }
  });

  searchBox.addEventListener("input", renderTable);

  // ---------- Modal / form ----------

  const modal = document.getElementById("studentModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("studentForm");
  const fieldId = document.getElementById("studentId");
  const fieldName = document.getElementById("fieldName");
  const fieldClass = document.getElementById("fieldClass");
  const fieldNumber = document.getElementById("fieldNumber");
  const fieldGoogleId = document.getElementById("fieldGoogleId");
  const fieldGooglePassword = document.getElementById("fieldGooglePassword");
  const otherServicesList = document.getElementById("otherServicesList");

  function openModal(student) {
    form.reset();
    otherServicesList.innerHTML = "";

    if (student) {
      modalTitle.textContent = "生徒を編集";
      fieldId.value = student.id;
      fieldName.value = student.name;
      fieldClass.value = student.className;
      fieldNumber.value = student.number;
      fieldGoogleId.value = student.googleId || "";
      fieldGooglePassword.value = student.googlePassword || "";
      for (const svc of student.otherServices || []) {
        addOtherServiceBlock(svc);
      }
    } else {
      modalTitle.textContent = "生徒を追加";
      fieldId.value = "";
    }

    modal.hidden = false;
    fieldName.focus();
  }

  function closeModal() {
    modal.hidden = true;
  }

  function addFieldRow(container, data) {
    const row = document.createElement("div");
    row.className = "other-service-field-row";
    row.innerHTML = `
      <input type="text" class="field-label" placeholder="項目名(例: ID)" value="${escapeHtml(data?.label || "")}">
      <input type="text" class="field-value" placeholder="値" value="${escapeHtml(data?.value || "")}">
      <button type="button" aria-label="この項目を削除">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function addOtherServiceBlock(data) {
    const block = document.createElement("div");
    block.className = "other-service-block";
    block.innerHTML = `
      <div class="other-service-header">
        <input type="text" class="svc-name" placeholder="サービス名(例: タイピング練習)" value="${escapeHtml(data?.name || "")}">
        <button type="button" aria-label="このサービスを削除">✕ サービス削除</button>
      </div>
      <div class="other-service-fields"></div>
      <button type="button" class="btn btn-small btn-add-field">+ 項目を追加</button>
    `;
    const fieldsContainer = block.querySelector(".other-service-fields");
    const initialFields = (data && data.fields && data.fields.length)
      ? data.fields
      : [{ label: "ID", value: "" }, { label: "パスワード", value: "" }];
    for (const f of initialFields) addFieldRow(fieldsContainer, f);

    block.querySelector(".other-service-header button").addEventListener("click", () => block.remove());
    block.querySelector(".btn-add-field").addEventListener("click", () => addFieldRow(fieldsContainer, null));

    otherServicesList.appendChild(block);
  }

  document.getElementById("btnAddStudent").addEventListener("click", () => openModal(null));
  document.getElementById("btnCancelModal").addEventListener("click", closeModal);
  document.getElementById("btnAddOtherService").addEventListener("click", () => addOtherServiceBlock(null));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const otherServices = Array.from(otherServicesList.querySelectorAll(".other-service-block"))
      .map((block) => {
        const name = block.querySelector(".svc-name").value.trim();
        const fields = Array.from(block.querySelectorAll(".other-service-field-row"))
          .map((row) => ({
            label: row.querySelector(".field-label").value.trim(),
            value: row.querySelector(".field-value").value.trim(),
          }))
          .filter((f) => f.label || f.value);
        return { name, fields };
      })
      .filter((svc) => svc.name || svc.fields.length);

    const studentData = {
      id: fieldId.value || generateId(),
      name: fieldName.value.trim(),
      className: fieldClass.value.trim(),
      number: fieldNumber.value.trim(),
      googleId: fieldGoogleId.value.trim(),
      googlePassword: fieldGooglePassword.value.trim(),
      otherServices,
    };

    const existingIndex = students.findIndex((s) => s.id === studentData.id);
    if (existingIndex >= 0) {
      students[existingIndex] = studentData;
    } else {
      students.push(studentData);
    }

    saveStudents();
    renderTable();
    closeModal();
  });

  // ---------- JSON backup export / import ----------

  document.getElementById("btnExportJson").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(students, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `account-manager-backup-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markBackedUp();
  });

  const fileImportJson = document.getElementById("fileImportJson");
  document.getElementById("btnImportJson").addEventListener("click", () => fileImportJson.click());

  fileImportJson.addEventListener("change", async () => {
    const file = fileImportJson.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("形式が不正です");
      if (!confirm(`${parsed.length}件のデータを読み込みます。現在のデータは置き換えられます。よろしいですか？`)) return;
      students = parsed;
      students.forEach((s) => { s.otherServices = migrateOtherServices(s.otherServices); });
      saveStudents();
      markBackedUp();
      renderTable();
    } catch (err) {
      alert("読み込みに失敗しました: " + err.message);
    } finally {
      fileImportJson.value = "";
    }
  });

  // ---------- Excel bulk export / import ----------

  const FIXED_HEADERS = ["氏名", "クラス", "出席番号", "GoogleID", "Google初期パスワード"];

  function collectServiceColumns() {
    const dynamicCols = [];
    const colSeen = new Set();
    for (const s of students) {
      for (const svc of s.otherServices || []) {
        for (const f of svc.fields || []) {
          if (!svc.name || !f.label) continue;
          const key = svc.name + "||" + f.label;
          if (!colSeen.has(key)) {
            colSeen.add(key);
            dynamicCols.push({ svcName: svc.name, fieldLabel: f.label, header: `${svc.name} - ${f.label}` });
          }
        }
      }
    }
    return dynamicCols;
  }

  // Text format ("@") keeps leading zeros when teachers type IDs like 0123 into Excel.
  function applyTextFormat(ws, lastRow, colCount) {
    for (let r = 1; r <= lastRow; r++) {
      for (let c = 0; c < colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] || (ws[addr] = { t: "s", v: "" });
        cell.t = "s";
        cell.v = String(cell.v ?? "");
        cell.z = "@";
      }
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: colCount - 1 } });
    ws["!cols"] = Array.from({ length: colCount }, () => ({ wch: 20 }));
  }

  function buildExcelAoa() {
    const dynamicCols = collectServiceColumns();
    const headers = [...FIXED_HEADERS, ...dynamicCols.map((c) => c.header)];
    const rows = students.map((s) => {
      const row = [s.name, s.className, s.number, s.googleId || "", s.googlePassword || ""];
      for (const col of dynamicCols) {
        const svc = (s.otherServices || []).find((x) => x.name === col.svcName);
        const field = svc ? (svc.fields || []).find((f) => f.label === col.fieldLabel) : null;
        row.push(field ? field.value : "");
      }
      return row;
    });

    return [headers, ...rows];
  }

  document.getElementById("btnExportExcel").addEventListener("click", () => {
    if (students.length === 0) {
      alert("書き出す生徒データがありません。");
      return;
    }
    const aoa = buildExcelAoa();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    applyTextFormat(ws, aoa.length - 1, aoa[0].length);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "生徒一覧");
    XLSX.writeFile(wb, `account-manager-${new Date().toISOString().slice(0, 10)}.xlsx`);
    markBackedUp();
  });

  document.getElementById("btnExcelTemplate").addEventListener("click", () => {
    const dynamicCols = collectServiceColumns();
    const serviceHeaders = dynamicCols.length
      ? dynamicCols.map((c) => c.header)
      : ["タイピング練習 - ID", "タイピング練習 - パスワード"];
    const headers = [...FIXED_HEADERS, ...serviceHeaders];

    const ws = XLSX.utils.aoa_to_sheet([headers]);
    applyTextFormat(ws, 200, headers.length);

    const help = XLSX.utils.aoa_to_sheet([
      ["アカウント管理アプリ 取り込み用テンプレートの使い方"],
      [""],
      ["・1行目の見出しは変更しないでください。1行に生徒1人分を入力します。"],
      ["・氏名・クラス・出席番号は必須です(追加・更新モードでは「クラス＋出席番号」で既存の生徒と照合します)。"],
      ["・その他のサービスは「サービス名 - 項目名」の形式の見出しで列を追加できます。例: 英会話 - ID、英会話 - URL"],
      ["・セルは文字列形式になっているため、0から始まるIDもそのまま入力できます。"],
      ["・入力後、アプリの「Excel読み込み」から取り込んでください。"],
    ]);
    help["!cols"] = [{ wch: 100 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "生徒一覧");
    XLSX.utils.book_append_sheet(wb, help, "使い方");
    XLSX.writeFile(wb, "account-manager-template.xlsx");
  });

  function cellText(cell) {
    if (!cell) return "";
    // Custom number formats (e.g. "0000") show the intended text; "General" would turn long IDs into 1.23E+11.
    if (cell.t === "n" && cell.z && cell.z !== "General" && cell.w) return cell.w.trim();
    return String(cell.v ?? "").trim();
  }

  function readSheetAsText(ws) {
    if (!ws || !ws["!ref"]) return [];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const aoa = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row.push(cellText(ws[XLSX.utils.encode_cell({ r, c })]));
      }
      aoa.push(row);
    }
    return aoa;
  }

  const FIXED_HEADER_MAP = {
    "氏名": "name",
    "クラス": "className",
    "出席番号": "number",
    "GoogleID": "googleId",
    "Google ID": "googleId",
    "Google初期パスワード": "googlePassword",
    "Google 初期パスワード": "googlePassword",
  };

  const fileImportExcel = document.getElementById("fileImportExcel");
  document.getElementById("btnImportExcel").addEventListener("click", () => fileImportExcel.click());

  const importModal = document.getElementById("importModal");
  const importSummary = document.getElementById("importSummary");
  let pendingImport = [];

  function studentKey(s) {
    return `${s.className}\u0000${s.number}`;
  }

  function mergeStudent(target, incoming) {
    for (const key of ["name", "className", "number", "googleId", "googlePassword"]) {
      if (incoming[key]) target[key] = incoming[key];
    }
    target.otherServices = target.otherServices || [];
    for (const svc of incoming.otherServices) {
      const existing = target.otherServices.find((x) => x.name === svc.name);
      if (!existing) {
        target.otherServices.push(svc);
        continue;
      }
      for (const f of svc.fields) {
        const field = existing.fields.find((x) => x.label === f.label);
        if (field) field.value = f.value;
        else existing.fields.push(f);
      }
    }
  }

  function applyImport(mode) {
    let added = 0;
    let updated = 0;
    let skipped = 0;

    if (mode === "replace") {
      const valid = pendingImport.filter((s) => s.name);
      skipped = pendingImport.length - valid.length;
      students = valid;
      added = valid.length;
    } else {
      const byKey = new Map(students.map((s) => [studentKey(s), s]));
      for (const incoming of pendingImport) {
        const existing = incoming.className && incoming.number ? byKey.get(studentKey(incoming)) : null;
        if (existing) {
          mergeStudent(existing, incoming);
          updated++;
        } else if (incoming.name) {
          students.push(incoming);
          byKey.set(studentKey(incoming), incoming);
          added++;
        } else {
          skipped++;
        }
      }
    }

    saveStudents();
    renderTable();
    const parts = [`追加 ${added}件`];
    if (mode === "merge") parts.push(`更新 ${updated}件`);
    if (skipped) parts.push(`スキップ ${skipped}件(氏名なし)`);
    alert(`読み込みました: ${parts.join(" / ")}`);
  }

  document.getElementById("btnCancelImport").addEventListener("click", () => {
    importModal.hidden = true;
    pendingImport = [];
  });

  document.getElementById("btnConfirmImport").addEventListener("click", () => {
    const mode = importModal.querySelector('input[name="importMode"]:checked').value;
    if (mode === "replace" && students.length > 0
        && !confirm(`現在の${students.length}件のデータはすべて削除されます。よろしいですか？`)) {
      return;
    }
    importModal.hidden = true;
    applyImport(mode);
    pendingImport = [];
  });

  fileImportExcel.addEventListener("change", async () => {
    const file = fileImportExcel.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellNF: true });
      const aoa = readSheetAsText(wb.Sheets[wb.SheetNames[0]]);
      if (aoa.length < 2) throw new Error("データ行が見つかりません");

      const headers = aoa[0].map((h) => String(h ?? "").trim());
      const dynamicColumns = headers
        .map((h, idx) => ({ h, idx }))
        .filter(({ h }) => h && !FIXED_HEADER_MAP[h])
        .map(({ h, idx }) => {
          const sepIdx = h.indexOf(" - ");
          if (sepIdx === -1) return null;
          return { idx, serviceName: h.slice(0, sepIdx).trim(), fieldLabel: h.slice(sepIdx + 3).trim() };
        })
        .filter(Boolean);

      const importedStudents = [];
      for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (row.every((c) => c === "")) continue;

        const student = {
          id: generateId(), name: "", className: "", number: "",
          googleId: "", googlePassword: "", otherServices: [],
        };
        headers.forEach((h, idx) => {
          if (FIXED_HEADER_MAP[h]) student[FIXED_HEADER_MAP[h]] = row[idx];
        });

        const serviceMap = new Map();
        for (const col of dynamicColumns) {
          const value = row[col.idx];
          if (!value) continue;
          if (!serviceMap.has(col.serviceName)) serviceMap.set(col.serviceName, []);
          serviceMap.get(col.serviceName).push({ label: col.fieldLabel, value });
        }
        student.otherServices = Array.from(serviceMap.entries()).map(([name, fields]) => ({ name, fields }));

        if (!student.name && !(student.className && student.number)) continue;
        importedStudents.push(student);
      }

      if (importedStudents.length === 0) {
        alert("インポートできる行が見つかりませんでした。");
        return;
      }

      pendingImport = importedStudents;
      importSummary.textContent = `「${file.name}」から${importedStudents.length}件のデータが見つかりました。読み込み方法を選んでください。`;
      importModal.querySelector('input[value="merge"]').checked = true;
      importModal.hidden = false;
    } catch (err) {
      alert("読み込みに失敗しました: " + err.message);
    } finally {
      fileImportExcel.value = "";
    }
  });

  // ---------- Sheet layout editor ----------

  const sheetLayoutModal = document.getElementById("sheetLayoutModal");
  const layoutItemList = document.getElementById("layoutItemList");
  const layoutPreview = document.getElementById("layoutPreview");

  function renderLayoutEditor() {
    layoutItemList.innerHTML = "";
    sheetLayout.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "layout-item-row";
      li.innerHTML = `
        <label>
          <input type="checkbox" class="layout-visible" ${item.visible ? "checked" : ""}>
          ${escapeHtml(item.label)}
        </label>
        <div class="move-buttons">
          <button type="button" data-dir="up" ${idx === 0 ? "disabled" : ""} aria-label="上へ">▲</button>
          <button type="button" data-dir="down" ${idx === sheetLayout.length - 1 ? "disabled" : ""} aria-label="下へ">▼</button>
        </div>
      `;
      li.querySelector(".layout-visible").addEventListener("change", (e) => {
        item.visible = e.target.checked;
        saveLayout();
        renderLayoutPreview();
      });
      li.querySelectorAll(".move-buttons button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const dir = btn.dataset.dir;
          const newIdx = dir === "up" ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= sheetLayout.length) return;
          const tmp = sheetLayout[idx];
          sheetLayout[idx] = sheetLayout[newIdx];
          sheetLayout[newIdx] = tmp;
          saveLayout();
          renderLayoutEditor();
          renderLayoutPreview();
        });
      });
      layoutItemList.appendChild(li);
    });
  }

  function renderLayoutPreview() {
    const sample = students[0] || SAMPLE_STUDENT;
    layoutPreview.innerHTML = buildSheetHtml(sample);
  }

  const optTitle = document.getElementById("optTitle");
  const optHeaderText = document.getElementById("optHeaderText");
  const optMessage = document.getElementById("optMessage");
  const optNotice = document.getElementById("optNotice");

  function syncSheetOptionsFromForm() {
    sheetOptions.title = optTitle.value;
    sheetOptions.headerText = optHeaderText.value;
    sheetOptions.message = optMessage.value;
    sheetOptions.notice = optNotice.value;
    saveSheetOptions();
    renderLayoutPreview();
  }

  for (const el of [optTitle, optHeaderText, optMessage, optNotice]) {
    el.addEventListener("input", syncSheetOptionsFromForm);
  }

  document.getElementById("btnResetNotice").addEventListener("click", () => {
    optNotice.value = DEFAULT_NOTICE;
    syncSheetOptionsFromForm();
  });

  document.getElementById("btnSheetLayout").addEventListener("click", () => {
    optTitle.value = sheetOptions.title;
    optHeaderText.value = sheetOptions.headerText;
    optMessage.value = sheetOptions.message;
    optNotice.value = sheetOptions.notice;
    renderLayoutEditor();
    renderLayoutPreview();
    sheetLayoutModal.hidden = false;
  });
  document.getElementById("btnCloseSheetLayout").addEventListener("click", () => { sheetLayoutModal.hidden = true; });
  sheetLayoutModal.addEventListener("click", (e) => {
    if (e.target === sheetLayoutModal) sheetLayoutModal.hidden = true;
  });

  // ---------- Account sheet (PDF) ----------

  const sheetPreviewArea = document.getElementById("sheetPreviewArea");

  const CODE_FIELDS = new Set(["googleId", "googlePassword"]);

  function buildSheetHtml(student) {
    const blocks = [];
    let pendingRows = [];

    function flushPendingRows() {
      if (pendingRows.length) {
        blocks.push(`<table>${pendingRows.join("")}</table>`);
        pendingRows = [];
      }
    }

    for (const item of sheetLayout) {
      if (!item.visible) continue;

      if (item.key === "otherServices") {
        flushPendingRows();
        const services = student.otherServices || [];
        if (services.length > 0) {
          const rows = services
            .map((svc) => (svc.fields || [])
              .map((f) => `<tr><th>${escapeHtml(svc.name)} ${escapeHtml(f.label)}</th><td class="code">${escapeHtml(f.value)}</td></tr>`)
              .join(""))
            .join("");
          blocks.push(`<p class="sheet-section-title">その他の学習サービス</p><table>${rows}</table>`);
        }
      } else if (FIXED_FIELD_LABELS[item.key]) {
        const cls = CODE_FIELDS.has(item.key) ? ' class="code"' : "";
        pendingRows.push(`<tr><th>${escapeHtml(item.label)}</th><td${cls}>${escapeHtml(student[item.key] || "-")}</td></tr>`);
      }
    }
    flushPendingRows();

    const headerText = sheetOptions.headerText.trim();
    const message = sheetOptions.message.trim();
    const notice = sheetOptions.notice.trim();

    return `
      <div class="account-sheet">
        ${headerText ? `<p class="sheet-header-text">${escapeHtml(headerText)}</p>` : ""}
        <h2 class="sheet-title">${escapeHtml(sheetOptions.title.trim() || "アカウントシート")}</h2>
        <p class="sheet-subtitle">${escapeHtml(student.className)} ${escapeHtml(student.number)}番 ${escapeHtml(student.name)} さん</p>
        ${message ? `<p class="sheet-message">${escapeHtml(message)}</p>` : ""}
        ${blocks.join("")}
        ${notice ? `<div class="sheet-notice">${escapeHtml(notice)}</div>` : ""}
      </div>
    `;
  }

  async function renderSheetToCanvas(student) {
    sheetPreviewArea.innerHTML = buildSheetHtml(student);
    const node = sheetPreviewArea.querySelector(".account-sheet");
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    sheetPreviewArea.innerHTML = "";
    return canvas;
  }

  const B5_JIS_PT = [515.91, 728.5];

  async function exportSheetsPdf(list, filename) {
    const { jsPDF } = window.jspdf;
    const [pageW, pageH] = B5_JIS_PT;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: B5_JIS_PT });

    for (let i = 0; i < list.length; i++) {
      if (i > 0) pdf.addPage(B5_JIS_PT, "portrait");
      const canvas = await renderSheetToCanvas(list[i]);
      // The sheet is drawn at B5 proportions; a sheet that overflows is shrunk uniformly to fit one page.
      const scale = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * scale;
      const h = canvas.height * scale;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (pageW - w) / 2, 0, w, h);
    }
    pdf.save(filename);
  }

  function downloadStudentSheetPdf(student) {
    return exportSheetsPdf([student], `アカウントシート_${student.className}_${student.number}_${student.name}.pdf`);
  }

  document.getElementById("btnPrintAllSheets").addEventListener("click", () => {
    const list = sortedFiltered();
    if (list.length === 0) {
      alert("出力対象の生徒がいません。");
      return;
    }
    exportSheetsPdf(list, `アカウントシート_一括_${new Date().toISOString().slice(0, 10)}.pdf`);
  });

  // ---------- Init ----------

  loadStudents();
  loadLayout();
  loadSheetOptions();
  loadMeta();
  renderTable();
  renderBackupStatus();
})();
