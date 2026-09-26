(function () {
  "use strict";

  // Keys used by earlier versions that kept everything in this browser's localStorage.
  const LEGACY_KEYS = {
    students: "accountManagerApp.students.v1",
    layout: "accountManagerApp.sheetLayout.v1",
    meta: "accountManagerApp.meta.v1",
    sheetOptions: "accountManagerApp.sheetOptions.v1",
    passwordRules: "accountManagerApp.passwordRules.v1",
    googleCsv: "accountManagerApp.googleCsv.v1",
    security: "accountManagerApp.security.v1",
  };
  const EDITOR_NAME_KEY = "accountManagerApp.editorName";

  const DEFAULT_LAYOUT = [
    { key: "name", label: "氏名", visible: true },
    { key: "className", label: "クラス", visible: true },
    { key: "number", label: "出席番号", visible: true },
    { key: "googleId", label: "Google ID", visible: true },
    { key: "googlePassword", label: "Google 初期パスワード", visible: true },
    { key: "otherServices", label: "その他の学習サービス", visible: true },
    { key: "deviceNo", label: "端末番号", visible: false },
  ];

  const FIXED_FIELD_LABELS = {
    name: "氏名",
    className: "クラス",
    number: "出席番号",
    googleId: "Google ID",
    googlePassword: "Google 初期パスワード",
    deviceNo: "端末番号",
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

  /** Only true while this PC holds the edit lock on the data file; every change is saved only then. */
  let editMode = false;

  function saveStudents() {
    if (editMode) scheduleSave();
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function loadLayout(stored) {
    stored = Array.isArray(stored) ? stored : [];
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
    saveStudents();
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

  function loadSheetOptions(stored) {
    stored = stored && typeof stored === "object" ? { ...stored } : {};
    // Earlier versions kept the free text in "footerText".
    if (stored.footerText && !stored.message) stored.message = stored.footerText;
    sheetOptions = { ...DEFAULT_SHEET_OPTIONS };
    for (const key of Object.keys(DEFAULT_SHEET_OPTIONS)) {
      if (typeof stored[key] === "string") sheetOptions[key] = stored[key];
    }
  }

  function saveSheetOptions() {
    saveStudents();
  }

  function generateId() {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // Private Use Area code points: school- or system-specific gaiji that only render on PCs with that font installed.
  const PUA_RE = /[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
  const PUA_RE_GLOBAL = new RegExp(PUA_RE.source, "gu");

  const GAIJI_CHECK_FIELDS = {
    name: "氏名",
    className: "クラス",
    number: "出席番号",
    googleId: "Google ID",
    googlePassword: "Google 初期パスワード",
  };

  function hasGaiji(text) {
    return PUA_RE.test(text || "");
  }

  function markGaiji(text) {
    return String(text || "").replace(PUA_RE_GLOBAL, "〓");
  }

  function gaijiFields(student) {
    const found = Object.entries(GAIJI_CHECK_FIELDS)
      .filter(([key]) => hasGaiji(student[key]))
      .map(([, label]) => label);
    const inServices = (student.otherServices || []).some((svc) =>
      hasGaiji(svc.name) || (svc.fields || []).some((f) => hasGaiji(f.label) || hasGaiji(f.value)));
    if (inServices) found.push("その他サービス");
    return found;
  }

  function describeGaijiStudent(student) {
    return `${markGaiji(student.className)} ${markGaiji(student.number)}番 ${markGaiji(student.name)}(${gaijiFields(student).join("・")})`;
  }

  const STATUSES = ["在籍", "転出", "卒業"];

  function statusOf(student) {
    return STATUSES.includes(student.status) ? student.status : "在籍";
  }

  function isEnrolled(student) {
    return statusOf(student) === "在籍";
  }

  const DEVICE_STATUSES = ["使用中", "修理中", "修理中(代替機貸出)", "未配布", "返却済"];

  function isDeviceInRepair(student) {
    return (student.deviceStatus || "").startsWith("修理中");
  }

  function deviceLabel(student) {
    const status = student.deviceStatus || "";
    if (!status || status === "使用中") return "";
    return status === "修理中(代替機貸出)" && student.loanerNo ? `修理中(代替機 ${student.loanerNo})` : status;
  }

  function formatDate(isoDate) {
    return isoDate ? isoDate.replace(/-/g, "/") : "";
  }

  const PASSWORD_LABEL_RE = /パスワード|password|pass|pw|暗証/i;

  function isPasswordLabel(label) {
    return PASSWORD_LABEL_RE.test(label || "");
  }

  const SECRET_MASK = "••••••••";
  const TEXT_SECURITY_SUPPORTED = window.CSS && CSS.supports("-webkit-text-security", "disc");

  // Prefer CSS masking: type="password" makes browsers offer to save every student's password.
  function setMasked(input, masked) {
    if (TEXT_SECURITY_SUPPORTED) input.classList.toggle("masked", masked);
    else input.type = masked ? "password" : "text";
  }

  function maskSecrets(student) {
    return {
      ...student,
      googlePassword: student.googlePassword ? SECRET_MASK : "",
      otherServices: (student.otherServices || []).map((svc) => ({
        ...svc,
        fields: (svc.fields || []).map((f) => (isPasswordLabel(f.label) && f.value ? { ...f, value: SECRET_MASK } : f)),
      })),
    };
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
    const haystack = [student.name, student.className, student.number, student.studentNo, student.googleId,
      student.deviceNo, student.deviceSerial, student.loanerNo]
      .join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  let showGaijiOnly = false;
  const statusFilter = document.getElementById("statusFilter");

  function matchesStatusFilter(student) {
    switch (statusFilter.value) {
      case "all": return true;
      case "left": return !isEnrolled(student);
      case "device-repair": return isEnrolled(student) && isDeviceInRepair(student);
      case "device-unassigned": return isEnrolled(student) && (!student.deviceNo || student.deviceStatus === "未配布");
      case "device-unreturned": return !isEnrolled(student) && Boolean(student.deviceNo) && student.deviceStatus !== "返却済";
      default: return isEnrolled(student);
    }
  }

  function sortedFiltered() {
    const query = searchBox.value.trim();
    return students
      .filter(matchesStatusFilter)
      .filter((s) => matchesSearch(s, query))
      .filter((s) => !showGaijiOnly || gaijiFields(s).length > 0)
      .slice()
      .sort((a, b) => {
        if (a.className !== b.className) return a.className.localeCompare(b.className, "ja", { numeric: true });
        return (Number(a.number) || 0) - (Number(b.number) || 0);
      });
  }

  const gaijiStatus = document.getElementById("gaijiStatus");
  const gaijiStatusText = document.getElementById("gaijiStatusText");
  const btnToggleGaijiOnly = document.getElementById("btnToggleGaijiOnly");

  function renderGaijiStatus() {
    const count = students.filter((s) => gaijiFields(s).length > 0).length;
    if (count === 0) showGaijiOnly = false;
    gaijiStatus.hidden = count === 0;
    gaijiStatusText.textContent = `独自の外字を含む生徒が${count}人います。独自の外字は、外字を登録していないPCや印刷では「□」になることがあります。「外字あり」の生徒を確認し、できるだけ通常の漢字(例: 髙・﨑・𠮷)に置き換えてください。`;
    btnToggleGaijiOnly.textContent = showGaijiOnly ? "すべての生徒を表示" : "外字ありの生徒だけ表示";
  }

  btnToggleGaijiOnly.addEventListener("click", () => {
    showGaijiOnly = !showGaijiOnly;
    renderTable();
  });

  function renderTable() {
    renderGaijiStatus();
    const list = sortedFiltered();
    tableBody.innerHTML = "";
    emptyMessage.hidden = list.length > 0;
    emptyMessage.textContent = students.length === 0
      ? "登録された生徒がいません。「生徒を追加」から登録してください。"
      : "条件に一致する生徒がいません。";
    document.getElementById("listCount").textContent = students.length ? `${list.length}人を表示中` : "";

    for (const student of list) {
      const tr = document.createElement("tr");
      const gaiji = gaijiFields(student);
      const gaijiBadge = gaiji.length
        ? ` <span class="gaiji-badge" title="独自の外字を含む項目: ${escapeHtml(gaiji.join("・"))}">外字あり</span>`
        : "";
      const statusBadge = isEnrolled(student)
        ? ""
        : ` <span class="status-badge">${escapeHtml(statusOf(student))}${student.statusDate ? " " + escapeHtml(formatDate(student.statusDate)) : ""}</span>`;

      const otherServicesHtml = (student.otherServices || [])
        .map((svc) => `<span class="other-service-tag">${escapeHtml(svc.name)}</span>`)
        .join("");

      tr.innerHTML = `
        <td>${escapeHtml(student.className)}</td>
        <td>${escapeHtml(student.number)}</td>
        <td>${escapeHtml(student.studentNo || "")}</td>
        <td>${escapeHtml(student.name)}${statusBadge}${gaijiBadge}</td>
        <td>${escapeHtml(student.googleId || "")}</td>
        <td>${escapeHtml(student.deviceNo || "")}${deviceLabel(student) ? ` <span class="status-badge">${escapeHtml(deviceLabel(student))}</span>` : ""}</td>
        <td class="services-cell">${otherServicesHtml}</td>
        <td class="row-actions">
          <button class="btn btn-small" data-action="edit" data-id="${student.id}">${editMode ? "編集" : "詳細"}</button>
          <button class="btn btn-small" data-action="sheet" data-id="${student.id}">シート出力</button>
          <button class="btn btn-small edit-only" data-action="reissue" data-id="${student.id}">再発行</button>
          <button class="btn btn-small btn-danger edit-only" data-action="delete" data-id="${student.id}">削除</button>
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
    } else if (!editMode && (btn.dataset.action === "delete" || btn.dataset.action === "reissue")) {
      return;
    } else if (btn.dataset.action === "delete") {
      const message = `${student.name} さんのデータを削除しますか？\n\n`
        + "削除すると記録が残りません。転出・卒業の場合は、削除せずに編集画面の「在籍状況」を変更してください。";
      if (confirm(message)) {
        students = students.filter((s) => s.id !== id);
        saveStudents();
        renderTable();
      }
    } else if (btn.dataset.action === "sheet") {
      downloadStudentSheetPdf(student);
    } else if (btn.dataset.action === "reissue") {
      openReissueModal(student);
    }
  });

  searchBox.addEventListener("input", renderTable);
  statusFilter.addEventListener("change", renderTable);

  // ---------- Modal / form ----------

  const modal = document.getElementById("studentModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("studentForm");
  const fieldId = document.getElementById("studentId");
  const fieldStudentNo = document.getElementById("fieldStudentNo");
  const fieldName = document.getElementById("fieldName");
  const fieldClass = document.getElementById("fieldClass");
  const fieldNumber = document.getElementById("fieldNumber");
  const fieldGoogleId = document.getElementById("fieldGoogleId");
  const fieldGooglePassword = document.getElementById("fieldGooglePassword");
  const otherServicesList = document.getElementById("otherServicesList");
  const fieldStatus = document.getElementById("fieldStatus");
  const fieldStatusDate = document.getElementById("fieldStatusDate");
  const fieldStatusNote = document.getElementById("fieldStatusNote");

  function refreshStatusFields() {
    const enrolled = fieldStatus.value === "在籍";
    document.getElementById("statusDetailRows").hidden = enrolled;
    if (!enrolled && !fieldStatusDate.value) fieldStatusDate.value = todayString();
  }

  fieldStatus.addEventListener("change", refreshStatusFields);

  const fieldDeviceNo = document.getElementById("fieldDeviceNo");
  const fieldDeviceSerial = document.getElementById("fieldDeviceSerial");
  const fieldDeviceStatus = document.getElementById("fieldDeviceStatus");
  const fieldLoanerNo = document.getElementById("fieldLoanerNo");
  const fieldDeviceNote = document.getElementById("fieldDeviceNote");

  function refreshDeviceFields() {
    document.getElementById("loanerRow").hidden = fieldDeviceStatus.value !== "修理中(代替機貸出)";
  }

  fieldDeviceStatus.addEventListener("change", refreshDeviceFields);

  function openModal(student) {
    form.reset();
    otherServicesList.innerHTML = "";

    if (student) {
      modalTitle.textContent = editMode ? "生徒を編集" : "生徒の詳細";
      fieldId.value = student.id;
      fieldStudentNo.value = student.studentNo || "";
      fieldName.value = student.name;
      fieldClass.value = student.className;
      fieldNumber.value = student.number;
      fieldGoogleId.value = student.googleId || "";
      fieldGooglePassword.value = student.googlePassword || "";
      fieldStatus.value = statusOf(student);
      fieldStatusDate.value = student.statusDate || "";
      fieldStatusNote.value = student.statusNote || "";
      fieldDeviceNo.value = student.deviceNo || "";
      fieldDeviceSerial.value = student.deviceSerial || "";
      fieldDeviceStatus.value = DEVICE_STATUSES.includes(student.deviceStatus) ? student.deviceStatus : "";
      fieldLoanerNo.value = student.loanerNo || "";
      fieldDeviceNote.value = student.deviceNote || "";
      for (const svc of student.otherServices || []) {
        addOtherServiceBlock(svc);
      }
    } else {
      modalTitle.textContent = "生徒を追加";
      fieldId.value = "";
      fieldStatus.value = "在籍";
    }
    refreshStatusFields();
    refreshDeviceFields();
    renderReissueHistory(student);

    updateNameGaijiWarning();
    googlePasswordRevealed = false;
    refreshGooglePasswordMask();
    setFormReadOnly(!editMode);
    modal.hidden = false;
    if (editMode) fieldName.focus();
  }

  /** View mode shows the same dialog, but nothing can be changed (password reveal buttons still work). */
  function setFormReadOnly(readOnly) {
    for (const el of form.querySelectorAll("input, textarea")) {
      if (el.type !== "hidden") el.readOnly = readOnly;
    }
    for (const el of form.querySelectorAll("select")) el.disabled = readOnly;
    document.getElementById("btnCancelModal").textContent = readOnly ? "閉じる" : "キャンセル";
  }

  const btnToggleGooglePassword = document.getElementById("btnToggleGooglePassword");
  let googlePasswordRevealed = false;

  function refreshGooglePasswordMask() {
    setMasked(fieldGooglePassword, !googlePasswordRevealed);
    btnToggleGooglePassword.textContent = googlePasswordRevealed ? "隠す" : "表示";
  }

  btnToggleGooglePassword.addEventListener("click", () => {
    googlePasswordRevealed = !googlePasswordRevealed;
    refreshGooglePasswordMask();
  });

  const nameGaijiWarning = document.getElementById("nameGaijiWarning");

  function updateNameGaijiWarning() {
    nameGaijiWarning.hidden = !hasGaiji(fieldName.value);
  }

  fieldName.addEventListener("input", updateNameGaijiWarning);

  function closeModal() {
    modal.hidden = true;
  }

  function addFieldRow(container, data) {
    const row = document.createElement("div");
    row.className = "other-service-field-row";
    row.innerHTML = `
      <input type="text" class="field-label" placeholder="項目名(例: ID)" value="${escapeHtml(data?.label || "")}">
      <input type="text" class="field-value" placeholder="値" autocomplete="off" value="${escapeHtml(data?.value || "")}">
      <button type="button" class="secret-btn toggle-btn">表示</button>
      <button type="button" class="secret-btn generate-btn edit-only">生成</button>
      <button type="button" class="remove-btn edit-only" aria-label="この項目を削除">✕</button>
    `;
    const labelInput = row.querySelector(".field-label");
    const valueInput = row.querySelector(".field-value");
    const toggle = row.querySelector(".toggle-btn");
    const generate = row.querySelector(".generate-btn");
    let revealed = false;
    const refresh = () => {
      const secret = isPasswordLabel(labelInput.value);
      toggle.hidden = !secret;
      generate.hidden = !secret;
      setMasked(valueInput, secret && !revealed);
      toggle.textContent = revealed ? "隠す" : "表示";
    };
    toggle.addEventListener("click", () => { revealed = !revealed; refresh(); });
    generate.addEventListener("click", () => {
      valueInput.value = generatePassword();
      revealed = true;
      refresh();
    });
    labelInput.addEventListener("input", refresh);
    refresh();
    row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function addOtherServiceBlock(data) {
    const block = document.createElement("div");
    block.className = "other-service-block";
    block.innerHTML = `
      <div class="other-service-header">
        <input type="text" class="svc-name" placeholder="サービス名(例: タイピング練習)" value="${escapeHtml(data?.name || "")}">
        <button type="button" class="edit-only" aria-label="このサービスを削除">✕ サービス削除</button>
      </div>
      <div class="other-service-fields"></div>
      <button type="button" class="btn btn-small btn-add-field edit-only">+ 項目を追加</button>
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
    if (!editMode) return;

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
      studentNo: fieldStudentNo.value.trim(),
      name: fieldName.value.trim(),
      className: fieldClass.value.trim(),
      number: fieldNumber.value.trim(),
      googleId: fieldGoogleId.value.trim(),
      googlePassword: fieldGooglePassword.value.trim(),
      status: fieldStatus.value,
      statusDate: fieldStatus.value === "在籍" ? "" : fieldStatusDate.value,
      statusNote: fieldStatus.value === "在籍" ? "" : fieldStatusNote.value.trim(),
      deviceNo: fieldDeviceNo.value.trim(),
      deviceSerial: fieldDeviceSerial.value.trim(),
      deviceStatus: fieldDeviceStatus.value,
      loanerNo: fieldDeviceStatus.value === "修理中(代替機貸出)" ? fieldLoanerNo.value.trim() : "",
      deviceNote: fieldDeviceNote.value.trim(),
      otherServices,
    };

    if (studentData.studentNo) {
      const dup = students.find((s) => s.id !== studentData.id && s.studentNo === studentData.studentNo);
      if (dup) {
        alert(`学籍番号「${studentData.studentNo}」は ${dup.className} ${dup.number}番 ${dup.name} さんに使われています。`);
        fieldStudentNo.focus();
        return;
      }
    }

    const seatDup = isEnrolled(studentData)
      && students.find((s) => s.id !== studentData.id && isEnrolled(s) && studentKey(s) === studentKey(studentData));
    if (seatDup && !confirm(`${studentData.className} ${studentData.number}番には、すでに ${seatDup.name} さんが登録されています。このまま保存しますか？`)) {
      return;
    }

    const deviceDup = studentData.deviceNo
      && students.find((s) => s.id !== studentData.id && isEnrolled(s) && s.deviceNo === studentData.deviceNo);
    if (deviceDup && !confirm(`端末番号「${studentData.deviceNo}」は ${deviceDup.className} ${deviceDup.name} さんに登録されています。このまま保存しますか？`)) {
      return;
    }

    const existing = students.find((s) => s.id === studentData.id);
    if (existing) {
      Object.assign(existing, studentData);
    } else {
      students.push(studentData);
    }

    saveStudents();
    renderTable();
    closeModal();
  });

  // ---------- Download helpers ----------

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function todayString() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- Excel bulk export / import ----------

  const EXCEL_FIELDS = [
    { key: "studentNo", header: "学籍番号" },
    { key: "name", header: "氏名" },
    { key: "className", header: "クラス" },
    { key: "number", header: "出席番号" },
    { key: "googleId", header: "GoogleID", aliases: ["Google ID"] },
    { key: "googlePassword", header: "Google初期パスワード", aliases: ["Google 初期パスワード"] },
    { key: "status", header: "在籍状況", get: statusOf, parse: (v) => (STATUSES.includes(v) ? v : "") },
    { key: "statusDate", header: "異動日", parse: normalizeDateText },
    { key: "statusNote", header: "異動メモ" },
    { key: "deviceNo", header: "端末番号" },
    { key: "deviceSerial", header: "シリアル番号" },
    { key: "deviceStatus", header: "端末状態", parse: (v) => (DEVICE_STATUSES.includes(v) ? v : "") },
    { key: "loanerNo", header: "代替機番号" },
    { key: "deviceNote", header: "端末メモ" },
  ];
  const FIXED_HEADERS = EXCEL_FIELDS.map((f) => f.header);

  /** Accepts 2026-03-31, 2026/3/31 or 2026年3月31日 and returns YYYY-MM-DD ("" if not a date). */
  function normalizeDateText(text) {
    const m = toHalfWidthDigits(text).match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (!m) return "";
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

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
      const row = EXCEL_FIELDS.map((f) => (f.get ? f.get(s) : s[f.key] || ""));
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
    XLSX.writeFile(wb, `account-manager-${todayString()}.xlsx`);
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
      ["・氏名・クラス・出席番号は必須です。氏名は姓と名の間にスペースを入れてください。"],
      ["・「追加・更新」で読み込むと、学籍番号が一致する生徒を更新します(学籍番号がない場合は「クラス＋出席番号」で照合)。"],
      ["・進級・クラス替えのときは、学籍番号を入れたまま新しいクラス・出席番号を入力して読み込むと、まとめて変更できます。"],
      ["・その他のサービスは「サービス名 - 項目名」の形式の見出しで列を追加できます。例: 英会話 - ID、英会話 - URL"],
      ["・在籍状況は「在籍」「転出」「卒業」のいずれかです(空欄は在籍として扱います)。異動日は 2026/3/31 のように入力します。"],
      ["・端末状態は「使用中」「修理中」「修理中(代替機貸出)」「未配布」「返却済」のいずれかです。"],
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

  const FIXED_HEADER_MAP = {};
  for (const f of EXCEL_FIELDS) {
    for (const h of [f.header, ...(f.aliases || [])]) FIXED_HEADER_MAP[h] = f.key;
  }

  const fileImportExcel = document.getElementById("fileImportExcel");
  document.getElementById("btnImportExcel").addEventListener("click", () => fileImportExcel.click());

  const importModal = document.getElementById("importModal");
  const importSummary = document.getElementById("importSummary");
  let pendingImport = [];

  function studentKey(s) {
    return `${s.className}\u0000${s.number}`;
  }

  function findSeatConflicts() {
    const bySeat = new Map();
    for (const s of students) {
      if (!isEnrolled(s) || !s.className || !s.number) continue;
      const key = studentKey(s);
      if (!bySeat.has(key)) bySeat.set(key, []);
      bySeat.get(key).push(s);
    }
    return Array.from(bySeat.values()).filter((group) => group.length > 1);
  }

  function findDeviceConflicts() {
    const byDevice = new Map();
    for (const s of students) {
      if (!isEnrolled(s) || !s.deviceNo) continue;
      if (!byDevice.has(s.deviceNo)) byDevice.set(s.deviceNo, []);
      byDevice.get(s.deviceNo).push(s);
    }
    return Array.from(byDevice.values()).filter((group) => group.length > 1);
  }

  function describeSeatConflicts(conflicts) {
    return conflicts
      .slice(0, 10)
      .map((g) => `・${g[0].className} ${g[0].number}番: ${g.map((s) => s.name).join("、")}`)
      .join("\n") + (conflicts.length > 10 ? `\n・ほか${conflicts.length - 10}件` : "");
  }

  function mergeStudent(target, incoming) {
    for (const { key } of EXCEL_FIELDS) {
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
      const byNo = new Map(students.filter((s) => s.studentNo).map((s) => [s.studentNo, s]));
      // Class+number refers to where students sat before this import, so a class change
      // earlier in the file cannot hide the student who originally held that seat.
      const byOriginalSeat = new Map(students.filter(isEnrolled).map((s) => [studentKey(s), s]));

      for (const incoming of pendingImport) {
        let existing = incoming.studentNo ? byNo.get(incoming.studentNo) : null;
        if (!existing && incoming.className && incoming.number) {
          const candidate = byOriginalSeat.get(studentKey(incoming));
          // Class+number is only a fallback: never let it override two different 学籍番号.
          if (candidate && (!candidate.studentNo || !incoming.studentNo)) existing = candidate;
        }

        if (existing) {
          mergeStudent(existing, incoming);
          if (existing.studentNo) byNo.set(existing.studentNo, existing);
          updated++;
        } else if (incoming.name) {
          students.push(incoming);
          if (incoming.studentNo) byNo.set(incoming.studentNo, incoming);
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
    const conflicts = findSeatConflicts();
    const conflictText = conflicts.length
      ? `\n\n同じクラス・出席番号の生徒が重複しています。確認してください。\n${describeSeatConflicts(conflicts)}`
      : "";
    const deviceConflicts = findDeviceConflicts();
    const deviceText = deviceConflicts.length
      ? `\n\n同じ端末番号が複数の在籍生徒に登録されています。\n${deviceConflicts.slice(0, 10).map((g) => `・${g[0].deviceNo}: ${g.map((s) => s.name).join("、")}`).join("\n")}`
      : "";
    alert(`読み込みました: ${parts.join(" / ")}${conflictText}${deviceText}`);
  }

  const importGaijiWarning = document.getElementById("importGaijiWarning");
  const IMPORT_GAIJI_LIST_LIMIT = 10;

  function renderImportGaijiWarning(list) {
    const withGaiji = list.filter((s) => gaijiFields(s).length > 0);
    importGaijiWarning.hidden = withGaiji.length === 0;
    importGaijiWarning.innerHTML = "";
    if (withGaiji.length === 0) return;

    const heading = document.createElement("p");
    heading.textContent = `${withGaiji.length}件に独自の外字が含まれています(外字は「〓」で表示)。読み込んだ後、通常の漢字に置き換えることをおすすめします。`;
    const ul = document.createElement("ul");
    for (const s of withGaiji.slice(0, IMPORT_GAIJI_LIST_LIMIT)) {
      const li = document.createElement("li");
      li.textContent = describeGaijiStudent(s);
      ul.appendChild(li);
    }
    importGaijiWarning.append(heading, ul);
    if (withGaiji.length > IMPORT_GAIJI_LIST_LIMIT) {
      const more = document.createElement("p");
      more.textContent = `ほか${withGaiji.length - IMPORT_GAIJI_LIST_LIMIT}件`;
      importGaijiWarning.appendChild(more);
    }
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

        const student = { id: generateId(), otherServices: [] };
        for (const { key } of EXCEL_FIELDS) student[key] = "";
        headers.forEach((h, idx) => {
          const key = FIXED_HEADER_MAP[h];
          if (!key) return;
          const field = EXCEL_FIELDS.find((f) => f.key === key);
          student[key] = field.parse ? field.parse(row[idx]) : row[idx];
        });

        const serviceMap = new Map();
        for (const col of dynamicColumns) {
          const value = row[col.idx];
          if (!value) continue;
          if (!serviceMap.has(col.serviceName)) serviceMap.set(col.serviceName, []);
          serviceMap.get(col.serviceName).push({ label: col.fieldLabel, value });
        }
        student.otherServices = Array.from(serviceMap.entries()).map(([name, fields]) => ({ name, fields }));

        if (!student.name && !student.studentNo && !(student.className && student.number)) continue;
        importedStudents.push(student);
      }

      if (importedStudents.length === 0) {
        alert("インポートできる行が見つかりませんでした。");
        return;
      }

      pendingImport = importedStudents;
      importSummary.textContent = `「${file.name}」から${importedStudents.length}件のデータが見つかりました。読み込み方法を選んでください。`;
      renderImportGaijiWarning(importedStudents);
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
    layoutPreview.innerHTML = buildSheetHtml(maskSecrets(sample));
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

  const CODE_FIELDS = new Set(["googleId", "googlePassword", "deviceNo"]);

  function buildSheetHtml(student, options = {}) {
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
        <h2 class="sheet-title">${escapeHtml(sheetOptions.title.trim() || "アカウントシート")}${options.reissue ? "(再発行)" : ""}</h2>
        <p class="sheet-subtitle">${escapeHtml(student.className)} ${escapeHtml(student.number)}番 ${escapeHtml(student.name)} さん</p>
        ${options.reissue ? `<p class="sheet-reissue">${escapeHtml(formatDate(options.reissue.date))} に「${escapeHtml(options.reissue.target)}」のパスワードを新しくしました。前のパスワードは使えません。</p>` : ""}
        ${message ? `<p class="sheet-message">${escapeHtml(message)}</p>` : ""}
        ${blocks.join("")}
        ${notice ? `<div class="sheet-notice">${escapeHtml(notice)}</div>` : ""}
      </div>
    `;
  }

  async function renderSheetToCanvas(student, options) {
    sheetPreviewArea.innerHTML = buildSheetHtml(student, options);
    const node = sheetPreviewArea.querySelector(".account-sheet");
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff" });
    sheetPreviewArea.innerHTML = "";
    return canvas;
  }

  const B5_JIS_PT = [515.91, 728.5];

  function confirmGaijiBeforePrint(list) {
    const withGaiji = list.filter((s) => gaijiFields(s).length > 0);
    if (withGaiji.length === 0) return true;
    const shown = withGaiji.slice(0, 5).map((s) => "・" + describeGaijiStudent(s)).join("\n");
    const more = withGaiji.length > 5 ? `\n・ほか${withGaiji.length - 5}人` : "";
    return confirm(
      `${withGaiji.length}人のシートに独自の外字が含まれています(外字は「〓」で表示)。\n${shown}${more}\n\n`
      + "このPCに外字が登録されていない場合、シートでは「□」で印刷されます。出力を続けますか？"
    );
  }

  async function exportSheetsPdf(list, filename, options = {}) {
    if (!confirmGaijiBeforePrint(list)) return;
    const { jsPDF } = window.jspdf;
    const [pageW, pageH] = B5_JIS_PT;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: B5_JIS_PT });

    for (let i = 0; i < list.length; i++) {
      if (i > 0) pdf.addPage(B5_JIS_PT, "portrait");
      const canvas = await renderSheetToCanvas(list[i], options);
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
    exportSheetsPdf(list, `アカウントシート_一括_${todayString()}.pdf`);
  });

  // ---------- Password generation ----------

  const DEFAULT_PASSWORD_RULES = { length: 8, upper: true, lower: true, digits: true, symbols: false, excludeConfusing: true };
  const CHARSETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!#$%&*+-=?@_",
  };
  const CONFUSING_CHARS = new Set("0Oo1lI");
  let passwordRules = { ...DEFAULT_PASSWORD_RULES };

  function loadPasswordRules(stored) {
    passwordRules = { ...DEFAULT_PASSWORD_RULES, ...(stored && typeof stored === "object" ? stored : {}) };
  }

  function savePasswordRules() {
    saveStudents();
  }

  function randomIndex(max) {
    // Rejection sampling avoids modulo bias.
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }

  function activeCharsets(rules) {
    return Object.keys(CHARSETS)
      .filter((k) => rules[k])
      .map((k) => Array.from(CHARSETS[k]).filter((ch) => !(rules.excludeConfusing && CONFUSING_CHARS.has(ch))).join(""));
  }

  function generatePassword(rules = passwordRules) {
    const sets = activeCharsets(rules);
    if (sets.length === 0) return "";
    const length = Math.max(rules.length, sets.length);
    const all = sets.join("");
    // One character from each chosen set guarantees the password actually mixes them.
    const chars = sets.map((set) => set[randomIndex(set.length)]);
    while (chars.length < length) chars.push(all[randomIndex(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }

  document.getElementById("btnGenerateGooglePassword").addEventListener("click", () => {
    fieldGooglePassword.value = generatePassword();
    googlePasswordRevealed = true;
    refreshGooglePasswordMask();
  });

  const passwordBulkModal = document.getElementById("passwordBulkModal");
  const pwInputs = {
    length: document.getElementById("pwLength"),
    upper: document.getElementById("pwUpper"),
    lower: document.getElementById("pwLower"),
    digits: document.getElementById("pwDigits"),
    symbols: document.getElementById("pwSymbols"),
    excludeConfusing: document.getElementById("pwExcludeConfusing"),
  };
  const pwIncludeServices = document.getElementById("pwIncludeServices");

  function rulesFromForm() {
    return {
      length: Math.min(32, Math.max(6, Number(pwInputs.length.value) || DEFAULT_PASSWORD_RULES.length)),
      upper: pwInputs.upper.checked,
      lower: pwInputs.lower.checked,
      digits: pwInputs.digits.checked,
      symbols: pwInputs.symbols.checked,
      excludeConfusing: pwInputs.excludeConfusing.checked,
    };
  }

  function bulkTargets(scope, includeServices) {
    let google = 0;
    let services = 0;
    for (const s of sortedFiltered()) {
      if (scope === "all" || !s.googlePassword) google++;
      if (includeServices) {
        for (const svc of s.otherServices || []) {
          services += (svc.fields || []).filter((f) => isPasswordLabel(f.label) && !f.value).length;
        }
      }
    }
    return { google, services };
  }

  function refreshPasswordBulkPreview() {
    const rules = rulesFromForm();
    const warning = document.getElementById("pwRuleWarning");
    const messages = [];
    if (activeCharsets(rules).length === 0) messages.push("使う文字の種類を1つ以上選んでください。");
    if (rules.length < 8) messages.push("Googleのパスワードは8文字以上が必要です。");
    warning.textContent = messages.join(" ");
    warning.hidden = messages.length === 0;
    document.getElementById("pwSample").textContent = generatePassword(rules) || "-";

    const scope = passwordBulkModal.querySelector('input[name="pwScope"]:checked').value;
    const t = bulkTargets(scope, pwIncludeServices.checked);
    document.getElementById("pwTargetCount").textContent =
      `対象(いま一覧に表示されている生徒のうち): Google ${t.google}人` + (pwIncludeServices.checked ? ` / その他サービス ${t.services}件` : "");
  }

  document.getElementById("btnPasswordBulk").addEventListener("click", () => {
    for (const [key, input] of Object.entries(pwInputs)) {
      if (input.type === "checkbox") input.checked = passwordRules[key];
      else input.value = passwordRules[key];
    }
    passwordBulkModal.querySelector('input[value="empty"]').checked = true;
    pwIncludeServices.checked = false;
    refreshPasswordBulkPreview();
    passwordBulkModal.hidden = false;
  });

  passwordBulkModal.addEventListener("input", refreshPasswordBulkPreview);
  document.getElementById("btnPwResample").addEventListener("click", refreshPasswordBulkPreview);
  document.getElementById("btnCancelPasswordBulk").addEventListener("click", () => { passwordBulkModal.hidden = true; });

  document.getElementById("btnDoPasswordBulk").addEventListener("click", () => {
    const rules = rulesFromForm();
    if (activeCharsets(rules).length === 0) return;
    const scope = passwordBulkModal.querySelector('input[name="pwScope"]:checked').value;
    const includeServices = pwIncludeServices.checked;
    const t = bulkTargets(scope, includeServices);
    if (t.google + t.services === 0) {
      alert("生成する対象がありません。");
      return;
    }
    if (scope === "all" && !confirm(`${t.google}人のGoogleパスワードを新しく作り直します。今のパスワードは上書きされます。よろしいですか？`)) {
      return;
    }

    passwordRules = rules;
    savePasswordRules();
    for (const s of sortedFiltered()) {
      if (scope === "all" || !s.googlePassword) s.googlePassword = generatePassword(rules);
      if (includeServices) {
        for (const svc of s.otherServices || []) {
          for (const f of svc.fields || []) {
            if (isPasswordLabel(f.label) && !f.value) f.value = generatePassword(rules);
          }
        }
      }
    }
    saveStudents();
    renderTable();
    passwordBulkModal.hidden = true;
    alert(`パスワードを生成しました(Google ${t.google}人${includeServices ? ` / その他サービス ${t.services}件` : ""})。`);
  });

  // ---------- Password reissue ----------

  function renderReissueHistory(student) {
    const history = (student && student.reissues) || [];
    document.getElementById("reissueHistoryFieldset").hidden = history.length === 0;
    document.getElementById("reissueHistoryList").replaceChildren(...history.slice().reverse().map((h) => {
      const li = document.createElement("li");
      li.textContent = `${formatDate(h.date)} ${h.target}${h.note ? `(${h.note})` : ""}`;
      return li;
    }));
  }

  /** Every password slot a student has: Google plus service fields whose label looks like a password. */
  function passwordTargets(student) {
    const targets = [{ label: "Google", get: () => student.googlePassword, set: (v) => { student.googlePassword = v; } }];
    (student.otherServices || []).forEach((svc) => {
      (svc.fields || []).forEach((f) => {
        if (isPasswordLabel(f.label)) {
          const plain = /^(パスワード|password|pass|pw)$/i.test(f.label.trim());
          const label = plain ? svc.name : `${svc.name}(${f.label})`;
          targets.push({ label, get: () => f.value, set: (v) => { f.value = v; } });
        }
      });
    });
    return targets;
  }

  const reissueModal = document.getElementById("reissueModal");
  const reissueTarget = document.getElementById("reissueTarget");
  const reissuePassword = document.getElementById("reissuePassword");
  const btnToggleReissuePassword = document.getElementById("btnToggleReissuePassword");
  let reissueStudent = null;
  let reissueRevealed = true;

  function refreshReissueMask() {
    setMasked(reissuePassword, !reissueRevealed);
    btnToggleReissuePassword.textContent = reissueRevealed ? "隠す" : "表示";
  }

  function openReissueModal(student) {
    reissueStudent = student;
    document.getElementById("reissueStudent").textContent = `${student.className} ${student.number}番 ${student.name}`;
    reissueTarget.replaceChildren(...passwordTargets(student).map((t, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = t.label;
      return option;
    }));
    reissuePassword.value = generatePassword();
    reissueRevealed = true;
    refreshReissueMask();
    document.getElementById("reissueDate").value = todayString();
    document.getElementById("reissueNote").value = "";
    document.getElementById("reissuePrint").checked = true;
    reissueModal.hidden = false;
  }

  btnToggleReissuePassword.addEventListener("click", () => {
    reissueRevealed = !reissueRevealed;
    refreshReissueMask();
  });
  document.getElementById("btnGenerateReissuePassword").addEventListener("click", () => {
    reissuePassword.value = generatePassword();
    reissueRevealed = true;
    refreshReissueMask();
  });
  document.getElementById("btnCancelReissue").addEventListener("click", () => {
    reissueModal.hidden = true;
    reissuePassword.value = "";
  });

  document.getElementById("btnDoReissue").addEventListener("click", () => {
    const password = reissuePassword.value.trim();
    if (!password) {
      alert("新しいパスワードを入力してください。");
      return;
    }
    const target = passwordTargets(reissueStudent)[Number(reissueTarget.value)];
    if (target.label === "Google" && password.length < GOOGLE_MIN_PASSWORD_LENGTH) {
      alert("Googleのパスワードは8文字以上にしてください。");
      return;
    }
    const entry = {
      date: document.getElementById("reissueDate").value || todayString(),
      target: target.label,
      note: document.getElementById("reissueNote").value.trim(),
    };
    target.set(password);
    reissueStudent.reissues = [...(reissueStudent.reissues || []), entry];
    saveStudents();
    renderTable();
    reissueModal.hidden = true;
    reissuePassword.value = "";

    if (document.getElementById("reissuePrint").checked) {
      const s = reissueStudent;
      exportSheetsPdf([s], `アカウントシート_再発行_${s.className}_${s.number}_${s.name}.pdf`, { reissue: entry });
    }
  });

  // ---------- Year update (graduation & promotion) ----------

  const yearUpdateModal = document.getElementById("yearUpdateModal");
  const yuTopGrade = document.getElementById("yuTopGrade");
  const yuGraduationDate = document.getElementById("yuGraduationDate");
  const yuGraduate = document.getElementById("yuGraduate");
  const yuPromote = document.getElementById("yuPromote");

  function promoteClassName(className) {
    return className.replace(/([0-9０-９]+)(\s*年)/, (m, digits, rest) => `${Number(toHalfWidthDigits(digits)) + 1}${rest}`);
  }

  function yearUpdateTargets() {
    const top = Number(yuTopGrade.value);
    const enrolled = students.filter(isEnrolled);
    return {
      graduating: enrolled.filter((s) => Number(gradeOf(s.className)) === top),
      promoting: enrolled.filter((s) => {
        const g = Number(gradeOf(s.className));
        return g > 0 && g < top;
      }),
      noGrade: enrolled.filter((s) => !gradeOf(s.className)),
    };
  }

  function refreshYearUpdate() {
    const t = yearUpdateTargets();
    document.getElementById("yuGraduateLabel").textContent =
      `${yuTopGrade.value}年の在籍生徒(${t.graduating.length}人)を「卒業」にする`;
    document.getElementById("yuPromoteLabel").textContent =
      `ほかの学年の在籍生徒(${t.promoting.length}人)を1学年上げる`;
    const skipped = document.getElementById("yuSkipped");
    skipped.hidden = t.noGrade.length === 0;
    skipped.textContent = t.noGrade.length
      ? `クラス名から学年が分からない${t.noGrade.length}人は対象外です(例: ${t.noGrade.slice(0, 3).map((s) => `${s.className} ${s.name}`).join("、")})。必要に応じて手で変更してください。`
      : "";
  }

  document.getElementById("btnYearUpdate").addEventListener("click", () => {
    const grades = students.filter(isEnrolled).map((s) => Number(gradeOf(s.className))).filter(Boolean);
    const maxGrade = grades.length ? Math.max(...grades) : 3;
    yuTopGrade.replaceChildren(...Array.from({ length: Math.max(maxGrade, 3) }, (_, i) => {
      const option = document.createElement("option");
      option.value = String(i + 1);
      option.textContent = `${i + 1}年`;
      return option;
    }));
    yuTopGrade.value = String(maxGrade);
    const now = new Date();
    const endYear = now.getMonth() + 1 <= 6 ? now.getFullYear() : now.getFullYear() + 1;
    yuGraduationDate.value = `${endYear}-03-31`;
    yuGraduate.checked = true;
    yuPromote.checked = true;
    refreshYearUpdate();
    yearUpdateModal.hidden = false;
  });

  yuTopGrade.addEventListener("change", refreshYearUpdate);
  document.getElementById("btnCancelYearUpdate").addEventListener("click", () => { yearUpdateModal.hidden = true; });

  document.getElementById("btnDoYearUpdate").addEventListener("click", () => {
    const t = yearUpdateTargets();
    const graduate = yuGraduate.checked;
    const promote = yuPromote.checked;
    if (!graduate && !promote) {
      alert("実行する項目にチェックを入れてください。");
      return;
    }
    const plan = [];
    if (graduate) plan.push(`卒業: ${t.graduating.length}人(卒業日 ${formatDate(yuGraduationDate.value)})`);
    if (promote) plan.push(`進級: ${t.promoting.length}人`);
    if (!confirm(`次の内容で年度更新を実行します。\n${plan.join("\n")}\n\n元に戻すには「コピーを保存」で取ったコピーを開く必要があります。実行しますか？`)) return;

    if (graduate) {
      for (const s of t.graduating) {
        s.status = "卒業";
        s.statusDate = yuGraduationDate.value;
      }
    }
    if (promote) {
      for (const s of t.promoting) s.className = promoteClassName(s.className);
    }
    saveStudents();
    renderTable();
    yearUpdateModal.hidden = true;
    const conflicts = findSeatConflicts();
    alert(`年度更新を実行しました。\n${plan.join("\n")}`
      + (conflicts.length ? `\n\n同じクラス・出席番号の生徒が重複しています。\n${describeSeatConflicts(conflicts)}` : "")
      + "\n\n続けて、クラス替えと新入生の登録をExcelで行ってください。");
  });

  // ---------- Google Admin console bulk-upload CSV ----------

  const GOOGLE_CSV_HEADERS = [
    "First Name [Required]",
    "Last Name [Required]",
    "Email Address [Required]",
    "Password [Required]",
    "Org Unit Path [Required]",
    "Employee ID",
    "Change Password at Next Sign-In",
  ];
  const GOOGLE_MIN_PASSWORD_LENGTH = 8;
  const DEFAULT_GOOGLE_CSV_OPTIONS = { orgUnitPattern: "/", changePasswordAtNextSignIn: true };
  let googleCsvOptions = { ...DEFAULT_GOOGLE_CSV_OPTIONS };

  function loadGoogleCsvOptions(stored) {
    googleCsvOptions = { ...DEFAULT_GOOGLE_CSV_OPTIONS, ...(stored && typeof stored === "object" ? stored : {}) };
  }

  function toHalfWidthDigits(text) {
    return String(text || "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  }

  function gradeOf(className) {
    const m = toHalfWidthDigits(className).match(/(\d+)\s*年/);
    return m ? m[1] : "";
  }

  function splitName(name) {
    const parts = String(name || "").trim().split(/[\s　]+/);
    if (parts.length < 2) return null;
    return { last: parts[0], first: parts.slice(1).join(" ") };
  }

  function orgUnitFor(student, pattern) {
    return pattern.replace(/\{学年\}/g, gradeOf(student.className)).replace(/\{クラス\}/g, student.className);
  }

  function googleCsvIssues(student, pattern) {
    const issues = [];
    if (!splitName(student.name)) issues.push("氏名にスペースがない(姓と名を分けられない)");
    if (!student.googleId) issues.push("Google IDが空欄");
    if (!student.googlePassword) issues.push("パスワードが空欄");
    else if (student.googlePassword.length < GOOGLE_MIN_PASSWORD_LENGTH) issues.push("パスワードが8文字未満");
    if (pattern.includes("{学年}") && !gradeOf(student.className)) issues.push("クラス名から学年が分からない");
    return issues;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  const googleCsvModal = document.getElementById("googleCsvModal");
  const gcsvOrgUnit = document.getElementById("gcsvOrgUnit");
  const gcsvChangePw = document.getElementById("gcsvChangePw");
  const gcsvIssues = document.getElementById("gcsvIssues");

  function refreshGoogleCsvPreview() {
    const pattern = gcsvOrgUnit.value.trim() || "/";
    const list = sortedFiltered();
    const problems = list
      .map((s) => ({ s, issues: googleCsvIssues(s, pattern) }))
      .filter((p) => p.issues.length);
    const ok = list.length - problems.length;
    const example = list.find((s) => !googleCsvIssues(s, pattern).length);
    document.getElementById("gcsvTarget").textContent =
      `出力する生徒: ${ok}人` + (example ? `(例: ${example.name} → 組織部門「${orgUnitFor(example, pattern)}」)` : "");

    gcsvIssues.hidden = problems.length === 0;
    gcsvIssues.replaceChildren();
    if (problems.length) {
      const heading = document.createElement("p");
      heading.textContent = `次の${problems.length}人は出力されません。直してから書き出してください。`;
      const ul = document.createElement("ul");
      for (const p of problems.slice(0, 10)) {
        const li = document.createElement("li");
        li.textContent = `${p.s.className} ${p.s.number}番 ${p.s.name}: ${p.issues.join("、")}`;
        ul.appendChild(li);
      }
      gcsvIssues.append(heading, ul);
      if (problems.length > 10) {
        const more = document.createElement("p");
        more.textContent = `ほか${problems.length - 10}人`;
        gcsvIssues.appendChild(more);
      }
    }
    return { pattern, ok };
  }

  document.getElementById("btnGoogleCsv").addEventListener("click", () => {
    if (sortedFiltered().length === 0) {
      alert("出力対象の生徒がいません。");
      return;
    }
    gcsvOrgUnit.value = googleCsvOptions.orgUnitPattern;
    gcsvChangePw.checked = googleCsvOptions.changePasswordAtNextSignIn;
    refreshGoogleCsvPreview();
    googleCsvModal.hidden = false;
  });

  gcsvOrgUnit.addEventListener("input", refreshGoogleCsvPreview);
  document.getElementById("btnCancelGoogleCsv").addEventListener("click", () => { googleCsvModal.hidden = true; });

  document.getElementById("btnDoGoogleCsv").addEventListener("click", () => {
    const { pattern, ok } = refreshGoogleCsvPreview();
    if (ok === 0) {
      alert("出力できる生徒がいません。");
      return;
    }
    if (!pattern.startsWith("/")) {
      alert("組織部門のパスは「/」から始めてください。");
      return;
    }
    googleCsvOptions = { orgUnitPattern: pattern, changePasswordAtNextSignIn: gcsvChangePw.checked };
    saveStudents();

    const lines = [GOOGLE_CSV_HEADERS.join(",")];
    for (const s of sortedFiltered()) {
      if (googleCsvIssues(s, pattern).length) continue;
      const { last, first } = splitName(s.name);
      lines.push([
        first, last, s.googleId, s.googlePassword, orgUnitFor(s, pattern), s.studentNo || "",
        gcsvChangePw.checked ? "TRUE" : "FALSE",
      ].map(csvCell).join(","));
    }
    // No BOM: the admin console expects the first header to be exactly "First Name [Required]".
    downloadBlob(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv" }), `google-users-${todayString()}.csv`);
    googleCsvModal.hidden = true;
  });

  // ---------- Data file on the shared folder ----------
  //
  // The roster lives in one encrypted .dat file next to index.html on the shared server. Everyone opens it
  // read-only; "編集する" records an edit lock in the file (like 行事予定アプリ) so a second editor is warned,
  // and every save re-checks that lock so two people can never silently overwrite each other.

  const FILE_FORMAT = "account-manager-data";
  const EDIT_LOCK_STALE_MS = 10 * 60 * 1000;
  const SESSION_ID = window.AppCrypto.toBase64(window.AppCrypto.randomBytes(9));
  const FILE_TYPES = [{ description: "アカウント管理データ", accept: { "application/octet-stream": [".dat"] } }];
  const supportsFileAccess = "showOpenFilePicker" in window && "showSaveFilePicker" in window;

  let fileHandle = null;
  /** @type {CryptoKey|null} */
  let fileKey = null;
  let fileKeyHeader = null;
  let loadedSavedAt = null;
  let lockedDoc = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let writing = 0;
  let saveErrorShown = false;
  let idleMinutes = 10;
  let lastActivity = Date.now();

  class EditConflictError extends Error {
    constructor(lock) {
      super("edit conflict");
      this.lock = lock;
    }
  }

  // IndexedDB remembers the file handle so the file reopens with one click next time.
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("accountManagerApp", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction("kv").objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function editorName() {
    return localStorage.getItem(EDITOR_NAME_KEY) || "";
  }

  function isLockFresh(lock) {
    if (!lock || !lock.active || !lock.since) return false;
    const since = new Date(lock.since).getTime();
    return Number.isFinite(since) && Date.now() - since < EDIT_LOCK_STALE_MS;
  }

  function isForeignLock(lock) {
    return isLockFresh(lock) && lock.session !== SESSION_ID;
  }

  function describeLock(lock) {
    return `${lock.by ? lock.by + "さん" : "別の場所"}が編集中(${formatTime(lock.since)}から)`;
  }

  async function readDoc(handle = fileHandle) {
    const file = await handle.getFile();
    const doc = JSON.parse(await file.text());
    if (doc.format !== FILE_FORMAT) throw new Error("アカウント管理アプリのデータファイルではありません。");
    return doc;
  }

  function collectSettings() {
    return { sheetLayout, sheetOptions, passwordRules, googleCsvOptions, idleMinutes };
  }

  function applySettings(settings) {
    settings = settings || {};
    loadLayout(settings.sheetLayout);
    loadSheetOptions(settings.sheetOptions);
    loadPasswordRules(settings.passwordRules);
    loadGoogleCsvOptions(settings.googleCsvOptions);
    idleMinutes = [5, 10, 15, 30].includes(settings.idleMinutes) ? settings.idleMinutes : 10;
  }

  function applyPayload(payload, savedAt) {
    students = Array.isArray(payload.students) ? payload.students : [];
    students.forEach((s) => { s.otherServices = migrateOtherServices(s.otherServices); });
    applySettings(payload.settings);
    loadedSavedAt = savedAt || null;
  }

  function setSaveStatus(text, isError) {
    const el = document.getElementById("saveStatus");
    el.textContent = text;
    el.classList.toggle("error", Boolean(isError));
  }

  function writeDataFile({ releaseLock = false, takeOver = false } = {}) {
    // encryptWithKey serializes synchronously, so the snapshot is the data as of this call.
    const encrypted = window.AppCrypto.encryptWithKey(fileKey, { students, settings: collectSettings() });
    const header = fileKeyHeader;
    const handle = fileHandle;
    writing++;
    const run = async () => {
      setSaveStatus("保存中…");
      if (!takeOver) {
        const current = await readDoc(handle);
        if (isForeignLock(current.editLock)) throw new EditConflictError(current.editLock);
      }
      const box = await encrypted;
      const now = new Date().toISOString();
      const doc = {
        format: FILE_FORMAT,
        version: 1,
        savedAt: now,
        editLock: releaseLock ? { active: false } : { active: true, since: now, by: editorName(), session: SESSION_ID },
        ...header,
        ...box,
      };
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(doc));
      await writable.close();
      loadedSavedAt = now;
      saveErrorShown = false;
      setSaveStatus(`保存済み ${formatTime(now)}`);
    };
    const result = saveChain.then(run);
    saveChain = result.catch(() => {}).finally(() => { writing--; });
    return result;
  }

  function closeAllModals() {
    for (const m of document.querySelectorAll(".modal-overlay")) m.hidden = true;
  }

  function handleSaveError(err) {
    if (err instanceof EditConflictError) {
      editMode = false;
      closeAllModals();
      applyModeUI();
      setSaveStatus("保存を中止しました", true);
      alert(`${describeLock(err.lock)}のため、ここでの最後の変更は保存しませんでした。\n最新の内容を読み込みます。`);
      reloadLatest();
      return;
    }
    setSaveStatus("保存できませんでした", true);
    if (saveErrorShown) return;
    saveErrorShown = true;
    alert(`データファイルに保存できませんでした。\n${err.message}\n\n変更は画面に残っています。共有フォルダにつながっているか確認してから、「編集を終える」を押すと、もう一度保存を試みます。`);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setSaveStatus("未保存の変更があります");
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeDataFile().catch(handleSaveError);
    }, 400);
  }

  function flushSave(options) {
    clearTimeout(saveTimer);
    saveTimer = null;
    return writeDataFile(options);
  }

  window.addEventListener("beforeunload", (e) => {
    if (saveTimer || writing > 0) e.preventDefault();
  });

  // ---------- Screens & modes ----------

  const startScreen = document.getElementById("startScreen");
  const appLock = document.getElementById("appLock");
  const appRoot = document.getElementById("appRoot");
  const appLockPasscode = document.getElementById("appLockPasscode");
  const appLockError = document.getElementById("appLockError");
  const remoteLockWarning = document.getElementById("remoteLockWarning");
  const remoteUpdated = document.getElementById("remoteUpdated");

  function showScreen(name) {
    startScreen.hidden = name !== "start";
    appLock.hidden = name !== "lock";
    appRoot.hidden = name !== "app";
  }

  function applyModeUI() {
    document.body.classList.toggle("edit-mode", editMode);
    document.body.classList.toggle("view-mode", !editMode);
    document.getElementById("modeBadge").textContent = editMode ? "編集中" : "閲覧のみ";
    document.getElementById("btnToggleEdit").textContent = editMode ? "編集を終える" : "編集する";
    document.getElementById("fileName").textContent = fileHandle ? `ファイル: ${fileHandle.name}` : "";
    if (editMode) {
      remoteLockWarning.hidden = true;
      remoteUpdated.hidden = true;
    }
    renderTable();
  }

  function showRemoteState(doc) {
    remoteLockWarning.hidden = editMode || !isForeignLock(doc.editLock);
    if (!remoteLockWarning.hidden) remoteLockWarning.textContent = `⚠ ${describeLock(doc.editLock)}`;
    remoteUpdated.hidden = editMode || !doc.savedAt || doc.savedAt === loadedSavedAt;
  }

  async function refreshRemoteState() {
    if (!fileKey || editMode) return;
    try {
      showRemoteState(await readDoc());
    } catch (e) {
      // The shared folder may be briefly unreachable; try again on the next tick.
    }
  }

  setInterval(refreshRemoteState, 60 * 1000);

  async function reloadLatest() {
    try {
      const doc = await readDoc();
      applyPayload(await window.AppCrypto.decryptWithKey(fileKey, doc), doc.savedAt);
      renderTable();
      showRemoteState(doc);
    } catch (err) {
      alert("最新の内容を読み込めませんでした(パスコードが変更された可能性があります)。開き直します。");
      location.reload();
    }
  }

  document.getElementById("btnReloadLatest").addEventListener("click", reloadLatest);

  async function showStart() {
    showScreen("start");
    document.getElementById("startUnsupported").hidden = supportsFileAccess;
    document.getElementById("startActions").hidden = !supportsFileAccess;
    const btn = document.getElementById("btnOpenLastFile");
    btn.hidden = true;
    if (!supportsFileAccess) return;
    let last = null;
    try {
      last = await idbGet("dataFileHandle");
    } catch (e) {
      last = null;
    }
    if (!last) return;
    btn.hidden = false;
    btn.textContent = `前回のファイル「${last.name}」を開く`;
    btn.onclick = async () => {
      try {
        if (await last.requestPermission({ mode: "readwrite" }) === "granted") await openHandle(last);
      } catch (err) {
        alert("開けませんでした: " + err.message);
      }
    };
  }

  async function openHandle(handle) {
    try {
      const doc = await readDoc(handle);
      fileHandle = handle;
      await idbSet("dataFileHandle", handle).catch(() => {});
      showLockScreen(doc);
    } catch (err) {
      alert("開けませんでした: " + err.message);
      showStart();
    }
  }

  async function pickAndOpen() {
    try {
      const startIn = await idbGet("dataFileHandle").catch(() => undefined);
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, ...(startIn ? { startIn } : {}) });
      await openHandle(handle);
    } catch (err) {
      if (err.name !== "AbortError") alert("開けませんでした: " + err.message);
    }
  }

  function showLockScreen(doc) {
    lockedDoc = doc;
    fileKey = null;
    editMode = false;
    students = [];
    showScreen("lock");
    document.getElementById("appLockFileName").textContent = `ファイル: ${fileHandle.name}`;
    const editing = document.getElementById("appLockEditing");
    editing.hidden = !isForeignLock(doc.editLock);
    if (!editing.hidden) editing.textContent = `⚠ ${describeLock(doc.editLock)}`;
    appLockError.hidden = true;
    appLockPasscode.value = "";
    appLockPasscode.focus();
  }

  document.getElementById("appLockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    appLockError.hidden = true;
    const submit = document.getElementById("appLockSubmit");
    submit.disabled = true;
    try {
      const key = await window.AppCrypto.keyFromEnvelope(appLockPasscode.value, lockedDoc);
      const payload = await window.AppCrypto.decryptWithKey(key, lockedDoc);
      fileKey = key;
      fileKeyHeader = { kdf: lockedDoc.kdf, iter: lockedDoc.iter, salt: lockedDoc.salt };
      applyPayload(payload, lockedDoc.savedAt);
    } catch (err) {
      appLockError.textContent = "パスコードが違います。";
      appLockError.hidden = false;
      return;
    } finally {
      submit.disabled = false;
    }
    const doc = lockedDoc;
    lockedDoc = null;
    appLockPasscode.value = "";
    editMode = false;
    lastActivity = Date.now();
    showScreen("app");
    applyModeUI();
    setSaveStatus(doc.savedAt ? `最終保存 ${formatDateTime(doc.savedAt)}` : "");
    showRemoteState(doc);
  });

  document.getElementById("btnOpenFile").addEventListener("click", pickAndOpen);
  document.getElementById("btnOpenOtherFile").addEventListener("click", pickAndOpen);

  // ---------- Start / stop editing ----------

  async function startEditing() {
    // Ask for write access first, while the click still counts as a user gesture.
    try {
      if (await fileHandle.requestPermission({ mode: "readwrite" }) !== "granted") {
        alert("データファイルへの書き込みが許可されなかったため、編集できません。");
        return;
      }
    } catch (err) {
      alert("データファイルへの書き込みを許可できませんでした: " + err.message);
      return;
    }
    if (!editorName()) {
      const name = prompt("編集者の名前を入力してください(ほかの先生の画面に「○○さんが編集中」と表示されます)", "");
      if (name === null) return;
      localStorage.setItem(EDITOR_NAME_KEY, name.trim());
    }

    let doc;
    try {
      doc = await readDoc();
    } catch (err) {
      alert("データファイルを読み込めませんでした: " + err.message);
      return;
    }
    if (isForeignLock(doc.editLock)) {
      const ok = confirm(`⚠ 警告: ${describeLock(doc.editLock)}です。\n\n`
        + "このまま編集を始めると、相手が入力した内容が上書きされて失われるおそれがあります。\n本当に編集を始めますか？");
      if (!ok) return;
    }
    try {
      // Start from the latest saved content so changes made elsewhere since this screen opened are kept.
      applyPayload(await window.AppCrypto.decryptWithKey(fileKey, doc), doc.savedAt);
    } catch (err) {
      alert("パスコードが変更されているため、開き直します。新しいパスコードを入力してください。");
      showLockScreen(doc);
      return;
    }
    editMode = true;
    applyModeUI();
    try {
      await flushSave({ takeOver: true });
    } catch (err) {
      handleSaveError(err);
    }
  }

  async function stopEditing({ silent = false } = {}) {
    if (!editMode) return true;
    try {
      await flushSave({ releaseLock: true });
    } catch (err) {
      if (!silent) handleSaveError(err);
      return !editMode;
    }
    editMode = false;
    closeAllModals();
    applyModeUI();
    return true;
  }

  document.getElementById("btnToggleEdit").addEventListener("click", () => {
    if (editMode) stopEditing();
    else startEditing();
  });

  async function lockApp({ idle = false } = {}) {
    if (editMode) {
      const ok = await stopEditing({ silent: idle });
      if (!ok) {
        if (idle) {
          lastActivity = Date.now();
          return;
        }
        if (!confirm("保存できていない変更があります。このまま閉じると変更は失われます。閉じますか？")) return;
      }
    }
    location.reload();
  }

  document.getElementById("btnLockNow").addEventListener("click", () => lockApp());

  for (const type of ["mousemove", "keydown", "click", "scroll", "touchstart"]) {
    document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true });
  }
  setInterval(() => {
    if (fileKey && Date.now() - lastActivity > idleMinutes * 60 * 1000) lockApp({ idle: true });
  }, 15000);

  // ---------- Save a copy ----------

  document.getElementById("btnSaveCopy").addEventListener("click", async () => {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: `アカウント名簿_コピー_${todayString()}.dat`, types: FILE_TYPES });
    } catch (err) {
      if (err.name !== "AbortError") alert("保存できませんでした: " + err.message);
      return;
    }
    if (await handle.isSameEntry(fileHandle)) {
      alert("開いているデータファイルそのものには保存できません。別の名前を付けてください。");
      return;
    }
    try {
      const box = await window.AppCrypto.encryptWithKey(fileKey, { students, settings: collectSettings() });
      const doc = { format: FILE_FORMAT, version: 1, savedAt: new Date().toISOString(), editLock: { active: false }, ...fileKeyHeader, ...box };
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(doc));
      await writable.close();
      alert(`コピー「${handle.name}」を保存しました。同じパスコードで開けます。`);
    } catch (err) {
      alert("保存できませんでした: " + err.message);
    }
  });

  // ---------- Create a new data file ----------

  function readLegacyData() {
    try {
      const raw = localStorage.getItem(LEGACY_KEYS.students);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.length ? { plain: parsed } : null;
      return { envelope: parsed };
    } catch (e) {
      return null;
    }
  }

  function readLegacySettings() {
    const get = (key) => {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch (e) {
        return null;
      }
    };
    return {
      sheetLayout: get(LEGACY_KEYS.layout),
      sheetOptions: get(LEGACY_KEYS.sheetOptions),
      passwordRules: get(LEGACY_KEYS.passwordRules),
      googleCsvOptions: get(LEGACY_KEYS.googleCsv),
      idleMinutes: (get(LEGACY_KEYS.security) || {}).idleMinutes,
    };
  }

  const newFileModal = document.getElementById("newFileModal");
  const newFileError = document.getElementById("newFileError");
  let legacyData = null;

  document.getElementById("btnNewFile").addEventListener("click", () => {
    legacyData = readLegacyData();
    document.getElementById("legacyImportRow").hidden = !legacyData;
    if (legacyData) {
      document.getElementById("legacyImportLabel").textContent = legacyData.plain
        ? `このブラウザに残っている以前のデータ(${legacyData.plain.length}人)を取り込む`
        : "このブラウザに残っている以前のデータ(パスコードで保護されたもの)を取り込む";
      document.getElementById("legacyPasscodeRow").hidden = !legacyData.envelope;
    }
    for (const id of ["newPasscode", "newPasscode2", "legacyPasscode"]) document.getElementById(id).value = "";
    newFileError.hidden = true;
    newFileModal.hidden = false;
  });

  document.getElementById("btnCancelNewFile").addEventListener("click", () => { newFileModal.hidden = true; });

  document.getElementById("btnDoNewFile").addEventListener("click", async () => {
    const showError = (message) => {
      newFileError.textContent = message;
      newFileError.hidden = false;
    };
    const passcode = document.getElementById("newPasscode").value;
    if (passcode.length < 8) return showError("パスコードは8文字以上にしてください。");
    if (passcode !== document.getElementById("newPasscode2").value) return showError("確認用のパスコードが一致しません。");

    const useLegacy = Boolean(legacyData) && document.getElementById("legacyImport").checked;
    let migrated = [];
    if (useLegacy) {
      if (legacyData.plain) {
        migrated = legacyData.plain;
      } else {
        try {
          const key = await window.AppCrypto.keyFromEnvelope(document.getElementById("legacyPasscode").value, legacyData.envelope);
          migrated = await window.AppCrypto.decryptWithKey(key, legacyData.envelope);
        } catch (err) {
          return showError("以前のパスコードが違います。");
        }
      }
    }

    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: "アカウント名簿.dat", types: FILE_TYPES });
    } catch (err) {
      if (err.name !== "AbortError") showError("保存できませんでした: " + err.message);
      return;
    }

    const btn = document.getElementById("btnDoNewFile");
    btn.disabled = true;
    try {
      const salt = window.AppCrypto.randomBytes(16);
      const iter = window.AppCrypto.PBKDF2_ITERATIONS;
      fileKey = await window.AppCrypto.deriveKey(passcode, salt, iter);
      fileKeyHeader = { kdf: "PBKDF2-SHA256", iter, salt: window.AppCrypto.toBase64(salt) };
      fileHandle = handle;
      applyPayload({ students: migrated, settings: useLegacy ? readLegacySettings() : {} }, null);
      editMode = true;
      await flushSave({ takeOver: true });
      await idbSet("dataFileHandle", handle).catch(() => {});
      if (useLegacy) {
        // The data now lives (encrypted) in the file; don't leave a second, possibly plaintext copy behind.
        for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key);
      }
    } catch (err) {
      fileKey = null;
      editMode = false;
      showError("作成できませんでした: " + err.message);
      return;
    } finally {
      btn.disabled = false;
    }
    newFileModal.hidden = true;
    lastActivity = Date.now();
    showScreen("app");
    applyModeUI();
    alert(`データファイル「${handle.name}」を作りました(編集中の状態で開いています)。\n`
      + "このアプリ(index.html)と同じ共有フォルダに保存したか確認し、先生方にはパスコードを伝えてください。");
  });

  // ---------- Settings dialog ----------

  const settingsModal = document.getElementById("settingsModal");
  const settingsError = document.getElementById("settingsError");
  const setCurrent = document.getElementById("setCurrent");
  const setNew = document.getElementById("setNew");
  const setNew2 = document.getElementById("setNew2");
  const setIdle = document.getElementById("setIdle");

  function closeSettings() {
    for (const input of [setCurrent, setNew, setNew2]) input.value = "";
    settingsModal.hidden = true;
  }

  document.getElementById("btnSettings").addEventListener("click", () => {
    document.getElementById("setEditorName").value = editorName();
    setIdle.value = String(idleMinutes);
    for (const input of [setCurrent, setNew, setNew2]) input.value = "";
    settingsError.hidden = true;
    settingsModal.hidden = false;
  });

  document.getElementById("btnCancelSettings").addEventListener("click", closeSettings);

  document.getElementById("btnSwitchFile").addEventListener("click", async () => {
    if (editMode && !(await stopEditing())) return;
    closeSettings();
    await pickAndOpen();
  });

  document.getElementById("btnSaveSettings").addEventListener("click", async () => {
    const showError = (message) => {
      settingsError.textContent = message;
      settingsError.hidden = false;
    };
    settingsError.hidden = true;
    localStorage.setItem(EDITOR_NAME_KEY, document.getElementById("setEditorName").value.trim());

    if (!editMode) {
      closeSettings();
      return;
    }

    const wantsNewPasscode = Boolean(setCurrent.value || setNew.value || setNew2.value);
    if (wantsNewPasscode) {
      if (setNew.value.length < 8) return showError("新しいパスコードは8文字以上にしてください。");
      if (setNew.value !== setNew2.value) return showError("確認用のパスコードが一致しません。");
      try {
        const doc = await readDoc();
        const key = await window.AppCrypto.keyFromEnvelope(setCurrent.value, doc);
        await window.AppCrypto.decryptWithKey(key, doc);
      } catch (err) {
        return showError("現在のパスコードが違います。");
      }
      const salt = window.AppCrypto.randomBytes(16);
      const iter = window.AppCrypto.PBKDF2_ITERATIONS;
      fileKey = await window.AppCrypto.deriveKey(setNew.value, salt, iter);
      fileKeyHeader = { kdf: "PBKDF2-SHA256", iter, salt: window.AppCrypto.toBase64(salt) };
    }
    idleMinutes = Number(setIdle.value);
    try {
      await flushSave();
    } catch (err) {
      handleSaveError(err);
      return;
    }
    closeSettings();
    if (wantsNewPasscode) alert("パスコードを変更しました。先生方にも新しいパスコードを伝えてください。");
  });

  // ---------- Init ----------

  (async function init() {
    applySettings({});
    if (!supportsFileAccess) {
      showStart();
      return;
    }
    let last = null;
    try {
      last = await idbGet("dataFileHandle");
    } catch (e) {
      last = null;
    }
    if (last) {
      try {
        if (await last.queryPermission({ mode: "readwrite" }) === "granted") {
          await openHandle(last);
          return;
        }
      } catch (e) {
        // fall through to the start screen
      }
    }
    showStart();
  })();
})();

