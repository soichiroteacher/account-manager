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

  // ---------- Storage (optionally encrypted with the app passcode) ----------

  /** @type {CryptoKey|null} Present only while unlocked with a passcode. */
  let dataKey = null;
  /** Salt/iteration header stored alongside each encrypted snapshot. */
  let dataKeyHeader = null;
  let persistChain = Promise.resolve();
  let pendingWrites = 0;

  function readStoredStudents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? { plain: parsed } : { envelope: parsed };
    } catch (e) {
      console.error("読み込みに失敗しました", e);
      return { plain: [] };
    }
  }

  function persistStudents() {
    if (!dataKey) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(students));
      return persistChain;
    }
    // encryptWithKey serializes synchronously, so this snapshot reflects the data at call time.
    const encrypted = window.AppCrypto.encryptWithKey(dataKey, students);
    const header = dataKeyHeader;
    pendingWrites++;
    persistChain = persistChain
      .then(() => encrypted)
      .then((box) => localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...header, ...box })))
      .catch((err) => alert("保存に失敗しました: " + err.message))
      .finally(() => { pendingWrites--; });
    return persistChain;
  }

  window.addEventListener("beforeunload", (e) => {
    if (pendingWrites > 0) e.preventDefault();
  });

  function saveStudents() {
    persistStudents();
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
    const haystack = [student.name, student.className, student.number, student.studentNo, student.googleId]
      .join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  let showGaijiOnly = false;

  function sortedFiltered() {
    const query = searchBox.value.trim();
    return students
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
      : "検索条件に一致する生徒がいません。";

    for (const student of list) {
      const tr = document.createElement("tr");
      const gaiji = gaijiFields(student);
      const gaijiBadge = gaiji.length
        ? ` <span class="gaiji-badge" title="独自の外字を含む項目: ${escapeHtml(gaiji.join("・"))}">外字あり</span>`
        : "";

      const otherServicesHtml = (student.otherServices || [])
        .map((svc) => `<span class="other-service-tag">${escapeHtml(svc.name)}</span>`)
        .join("");

      tr.innerHTML = `
        <td>${escapeHtml(student.className)}</td>
        <td>${escapeHtml(student.number)}</td>
        <td>${escapeHtml(student.studentNo || "")}</td>
        <td>${escapeHtml(student.name)}${gaijiBadge}</td>
        <td>${escapeHtml(student.googleId || "")}</td>
        <td class="services-cell">${otherServicesHtml}</td>
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
  const fieldStudentNo = document.getElementById("fieldStudentNo");
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
      fieldStudentNo.value = student.studentNo || "";
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

    updateNameGaijiWarning();
    googlePasswordRevealed = false;
    refreshGooglePasswordMask();
    modal.hidden = false;
    fieldName.focus();
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
      <button type="button" class="secret-btn generate-btn">生成</button>
      <button type="button" class="remove-btn" aria-label="この項目を削除">✕</button>
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
      studentNo: fieldStudentNo.value.trim(),
      name: fieldName.value.trim(),
      className: fieldClass.value.trim(),
      number: fieldNumber.value.trim(),
      googleId: fieldGoogleId.value.trim(),
      googlePassword: fieldGooglePassword.value.trim(),
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

    const seatDup = students.find((s) => s.id !== studentData.id && studentKey(s) === studentKey(studentData));
    if (seatDup && !confirm(`${studentData.className} ${studentData.number}番には、すでに ${seatDup.name} さんが登録されています。このまま保存しますか？`)) {
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

  // ---------- JSON backup export / import ----------

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

  document.getElementById("btnExportJson").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(students, null, 2)], { type: "application/json" });
    downloadBlob(blob, `account-manager-backup-${todayString()}.json`);
    markBackedUp();
  });

  // ---------- Password-protected viewer file for other teachers ----------

  function toViewerStudent(s, includePasswords) {
    const details = [];
    for (const svc of s.otherServices || []) {
      for (const f of svc.fields || []) {
        const secret = isPasswordLabel(f.label);
        if (secret && !includePasswords) continue;
        details.push({ label: `${svc.name} ${f.label}`, value: f.value, secret, code: true });
      }
    }
    return {
      className: s.className,
      number: s.number,
      studentNo: s.studentNo || "",
      name: s.name,
      googleId: s.googleId || "",
      googlePassword: includePasswords ? (s.googlePassword || "") : "",
      details,
    };
  }

  const viewerExportModal = document.getElementById("viewerExportModal");
  const viewerPassword = document.getElementById("viewerPassword");
  const viewerPassword2 = document.getElementById("viewerPassword2");
  const viewerIncludePasswords = document.getElementById("viewerIncludePasswords");
  const viewerExportError = document.getElementById("viewerExportError");
  const btnDoViewerExport = document.getElementById("btnDoViewerExport");

  function closeViewerExport() {
    viewerExportModal.hidden = true;
    viewerPassword.value = "";
    viewerPassword2.value = "";
  }

  document.getElementById("btnViewerExport").addEventListener("click", () => {
    const count = sortedFiltered().length;
    if (count === 0) {
      alert("書き出す生徒がいません。");
      return;
    }
    document.getElementById("viewerExportTarget").textContent =
      `対象: いま一覧に表示されている ${count} 人(検索・絞り込みの条件が反映されます)`;
    viewerExportError.hidden = true;
    viewerExportModal.hidden = false;
    viewerPassword.focus();
  });

  document.getElementById("btnCancelViewerExport").addEventListener("click", closeViewerExport);

  btnDoViewerExport.addEventListener("click", async () => {
    const showError = (message) => {
      viewerExportError.textContent = message;
      viewerExportError.hidden = false;
    };
    if (!window.AppCrypto.isAvailable()) {
      showError("このブラウザでは暗号化機能が使えません。Chrome または Edge で開いてください。");
      return;
    }
    if (viewerPassword.value.length < 8) {
      showError("パスワードは8文字以上にしてください。");
      return;
    }
    if (viewerPassword.value !== viewerPassword2.value) {
      showError("確認用のパスワードが一致しません。");
      return;
    }

    const includePasswords = viewerIncludePasswords.checked;
    const payload = {
      includePasswords,
      list: sortedFiltered().map((s) => toViewerStudent(s, includePasswords)),
    };

    btnDoViewerExport.disabled = true;
    btnDoViewerExport.textContent = "暗号化しています…";
    try {
      const envelope = await window.AppCrypto.encryptWithPassword(viewerPassword.value, payload);
      const html = window.buildViewerHtml(envelope, {
        schoolName: sheetOptions.headerText.trim(),
        generatedAt: formatDateTime(Date.now()),
      });
      downloadBlob(new Blob([html], { type: "text/html" }), `アカウント名簿_閲覧用_${todayString()}.html`);
      closeViewerExport();
    } catch (err) {
      showError("書き出しに失敗しました: " + err.message);
    } finally {
      btnDoViewerExport.disabled = false;
      btnDoViewerExport.textContent = "書き出す";
    }
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

  const EXCEL_FIELDS = [
    { key: "studentNo", header: "学籍番号" },
    { key: "name", header: "氏名" },
    { key: "className", header: "クラス" },
    { key: "number", header: "出席番号" },
    { key: "googleId", header: "GoogleID", aliases: ["Google ID"] },
    { key: "googlePassword", header: "Google初期パスワード", aliases: ["Google 初期パスワード"] },
  ];
  const FIXED_HEADERS = EXCEL_FIELDS.map((f) => f.header);

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
      const row = EXCEL_FIELDS.map((f) => s[f.key] || "");
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
      ["・氏名・クラス・出席番号は必須です。氏名は姓と名の間にスペースを入れてください。"],
      ["・「追加・更新」で読み込むと、学籍番号が一致する生徒を更新します(学籍番号がない場合は「クラス＋出席番号」で照合)。"],
      ["・進級・クラス替えのときは、学籍番号を入れたまま新しいクラス・出席番号を入力して読み込むと、まとめて変更できます。"],
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
      if (!s.className || !s.number) continue;
      const key = studentKey(s);
      if (!bySeat.has(key)) bySeat.set(key, []);
      bySeat.get(key).push(s);
    }
    return Array.from(bySeat.values()).filter((group) => group.length > 1);
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
      const byOriginalSeat = new Map(students.map((s) => [studentKey(s), s]));

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
    alert(`読み込みました: ${parts.join(" / ")}${conflictText}`);
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

  async function exportSheetsPdf(list, filename) {
    if (!confirmGaijiBeforePrint(list)) return;
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

  // ---------- Password generation ----------

  const PASSWORD_RULES_KEY = "accountManagerApp.passwordRules.v1";
  const DEFAULT_PASSWORD_RULES = { length: 8, upper: true, lower: true, digits: true, symbols: false, excludeConfusing: true };
  const CHARSETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!#$%&*+-=?@_",
  };
  const CONFUSING_CHARS = new Set("0Oo1lI");
  let passwordRules = { ...DEFAULT_PASSWORD_RULES };

  function loadPasswordRules() {
    try {
      passwordRules = { ...DEFAULT_PASSWORD_RULES, ...JSON.parse(localStorage.getItem(PASSWORD_RULES_KEY)) };
    } catch (e) {
      passwordRules = { ...DEFAULT_PASSWORD_RULES };
    }
  }

  function savePasswordRules() {
    localStorage.setItem(PASSWORD_RULES_KEY, JSON.stringify(passwordRules));
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

  // ---------- Google Admin console bulk-upload CSV ----------

  const GOOGLE_CSV_KEY = "accountManagerApp.googleCsv.v1";
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
  let googleCsvOptions = { orgUnitPattern: "/", changePasswordAtNextSignIn: true };

  function loadGoogleCsvOptions() {
    try {
      googleCsvOptions = { ...googleCsvOptions, ...JSON.parse(localStorage.getItem(GOOGLE_CSV_KEY)) };
    } catch (e) {
      // keep defaults
    }
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
    localStorage.setItem(GOOGLE_CSV_KEY, JSON.stringify(googleCsvOptions));

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

  // ---------- App lock & security settings ----------

  const SECURITY_KEY = "accountManagerApp.security.v1";
  let securitySettings = { idleMinutes: 10 };
  let lastActivity = Date.now();

  function loadSecuritySettings() {
    try {
      securitySettings = { ...securitySettings, ...JSON.parse(localStorage.getItem(SECURITY_KEY)) };
    } catch (e) {
      // keep defaults
    }
  }

  function saveSecuritySettings() {
    localStorage.setItem(SECURITY_KEY, JSON.stringify(securitySettings));
  }

  async function useNewPasscode(passcode) {
    const salt = window.AppCrypto.randomBytes(16);
    const iter = window.AppCrypto.PBKDF2_ITERATIONS;
    dataKey = await window.AppCrypto.deriveKey(passcode, salt, iter);
    dataKeyHeader = { v: 1, kdf: "PBKDF2-SHA256", iter, salt: window.AppCrypto.toBase64(salt) };
    await persistStudents();
  }

  async function verifyPasscode(passcode) {
    await persistChain;
    const stored = readStoredStudents();
    if (!stored.envelope) return false;
    try {
      const key = await window.AppCrypto.keyFromEnvelope(passcode, stored.envelope);
      await window.AppCrypto.decryptWithKey(key, stored.envelope);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function lockNow() {
    await persistChain;
    location.reload();
  }

  function renderSecurityState() {
    document.getElementById("btnLockNow").hidden = !dataKey;
  }

  const appLock = document.getElementById("appLock");
  const appLockPasscode = document.getElementById("appLockPasscode");
  const appLockError = document.getElementById("appLockError");
  let lockedEnvelope = null;

  function showAppLock(envelope) {
    lockedEnvelope = envelope;
    document.body.classList.add("is-locked");
    appLock.hidden = false;
    appLockPasscode.focus();
  }

  document.getElementById("appLockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    appLockError.hidden = true;
    if (!window.AppCrypto.isAvailable()) {
      appLockError.textContent = "このブラウザでは暗号化機能が使えません。Chrome または Edge で開いてください。";
      appLockError.hidden = false;
      return;
    }
    const submit = document.getElementById("appLockSubmit");
    submit.disabled = true;
    try {
      const key = await window.AppCrypto.keyFromEnvelope(appLockPasscode.value, lockedEnvelope);
      students = await window.AppCrypto.decryptWithKey(key, lockedEnvelope);
      dataKey = key;
      const { v, kdf, iter, salt } = lockedEnvelope;
      dataKeyHeader = { v, kdf, iter, salt };
    } catch (err) {
      appLockError.textContent = "パスコードが違います。";
      appLockError.hidden = false;
      return;
    } finally {
      submit.disabled = false;
    }
    appLockPasscode.value = "";
    lockedEnvelope = null;
    appLock.hidden = true;
    document.body.classList.remove("is-locked");
    startApp();
  });

  document.getElementById("btnForgotPasscode").addEventListener("click", () => {
    const ok = confirm("パスコードが分からない場合、このブラウザ内の名簿は開けません。\n"
      + "名簿を消去して最初からやり直し、「バックアップ読み込み」で復元できます。\n\n名簿を消去しますか？");
    if (!ok || !confirm("本当に消去しますか？この操作は取り消せません。")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
    location.reload();
  });

  document.getElementById("btnLockNow").addEventListener("click", lockNow);

  for (const type of ["mousemove", "keydown", "click", "scroll", "touchstart"]) {
    document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true });
  }
  setInterval(() => {
    if (dataKey && Date.now() - lastActivity > securitySettings.idleMinutes * 60 * 1000) lockNow();
  }, 15000);

  const securityModal = document.getElementById("securityModal");
  const secCurrent = document.getElementById("secCurrent");
  const secNew = document.getElementById("secNew");
  const secNew2 = document.getElementById("secNew2");
  const secIdle = document.getElementById("secIdle");
  const securityError = document.getElementById("securityError");

  function showSecurityError(message) {
    securityError.textContent = message;
    securityError.hidden = false;
  }

  function openSecurityModal() {
    const enabled = Boolean(dataKey);
    document.getElementById("securityState").textContent = enabled
      ? "現在: パスコードで保護されています"
      : "現在: パスコードは設定されていません";
    document.getElementById("secCurrentRow").hidden = !enabled;
    document.getElementById("secNewLabel").textContent = enabled ? "新しいパスコード(変更する場合のみ)" : "新しいパスコード";
    document.getElementById("btnRemovePasscode").hidden = !enabled;
    for (const input of [secCurrent, secNew, secNew2]) input.value = "";
    secIdle.value = String(securitySettings.idleMinutes);
    securityError.hidden = true;
    securityModal.hidden = false;
  }

  function closeSecurityModal() {
    for (const input of [secCurrent, secNew, secNew2]) input.value = "";
    securityModal.hidden = true;
  }

  document.getElementById("btnSecurity").addEventListener("click", openSecurityModal);
  document.getElementById("btnCancelSecurity").addEventListener("click", closeSecurityModal);

  document.getElementById("btnSaveSecurity").addEventListener("click", async () => {
    securityError.hidden = true;
    const wantsNew = secNew.value || secNew2.value;
    if (wantsNew) {
      if (!window.AppCrypto.isAvailable()) return showSecurityError("このブラウザでは暗号化機能が使えません。");
      if (secNew.value.length < 6) return showSecurityError("パスコードは6文字以上にしてください。");
      if (secNew.value !== secNew2.value) return showSecurityError("確認用のパスコードが一致しません。");
      if (dataKey && !(await verifyPasscode(secCurrent.value))) return showSecurityError("現在のパスコードが違います。");
      await useNewPasscode(secNew.value);
    }
    securitySettings.idleMinutes = Number(secIdle.value);
    saveSecuritySettings();
    renderSecurityState();
    closeSecurityModal();
    if (wantsNew) alert("パスコードを設定しました。名簿はこのブラウザ内で暗号化して保存されます。");
  });

  document.getElementById("btnRemovePasscode").addEventListener("click", async () => {
    securityError.hidden = true;
    if (!(await verifyPasscode(secCurrent.value))) return showSecurityError("現在のパスコードを正しく入力してください。");
    if (!confirm("パスコードを解除すると、名簿は暗号化されずに保存されます。解除しますか？")) return;
    dataKey = null;
    dataKeyHeader = null;
    await persistStudents();
    renderSecurityState();
    closeSecurityModal();
  });

  // ---------- Init ----------

  function startApp() {
    students.forEach((s) => { s.otherServices = migrateOtherServices(s.otherServices); });
    lastActivity = Date.now();
    renderTable();
    renderBackupStatus();
    renderSecurityState();
  }

  loadLayout();
  loadSheetOptions();
  loadMeta();
  loadSecuritySettings();
  loadPasswordRules();
  loadGoogleCsvOptions();

  const initialData = readStoredStudents();
  if (initialData.envelope) {
    showAppLock(initialData.envelope);
  } else {
    students = initialData.plain;
    startApp();
  }
})();
