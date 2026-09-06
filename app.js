(function () {
  "use strict";

  const STORAGE_KEY = "accountManagerApp.students.v1";

  /** @type {Array<Student>} */
  let students = [];

  function loadStudents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      students = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("読み込みに失敗しました", e);
      students = [];
    }
  }

  function saveStudents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
  }

  function generateId() {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
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
        addOtherServiceRow(svc);
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

  function addOtherServiceRow(data) {
    const row = document.createElement("div");
    row.className = "other-service-row";
    row.innerHTML = `
      <input type="text" placeholder="サービス名" class="svc-name" value="${escapeHtml(data?.name || "")}">
      <input type="text" placeholder="ID" class="svc-id" value="${escapeHtml(data?.id || "")}">
      <input type="text" placeholder="パスワード" class="svc-password" value="${escapeHtml(data?.password || "")}">
      <button type="button" title="削除" aria-label="このサービスを削除">✕</button>
    `;
    row.querySelector("button").addEventListener("click", () => row.remove());
    otherServicesList.appendChild(row);
  }

  document.getElementById("btnAddStudent").addEventListener("click", () => openModal(null));
  document.getElementById("btnCancelModal").addEventListener("click", closeModal);
  document.getElementById("btnAddOtherService").addEventListener("click", () => addOtherServiceRow(null));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const otherServices = Array.from(otherServicesList.querySelectorAll(".other-service-row"))
      .map((row) => ({
        name: row.querySelector(".svc-name").value.trim(),
        id: row.querySelector(".svc-id").value.trim(),
        password: row.querySelector(".svc-password").value.trim(),
      }))
      .filter((svc) => svc.name || svc.id || svc.password);

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
      saveStudents();
      renderTable();
    } catch (err) {
      alert("読み込みに失敗しました: " + err.message);
    } finally {
      fileImportJson.value = "";
    }
  });

  // ---------- Account sheet (PDF) ----------

  const sheetPreviewArea = document.getElementById("sheetPreviewArea");

  function buildSheetHtml(student) {
    const otherRows = (student.otherServices || [])
      .map((svc) => `
        <tr><th>${escapeHtml(svc.name)} ID</th><td>${escapeHtml(svc.id)}</td></tr>
        <tr><th>${escapeHtml(svc.name)} パスワード</th><td>${escapeHtml(svc.password)}</td></tr>
      `)
      .join("");

    return `
      <div class="account-sheet">
        <h2>アカウントシート</h2>
        <p class="sheet-subtitle">${escapeHtml(student.className)} ${escapeHtml(student.number)}番 ${escapeHtml(student.name)} さん</p>

        <p class="sheet-section-title">基本情報</p>
        <table>
          <tr><th>氏名</th><td>${escapeHtml(student.name)}</td></tr>
          <tr><th>クラス</th><td>${escapeHtml(student.className)}</td></tr>
          <tr><th>出席番号</th><td>${escapeHtml(student.number)}</td></tr>
        </table>

        <p class="sheet-section-title">Googleアカウント</p>
        <table>
          <tr><th>Google ID</th><td>${escapeHtml(student.googleId || "-")}</td></tr>
          <tr><th>初期パスワード</th><td>${escapeHtml(student.googlePassword || "-")}</td></tr>
        </table>

        ${otherRows ? `<p class="sheet-section-title">その他の学習サービス</p><table>${otherRows}</table>` : ""}
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
  renderTable();
})();
