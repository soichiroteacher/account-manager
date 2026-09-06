(function () {
  "use strict";

  const STORAGE_KEY = "accountManagerApp.students.v1";
  const LAYOUT_KEY = "accountManagerApp.sheetLayout.v1";

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
        if (a.className !== b.className) return a.className.localeCompare(b.className, "ja");
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
      renderTable();
    } catch (err) {
      alert("読み込みに失敗しました: " + err.message);
    } finally {
      fileImportJson.value = "";
    }
  });

  // ---------- Excel bulk export / import ----------

  function buildExcelAoa() {
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

    const headers = ["氏名", "クラス", "出席番号", "GoogleID", "Google初期パスワード", ...dynamicCols.map((c) => c.header)];
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "生徒一覧");
    XLSX.writeFile(wb, `account-manager-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

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

  fileImportExcel.addEventListener("change", async () => {
    const file = fileImportExcel.files[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
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
        const row = aoa[r] || [];
        if (row.every((c) => String(c ?? "").trim() === "")) continue;

        const student = {
          id: generateId(), name: "", className: "", number: "",
          googleId: "", googlePassword: "", otherServices: [],
        };
        headers.forEach((h, idx) => {
          if (FIXED_HEADER_MAP[h]) student[FIXED_HEADER_MAP[h]] = String(row[idx] ?? "").trim();
        });

        const serviceMap = new Map();
        for (const col of dynamicColumns) {
          const value = String(row[col.idx] ?? "").trim();
          if (!value) continue;
          if (!serviceMap.has(col.serviceName)) serviceMap.set(col.serviceName, []);
          serviceMap.get(col.serviceName).push({ label: col.fieldLabel, value });
        }
        student.otherServices = Array.from(serviceMap.entries()).map(([name, fields]) => ({ name, fields }));

        if (!student.name) continue;
        importedStudents.push(student);
      }

      if (importedStudents.length === 0) {
        alert("インポートできる行が見つかりませんでした。");
        return;
      }

      if (!confirm(`${importedStudents.length}件のデータを読み込みます。現在のデータは置き換えられます。よろしいですか？`)) return;
      students = importedStudents;
      saveStudents();
      renderTable();
      alert(`${importedStudents.length}件を読み込みました。`);
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

  document.getElementById("btnSheetLayout").addEventListener("click", () => {
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
              .map((f) => `<tr><th>${escapeHtml(svc.name)} ${escapeHtml(f.label)}</th><td>${escapeHtml(f.value)}</td></tr>`)
              .join(""))
            .join("");
          blocks.push(`<p class="sheet-section-title">その他の学習サービス</p><table>${rows}</table>`);
        }
      } else if (FIXED_FIELD_LABELS[item.key]) {
        pendingRows.push(`<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(student[item.key] || "-")}</td></tr>`);
      }
    }
    flushPendingRows();

    return `
      <div class="account-sheet">
        <h2>アカウントシート</h2>
        <p class="sheet-subtitle">${escapeHtml(student.className)} ${escapeHtml(student.number)}番 ${escapeHtml(student.name)} さん</p>
        ${blocks.join("")}
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

  async function downloadStudentSheetPdf(student) {
    const { jsPDF } = window.jspdf;
    const canvas = await renderSheetToCanvas(student);
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    addCanvasAsPage(pdf, canvas, true);
    pdf.save(`アカウントシート_${student.className}_${student.number}_${student.name}.pdf`);
  }

  function addCanvasAsPage(pdf, canvas, isFirstPage) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 80;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    if (!isFirstPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 40, 40, imgWidth, Math.min(imgHeight, pageHeight - 80));
  }

  document.getElementById("btnPrintAllSheets").addEventListener("click", async () => {
    const list = sortedFiltered();
    if (list.length === 0) {
      alert("出力対象の生徒がいません。");
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    for (let i = 0; i < list.length; i++) {
      const canvas = await renderSheetToCanvas(list[i]);
      addCanvasAsPage(pdf, canvas, i === 0);
    }
    pdf.save(`アカウントシート_一括_${new Date().toISOString().slice(0, 10)}.pdf`);
  });

  // ---------- Init ----------

  loadStudents();
  loadLayout();
  renderTable();
})();
