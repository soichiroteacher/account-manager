// 職員の名簿・アカウントと、役割分担(ツリー・表)、回覧用の名簿。
// データは生徒と同じデータファイルに入る(staff・org・staffOptions)。保存・編集中の表示・編集の記録・
// バックアップは app.js の仕組みをそのまま使う(app.js が window.AccountManager で道具を渡している)。
//
// データの形:
//   staff: [{ id, staffNo, name, kana, jobType, status("在職"|"転出・退職"), statusDate,
//             googleId, googlePassword, otherServices:[{ name, fields:[{label,value}] }], deviceNo, note }]
//   org:   { years: { "2026": { nodes: [{ id, name, parentId, members:[{ staffId, name, role }] }] } } }
//          nodes の並び順が、同じ上の部署の中での表示の順番。members の name は、職員を消しても
//          過去の年度の担当者が分かるように残している控え(職員の名前を直すと、ここも直す)。
//   staffOptions: { sheetMessage, sheetNotice, rosterTitle }
(function () {
  "use strict";

  // ===== 学校ごとに変わる設定 =====
  // 職名の候補と、一覧・名簿での並び順(上ほど先)。ここにない職名も入力できる(その場合は一番後ろに並ぶ)。
  const JOB_TYPES = [
    "校長", "副校長", "教頭", "主幹教諭", "指導教諭", "教諭", "講師", "養護教諭", "栄養教諭",
    "事務", "スクール・サポート・スタッフ", "特別支援教育支援員", "スクールカウンセラー", "用務", "その他",
  ];
  // 担当者の役割の候補(自由に入力もできる)
  const ROLE_SUGGESTIONS = ["主任", "部長", "副主任", "責任者", "担当", "担任", "副担任"];
  // ツリーで、この深さ(一番上が 0)より下にある部署は、子の係を枠の中に縦に並べる(横に広がりすぎないように)
  const NEST_FROM_DEPTH = 2;
  const DEFAULT_STAFF_OPTIONS = {
    sheetMessage: "校務で使うアカウントをお知らせします。\n初めてログインしたら、パスワードを変更してください。",
    sheetNotice: "【取り扱いの注意】\n・この用紙には、あなた専用のアカウント情報(IDとパスワード)が書かれています。\n・他の人に見せたり、写真に撮って送ったりしないでください。\n・なくしたときは、すぐに情報担当の先生に知らせてください。",
    rosterTitle: "職員名簿(回覧)",
  };
  const STAFF_STATUSES = ["在職", "転出・退職"];
  const TAB_KEY = "accountManagerApp.tab";
  const ORG_VIEW_KEY = "accountManagerApp.orgView";

  const A = window.AccountManager;
  const esc = A.escapeHtml;
  const $ = (id) => document.getElementById(id);

  let staff = [];
  let org = { years: {} };
  let staffOptions = { ...DEFAULT_STAFF_OPTIONS };
  let currentTab = "students";
  let orgYear = "";
  let orgViewMode = "tree";

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 覚えられなくても動く */ }
  }

  // ---------- 読み込み・保存(app.js から呼ばれる) ----------

  function normalizeStaff(list) {
    return (Array.isArray(list) ? list : []).filter((s) => s && typeof s === "object").map((s) => ({
      id: s.id || A.generateId(),
      staffNo: String(s.staffNo || ""),
      name: String(s.name || ""),
      kana: String(s.kana || ""),
      jobType: String(s.jobType || ""),
      status: STAFF_STATUSES.includes(s.status) ? s.status : "在職",
      statusDate: String(s.statusDate || ""),
      googleId: String(s.googleId || ""),
      googlePassword: String(s.googlePassword || ""),
      otherServices: Array.isArray(s.otherServices) ? s.otherServices : [],
      deviceNo: String(s.deviceNo || ""),
      note: String(s.note || ""),
    }));
  }

  function normalizeOrg(raw) {
    const years = {};
    const src = raw && raw.years && typeof raw.years === "object" ? raw.years : {};
    for (const [year, data] of Object.entries(src)) {
      const nodes = (data && Array.isArray(data.nodes) ? data.nodes : []).map((n) => ({
        id: n.id || A.generateId(),
        name: String(n.name || ""),
        parentId: n.parentId || null,
        members: (Array.isArray(n.members) ? n.members : []).map((m) => ({
          staffId: m.staffId || "", name: String(m.name || ""), role: String(m.role || ""),
        })),
      }));
      years[year] = { nodes };
    }
    return { years };
  }

  function load(payload) {
    staff = normalizeStaff(payload.staff);
    org = normalizeOrg(payload.org);
    staffOptions = { ...DEFAULT_STAFF_OPTIONS, ...((payload.staffOptions && typeof payload.staffOptions === "object") ? payload.staffOptions : {}) };
    orgYear = defaultYear();
  }

  function collect() {
    return { staff, org, staffOptions };
  }

  function save() {
    A.save();
  }

  // ---------- 共通の小さな道具 ----------

  /** 年度(4月始まり)。1〜3月は前の年の年度 */
  function fiscalYear(date = new Date()) {
    return date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear();
  }

  function yearsDesc() {
    return Object.keys(org.years).sort((a, b) => Number(b) - Number(a));
  }

  function defaultYear() {
    const years = yearsDesc();
    const now = String(fiscalYear());
    return years.includes(now) ? now : (years[0] || "");
  }

  function staffById(id) {
    return staff.find((s) => s.id === id) || null;
  }

  function memberName(m) {
    const s = m.staffId ? staffById(m.staffId) : null;
    return s ? s.name : m.name;
  }

  function jobRank(jobType) {
    const i = JOB_TYPES.indexOf(jobType);
    return i < 0 ? JOB_TYPES.length : i;
  }

  function sortedStaff(list) {
    return [...list].sort((a, b) => jobRank(a.jobType) - jobRank(b.jobType)
      || a.staffNo.localeCompare(b.staffNo, "ja", { numeric: true })
      || (a.kana || a.name).localeCompare(b.kana || b.name, "ja"));
  }

  function nodesOf(year) {
    return (org.years[year] && org.years[year].nodes) || [];
  }

  function childrenOf(nodes, parentId) {
    return nodes.filter((n) => (n.parentId || null) === parentId);
  }

  /** 上の部署がない(または見つからない)部署を一番上として扱う */
  function rootsOf(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    return nodes.filter((n) => !n.parentId || !ids.has(n.parentId));
  }

  /** ツリーの順番(上から・左から)で並べた [{ node, depth, path }] */
  function walk(nodes) {
    const out = [];
    const visit = (node, depth, path) => {
      const p = [...path, node.name];
      out.push({ node, depth, path: p });
      for (const c of childrenOf(nodes, node.id)) visit(c, depth + 1, p);
    };
    for (const r of rootsOf(nodes)) visit(r, 0, []);
    return out;
  }

  /** その年度で、職員ごとの担当 [{ nodeName, role }] */
  function assignmentsOf(person, year) {
    const out = [];
    for (const { node } of walk(nodesOf(year))) {
      for (const m of node.members) {
        if ((m.staffId && m.staffId === person.id) || (!m.staffId && m.name === person.name)) {
          out.push({ nodeName: node.name, role: m.role });
        }
      }
    }
    return out;
  }

  function describeAssignments(list) {
    return list.map((a) => (a.role ? `${a.nodeName}(${a.role})` : a.nodeName)).join("、");
  }

  // ---------- 画面の切り替え(生徒・職員・役割分担) ----------

  function showTab(tab) {
    currentTab = ["students", "staff", "org"].includes(tab) ? tab : "students";
    safeSet(TAB_KEY, currentTab);
    document.body.dataset.tab = currentTab;
    $("studentView").hidden = currentTab !== "students";
    $("staffView").hidden = currentTab !== "staff";
    $("orgView").hidden = currentTab !== "org";
    for (const b of document.querySelectorAll("#mainTabs [data-tab]")) {
      b.classList.toggle("active", b.dataset.tab === currentTab);
      b.setAttribute("aria-selected", String(b.dataset.tab === currentTab));
    }
    render();
  }

  $("mainTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showTab(b.dataset.tab);
  });

  function render() {
    if (currentTab === "staff") renderStaffTable();
    if (currentTab === "org") renderOrg();
  }

  // ---------- 職員の一覧 ----------

  function filteredStaff() {
    const filter = $("staffFilter").value;
    const q = $("staffSearch").value.trim().toLowerCase();
    const year = defaultYear();
    return sortedStaff(staff).filter((s) => {
      if (filter === "active" && s.status !== "在職") return false;
      if (filter === "left" && s.status === "在職") return false;
      if (!q) return true;
      // 担当(今年度の部署・係の名前)でも探せるようにする(例: 「教務」で教務部の先生)
      const assign = year ? describeAssignments(assignmentsOf(s, year)) : "";
      return [s.staffNo, s.name, s.kana, s.jobType, s.googleId, s.deviceNo, assign]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  function renderStaffTable() {
    const list = filteredStaff();
    const year = defaultYear();
    $("staffAssignHeader").textContent = year ? `担当(${year}年度)` : "担当";
    $("staffCount").textContent = `${list.length}人`;
    $("staffEmpty").hidden = staff.length > 0;
    const edit = A.isEditMode();
    $("staffTableBody").innerHTML = list.map((s) => `
      <tr${s.status !== "在職" ? ' class="row-inactive"' : ""}>
        <td>${esc(s.staffNo)}</td>
        <td>${esc(s.name)}${s.status !== "在職" ? ` <span class="status-badge">${esc(s.status)}</span>` : ""}</td>
        <td>${esc(s.jobType)}</td>
        <td>${esc(s.googleId)}</td>
        <td>${esc(s.deviceNo)}</td>
        <td>${esc(year ? describeAssignments(assignmentsOf(s, year)) : "")}</td>
        <td class="row-actions">
          <button class="btn btn-small" data-staff-action="edit" data-id="${s.id}">${edit ? "編集" : "詳細"}</button>
          <button class="btn btn-small" data-staff-action="sheet" data-id="${s.id}">シート印刷</button>
          <button class="btn btn-small btn-danger edit-only" data-staff-action="delete" data-id="${s.id}">削除</button>
        </td>
      </tr>`).join("");
  }

  $("staffFilter").addEventListener("change", renderStaffTable);
  $("staffSearch").addEventListener("input", renderStaffTable);

  $("staffTableBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-staff-action]");
    if (!b) return;
    const s = staffById(b.dataset.id);
    if (!s) return;
    if (b.dataset.staffAction === "edit") openStaffModal(s);
    if (b.dataset.staffAction === "sheet") printStaffSheets([s], `アカウントシート_職員_${s.name}`);
    if (b.dataset.staffAction === "delete") deleteStaff(s);
  });

  function deleteStaff(s) {
    const used = yearsDesc().filter((y) => assignmentsOf(s, y).length > 0);
    let message = `${s.name} 先生のデータを削除しますか？\n\n削除すると元に戻せません。`;
    if (used.length) {
      message += `\n\n${used.join("・")}年度の役割分担に入っています。役割分担には名前だけが残ります。`
        + "\n(異動した先生は、削除せずに「状況」を「転出・退職」にすると、過去の記録とつながったまま残せます)";
    }
    if (!confirm(message)) return;
    // 役割分担には名前の控えを残し、職員とのつながりだけを外す
    for (const y of Object.keys(org.years)) {
      for (const n of nodesOf(y)) {
        for (const m of n.members) {
          if (m.staffId === s.id) { m.name = s.name; m.staffId = ""; }
        }
      }
    }
    staff = staff.filter((x) => x.id !== s.id);
    save();
    render();
  }

  // ---------- 職員の登録・編集 ----------

  let editingStaffId = null;

  function addStaffServiceRow(svc) {
    const fields = (svc && svc.fields) || [];
    const idField = fields.find((f) => !/パスワード|password/i.test(f.label));
    const pwField = fields.find((f) => /パスワード|password/i.test(f.label));
    const row = document.createElement("div");
    row.className = "staff-service-row";
    row.innerHTML = `
      <input type="text" class="svc-name" placeholder="サービス名(例: 校務支援システム)">
      <input type="text" class="svc-id" placeholder="ID">
      <input type="text" class="svc-pw secret-input" placeholder="パスワード" autocomplete="off">
      <button type="button" class="btn btn-small btn-danger edit-only svc-remove" title="この行を消す">✕</button>`;
    row.querySelector(".svc-name").value = (svc && svc.name) || "";
    row.querySelector(".svc-id").value = idField ? idField.value : "";
    row.querySelector(".svc-pw").value = pwField ? pwField.value : "";
    A.setMasked(row.querySelector(".svc-pw"), !$("staffShowPasswords").checked);
    row.querySelector(".svc-remove").addEventListener("click", () => row.remove());
    $("staffServices").appendChild(row);
  }

  function refreshStaffMasks() {
    const masked = !$("staffShowPasswords").checked;
    for (const input of $("staffModal").querySelectorAll(".secret-input")) A.setMasked(input, masked);
  }

  function refreshStaffStatusRow() {
    $("staffStatusDateRow").hidden = $("staffStatus").value === "在職";
  }

  function openStaffModal(s) {
    editingStaffId = s ? s.id : null;
    const edit = A.isEditMode();
    $("staffModalTitle").textContent = s ? (edit ? "職員の編集" : "職員の詳細") : "職員を追加";
    $("staffNo").value = s ? s.staffNo : "";
    $("staffName").value = s ? s.name : "";
    $("staffKana").value = s ? s.kana : "";
    $("staffJob").value = s ? s.jobType : "教諭";
    $("staffStatus").value = s ? s.status : "在職";
    $("staffStatusDate").value = s ? s.statusDate : "";
    $("staffGoogleId").value = s ? s.googleId : "";
    $("staffGooglePassword").value = s ? s.googlePassword : "";
    $("staffDeviceNo").value = s ? s.deviceNo : "";
    $("staffNote").value = s ? s.note : "";
    $("staffShowPasswords").checked = false;
    $("staffServices").innerHTML = "";
    for (const svc of (s ? s.otherServices : [])) addStaffServiceRow(svc);
    refreshStaffMasks();
    refreshStaffStatusRow();
    // 閲覧中は見るだけ(入力欄を変えられないようにする)
    for (const el of $("staffForm").querySelectorAll("input, select, textarea")) {
      if (el.id === "staffShowPasswords") continue;
      el.disabled = !edit;
    }
    const year = defaultYear();
    const assign = s && year ? describeAssignments(assignmentsOf(s, year)) : "";
    $("staffAssignInfo").textContent = s && year ? `${year}年度の担当: ${assign || "なし"}(「役割分担」の画面で変えます)` : "";
    $("staffError").hidden = true;
    $("staffModal").hidden = false;
  }

  $("staffShowPasswords").addEventListener("change", refreshStaffMasks);
  $("staffStatus").addEventListener("change", refreshStaffStatusRow);
  $("btnAddStaffService").addEventListener("click", () => addStaffServiceRow(null));
  $("btnStaffGeneratePassword").addEventListener("click", () => {
    if ($("staffGooglePassword").value && !confirm("今のパスワードを、新しく作ったものに置き換えますか？")) return;
    $("staffGooglePassword").value = A.generatePassword();
    $("staffShowPasswords").checked = true;
    refreshStaffMasks();
  });
  $("btnAddStaff").addEventListener("click", () => openStaffModal(null));
  $("btnCancelStaff").addEventListener("click", () => { $("staffModal").hidden = true; });

  $("btnSaveStaff").addEventListener("click", () => {
    const name = $("staffName").value.trim().replace(/　/g, " ");
    const showError = (text) => { $("staffError").textContent = text; $("staffError").hidden = false; };
    if (!name) return showError("氏名を入れてください。");
    const staffNo = $("staffNo").value.trim();
    if (staffNo) {
      const dup = staff.find((x) => x.staffNo === staffNo && x.id !== editingStaffId);
      if (dup) return showError(`職員番号「${staffNo}」は ${dup.name} 先生に使われています。`);
    }
    const services = Array.from($("staffServices").querySelectorAll(".staff-service-row"))
      .map((row) => ({
        name: row.querySelector(".svc-name").value.trim(),
        fields: [
          { label: "ID", value: row.querySelector(".svc-id").value.trim() },
          { label: "パスワード", value: row.querySelector(".svc-pw").value.trim() },
        ],
      }))
      .filter((svc) => svc.name || svc.fields.some((f) => f.value));
    const data = {
      staffNo, name,
      kana: $("staffKana").value.trim(),
      jobType: $("staffJob").value.trim(),
      status: $("staffStatus").value,
      statusDate: $("staffStatus").value === "在職" ? "" : $("staffStatusDate").value,
      googleId: $("staffGoogleId").value.trim(),
      googlePassword: $("staffGooglePassword").value.trim(),
      otherServices: services,
      deviceNo: $("staffDeviceNo").value.trim(),
      note: $("staffNote").value.trim(),
    };
    if (editingStaffId) {
      const s = staffById(editingStaffId);
      Object.assign(s, data);
      // 役割分担の名前の控えも新しい名前にする
      for (const y of Object.keys(org.years)) {
        for (const n of nodesOf(y)) for (const m of n.members) if (m.staffId === s.id) m.name = s.name;
      }
    } else {
      staff.push({ id: A.generateId(), ...data });
    }
    save();
    $("staffModal").hidden = true;
    render();
  });

  // ---------- 職員のアカウントシート ----------

  function buildStaffSheetHtml(s) {
    const so = A.sheetOptions();
    const rows = [
      ["職員番号", s.staffNo, false],
      ["Google ID", s.googleId, true],
      ["Google パスワード", s.googlePassword, true],
      ["端末番号", s.deviceNo, true],
    ].filter(([, v]) => v)
      .map(([label, v, code]) => `<tr><th>${esc(label)}</th><td${code ? ' class="code"' : ""}>${esc(v)}</td></tr>`).join("");
    const svcRows = s.otherServices
      .map((svc) => svc.fields.filter((f) => f.value)
        .map((f) => `<tr><th>${esc(svc.name)} ${esc(f.label)}</th><td class="code">${esc(f.value)}</td></tr>`).join(""))
      .join("");
    const message = staffOptions.sheetMessage.trim();
    const notice = staffOptions.sheetNotice.trim();
    return `
      <div class="account-sheet">
        ${so.headerText.trim() ? `<p class="sheet-header-text">${esc(so.headerText.trim())}</p>` : ""}
        <h2 class="sheet-title">アカウントシート(職員用)</h2>
        <p class="sheet-subtitle">${esc(s.jobType)} ${esc(s.name)} 先生</p>
        ${message ? `<p class="sheet-message">${esc(message)}</p>` : ""}
        ${rows ? `<table>${rows}</table>` : ""}
        ${svcRows ? `<p class="sheet-section-title">その他のサービス</p><table>${svcRows}</table>` : ""}
        ${notice ? `<div class="sheet-notice">${esc(notice)}</div>` : ""}
      </div>`;
  }

  function printStaffSheets(list, title) {
    if (list.length === 0) {
      alert("印刷する職員がいません。一覧の表示の切り替えや検索の条件を確かめてください。");
      return;
    }
    A.printSheetHtmlList(list.map(buildStaffSheetHtml), title);
  }

  $("btnPrintStaffSheets").addEventListener("click", () => {
    printStaffSheets(filteredStaff(), `アカウントシート_職員_一括_${A.todayString()}`);
  });

  // 職員用シートの文言
  $("btnStaffSheetOptions").addEventListener("click", () => {
    $("staffSheetMessage").value = staffOptions.sheetMessage;
    $("staffSheetNotice").value = staffOptions.sheetNotice;
    $("staffSheetModal").hidden = false;
  });
  $("btnCancelStaffSheet").addEventListener("click", () => { $("staffSheetModal").hidden = true; });
  $("btnResetStaffSheet").addEventListener("click", () => {
    $("staffSheetMessage").value = DEFAULT_STAFF_OPTIONS.sheetMessage;
    $("staffSheetNotice").value = DEFAULT_STAFF_OPTIONS.sheetNotice;
  });
  $("btnSaveStaffSheet").addEventListener("click", () => {
    staffOptions.sheetMessage = $("staffSheetMessage").value;
    staffOptions.sheetNotice = $("staffSheetNotice").value;
    save();
    $("staffSheetModal").hidden = true;
  });

  // ---------- 回覧用の名簿 ----------

  $("btnPrintRoster").addEventListener("click", () => {
    $("rosterTitle").value = staffOptions.rosterTitle;
    const sel = $("rosterYear");
    const years = yearsDesc();
    sel.innerHTML = `<option value="">(担当を入れない)</option>` + years.map((y) => `<option value="${y}">${y}年度の担当を入れる</option>`).join("");
    sel.value = defaultYear();
    $("rosterModal").hidden = false;
  });
  $("btnCancelRoster").addEventListener("click", () => { $("rosterModal").hidden = true; });

  $("btnDoPrintRoster").addEventListener("click", () => {
    const title = $("rosterTitle").value.trim() || DEFAULT_STAFF_OPTIONS.rosterTitle;
    const year = $("rosterYear").value;
    const checkLabel = $("rosterCheckLabel").value.trim();
    const list = sortedStaff(staff.filter((s) => s.status === "在職"));
    if (list.length === 0) {
      alert("在職中の職員が登録されていません。");
      return;
    }
    if (title !== staffOptions.rosterTitle && A.isEditMode()) {
      staffOptions.rosterTitle = title;
      save();
    }
    const rows = list.map((s, i) => `<tr>
        <td class="num">${i + 1}</td><td class="name">${esc(s.name)}</td><td>${esc(s.jobType)}</td>
        ${year ? `<td>${esc(describeAssignments(assignmentsOf(s, year)))}</td>` : ""}
        ${checkLabel ? '<td class="check"></td>' : ""}</tr>`).join("");
    const html = `
      <h1 class="doc-title">${esc(title)}</h1>
      <p class="doc-sub">${esc(A.sheetOptions().headerText)}　${esc(A.todayString())} 現在　${list.length}人</p>
      <table class="doc-table">
        <thead><tr><th class="num">No.</th><th>氏名</th><th>職名</th>${year ? `<th>担当(${esc(year)}年度)</th>` : ""}${checkLabel ? `<th class="check">${esc(checkLabel)}</th>` : ""}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    $("rosterModal").hidden = true;
    A.printDocument(html, `${title}_${A.todayString()}`, "A4 portrait");
  });

  // ---------- Excel・CSV の読み込みの道具(職員・役割分担で共通) ----------

  /** 見出しを比べるための形(全角・半角、空白、大文字・小文字の違いをなくす) */
  function normHeader(h) {
    return String(h ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  }

  /** 名前を比べるための形(空白の有無・全角/半角の空白の違いをなくす)。
   *  漢字はそのまま比べる(NFKC にすると「﨑」が「崎」になるなど、別の字になってしまうため) */
  function nameKey(n) {
    return String(n ?? "").replace(/[\s　]+/g, "");
  }

  /** 職員の一覧から名前で探す(空白の違いは無視。同じ名前なら在職の人を先に) */
  function findStaffByName(n) {
    const k = nameKey(n);
    if (!k) return null;
    return staff.find((s) => nameKey(s.name) === k && s.status === "在職") || staff.find((s) => nameKey(s.name) === k) || null;
  }

  /**
   * 見出しの行を探して、列の番号を決める。
   * fields … [{ key, header, aliases }]。ほかの名簿の見出し(「名前」「職種」など)も aliases で読む。
   * 名簿の1行目が題名(例「令和8年度 職員名簿」)のこともあるので、上から10行の中で
   * mustKeys のどれかが見つかった行を見出しとする。
   * 戻り値 { headerRow, cols: { key: 列番号 }, used: [「氏名(←名前)」…], unused: [読まない見出し…], headers }
   */
  function mapColumns(aoa, fields, mustKeys, extraTest) {
    const table = {};
    for (const f of fields) for (const h of [f.header, ...(f.aliases || [])]) table[normHeader(h)] = f.key;
    for (let r = 0; r < Math.min(aoa.length, 10); r++) {
      const headers = (aoa[r] || []).map((h) => String(h ?? "").trim());
      const cols = {};
      headers.forEach((h, i) => {
        const key = table[normHeader(h)];
        if (key && cols[key] === undefined) cols[key] = i;
      });
      if (!mustKeys.some((k) => cols[k] !== undefined)) continue;
      const used = [], unused = [];
      headers.forEach((h, i) => {
        if (!h) return;
        const f = fields.find((x) => cols[x.key] === i);
        if (f) used.push(normHeader(h) === normHeader(f.header) ? f.header : `${f.header}(←「${h}」)`);
        else if (!(extraTest && extraTest(h))) unused.push(h);
      });
      return { headerRow: r, cols, used, unused, headers };
    }
    return null;
  }

  async function readFirstSheet(file) {
    const wb = await A.readSpreadsheetFile(file);
    return A.readSheetAsText(wb.Sheets[wb.SheetNames[0]]);
  }

  function listShort(list, max = 8) {
    return list.length > max ? `${list.slice(0, max).join("、")} ほか${list.length - max}件` : list.join("、");
  }

  /** カタカナ・半角カナをひらがなにする(ふりがなをそろえるため) */
  function toHiragana(s) {
    return String(s).normalize("NFKC").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // ---------- 職員の Excel ----------

  // header … 書き出しの見出し。aliases … 読み込みのときに同じ列とみなす見出し(ほかの名簿から取り込めるように)
  const STAFF_EXCEL_FIELDS = [
    { key: "staffNo", header: "職員番号", aliases: ["教職員番号", "職員コード", "教職員コード"] },
    { key: "name", header: "氏名", aliases: ["名前", "氏名(漢字)", "職員名", "教職員名", "教員名"] },
    { key: "kana", header: "ふりがな", aliases: ["フリガナ", "よみがな", "ヨミガナ", "読み仮名", "読みがな", "かな", "カナ", "氏名(ふりがな)", "氏名(フリガナ)", "氏名(かな)"] },
    { key: "jobType", header: "職名", aliases: ["職", "職種", "職位"] },
    { key: "status", header: "状況", aliases: ["在職状況", "在籍", "在籍状況"] },
    { key: "statusDate", header: "異動日", aliases: ["転出日", "退職日", "転出・退職日"] },
    { key: "googleId", header: "Google ID", aliases: ["GoogleID", "Googleアカウント", "メールアドレス", "メール", "Gmail"] },
    { key: "googlePassword", header: "Google パスワード", aliases: ["Google初期パスワード", "初期パスワード", "パスワード"] },
    { key: "deviceNo", header: "端末番号", aliases: ["端末", "端末No", "端末No.", "PC番号", "パソコン番号"] },
    { key: "note", header: "備考", aliases: ["メモ"] },
  ];
  // 姓と名が別の列の名簿のための列(読み込みだけ)
  const STAFF_SPLIT_FIELDS = [
    { key: "sei", header: "姓", aliases: ["氏"] },
    { key: "mei", header: "名" },
    { key: "seiKana", header: "セイ", aliases: ["せい", "姓(ふりがな)", "姓(フリガナ)", "姓ふりがな", "姓フリガナ"] },
    { key: "meiKana", header: "メイ", aliases: ["めい", "名(ふりがな)", "名(フリガナ)", "名ふりがな", "名フリガナ"] },
  ];
  // 「〇〇:ID」「〇〇:パスワード」の見出しは、その他のサービス(全角の「:」でもよい)
  const SERVICE_HEADER_RE = /^(.+?)\s*[:：]\s*(ID|パスワード)$/i;

  /** 状況の欄の文字を「在職」「転出・退職」にする。分からないときは undefined(今のまま) */
  function readStatus(v) {
    if (!v) return undefined;
    if (/転出|退職|離任|転勤|異動済/.test(v)) return "転出・退職";
    if (/在職|在籍|現職|勤務/.test(v)) return "在職";
    return undefined;
  }

  $("btnExportStaffExcel").addEventListener("click", () => {
    if (staff.length === 0) {
      alert("書き出す職員データがありません。");
      return;
    }
    const serviceNames = [...new Set(staff.flatMap((s) => s.otherServices.map((svc) => svc.name)).filter(Boolean))];
    const year = defaultYear();
    const headers = [
      ...STAFF_EXCEL_FIELDS.map((f) => f.header),
      ...serviceNames.flatMap((n) => [`${n}:ID`, `${n}:パスワード`]),
      ...(year ? [`担当(${year}年度)(書き出しのみ)`] : []),
    ];
    const aoa = [headers, ...sortedStaff(staff).map((s) => {
      const svcCells = serviceNames.flatMap((n) => {
        const svc = s.otherServices.find((x) => x.name === n);
        const get = (re) => ((svc && svc.fields.find((f) => re.test(f.label))) || {}).value || "";
        return [get(/^(?!.*(パスワード|password))/i), get(/パスワード|password/i)];
      });
      return [...STAFF_EXCEL_FIELDS.map((f) => s[f.key] || ""), ...svcCells,
        ...(year ? [describeAssignments(assignmentsOf(s, year))] : [])];
    })];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    A.applyTextFormat(ws, aoa.length - 1, headers.length);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "職員一覧");
    XLSX.writeFile(wb, `職員一覧_${A.todayString()}.xlsx`);
  });

  $("btnImportStaffExcel").addEventListener("click", () => $("fileImportStaffExcel").click());

  $("fileImportStaffExcel").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let aoa;
    try {
      aoa = await readFirstSheet(file);
    } catch (err) {
      alert("ファイルを読み込めませんでした。Excel(.xlsx)か CSV のファイルを選んでください。\n" + err.message);
      return;
    }
    const isService = (h) => SERVICE_HEADER_RE.test(h.normalize("NFKC")) || /書き出しのみ/.test(h);
    const map = mapColumns(aoa, [...STAFF_EXCEL_FIELDS, ...STAFF_SPLIT_FIELDS], ["name", "sei"], isService);
    if (!map) {
      alert("氏名の列が見つかりません。\n上から10行の中に、「氏名」(または「名前」「教職員名」、姓と名が別なら「姓」「名」)という見出しの行を入れてから読み込んでください。");
      return;
    }
    const { cols, headers } = map;
    // その他のサービスの列
    const svcCols = {};
    headers.forEach((h, i) => {
      const m = h.normalize("NFKC").match(SERVICE_HEADER_RE);
      if (m) (svcCols[m[1].trim()] = svcCols[m[1].trim()] || {})[/^id$/i.test(m[2]) ? "ID" : "パスワード"] = i;
    });
    let added = 0, updated = 0;
    const plans = [];
    for (const row of aoa.slice(map.headerRow + 1)) {
      const get = (key) => (cols[key] !== undefined ? String(row[cols[key]] ?? "").trim() : undefined);
      let name = (get("name") || "").replace(/　/g, " ").replace(/\s+/g, " ");
      if (!name && cols.sei !== undefined) name = [get("sei"), get("mei")].filter(Boolean).join(" ");
      if (!name) continue;
      const staffNo = get("staffNo") || "";
      const target = (staffNo && staff.find((s) => s.staffNo === staffNo)) || findStaffByName(name);
      const data = {};
      for (const f of STAFF_EXCEL_FIELDS) {
        const v = get(f.key);
        if (v !== undefined) data[f.key] = v;
      }
      // 同じ人で空白の有無だけが違う名前(「見本一郎」と「見本 一郎」)なら、登録済みの書き方のままにする
      if (!(target && nameKey(target.name) === nameKey(name))) data.name = name;
      if (data.kana === undefined && cols.seiKana !== undefined) data.kana = [get("seiKana"), get("meiKana")].filter(Boolean).join(" ");
      if (data.kana !== undefined) data.kana = toHiragana(data.kana).replace(/\s+/g, " ").trim();
      if (data.status !== undefined) {
        const st = readStatus(data.status);
        if (st) data.status = st; else delete data.status;
      }
      // 空の欄で、登録済みの内容を消さない(ほかの名簿にない項目を、空で上書きしないように)
      if (target) for (const k of Object.keys(data)) if (data[k] === "") delete data[k];
      const services = Object.entries(svcCols).map(([svcName, c]) => ({
        name: svcName,
        fields: [
          { label: "ID", value: c.ID !== undefined ? String(row[c.ID] ?? "").trim() : "" },
          { label: "パスワード", value: c["パスワード"] !== undefined ? String(row[c["パスワード"]] ?? "").trim() : "" },
        ],
      })).filter((svc) => svc.fields.some((f) => f.value));
      plans.push({ target, data, services });
      if (target) updated++; else added++;
    }
    if (plans.length === 0) {
      alert("読み込める行がありませんでした(氏名が空の行は読み込みません)。");
      return;
    }
    const svcNames = Object.keys(svcCols);
    const lines = [
      `職員を ${added}人 追加し、${updated}人 を更新します。`,
      "(職員番号、なければ氏名で同じ人を探します。空の欄は、登録済みの内容を消しません)",
      "",
      `読み込む列: ${[...map.used, ...svcNames.map((n) => `${n}(その他のサービス)`)].join("、")}`,
    ];
    if (map.unused.length) lines.push(`読まない列: ${listShort(map.unused)}`);
    lines.push("", "よろしいですか？");
    if (!confirm(lines.join("\n"))) return;
    for (const p of plans) {
      if (p.target) {
        Object.assign(p.target, p.data);
        // Excel にあるサービスだけを書きかえ、ほかのサービスは残す
        for (const svc of p.services) {
          const i = p.target.otherServices.findIndex((x) => x.name === svc.name);
          if (i >= 0) p.target.otherServices[i] = svc; else p.target.otherServices.push(svc);
        }
      } else {
        staff.push(normalizeStaff([{ ...p.data, otherServices: p.services }])[0]);
      }
    }
    save();
    render();
    alert(`読み込みました(追加 ${added}人・更新 ${updated}人)。`);
  });

  // ---------- 役割分担の Excel ----------
  // 形: 1行に担当者1人。「部署・係」「上の部署」「氏名」「役割」の4列。
  //     同じ部署の2人目からは「上の部署」を空にしてよい。担当者のいない部署は「氏名」を空にする。
  //     「氏名」の欄に「主任: 見本 一郎、練習 さくら」「見本 一郎(主任)」のように何人か書いてもよい
  //     (「表(部署ごと)」をそのまま写した表や、ほかの分掌表からも取り込めるように)。
  //     ほかの分掌表のために、次の形も読む:
  //       ・「部署」と「係」が別の列 → 係をその部署の下に作る
  //       ・部署の欄が空(Excel でセルを結合した表など) → すぐ上の行と同じ部署とみなす

  const ORG_EXCEL_FIELDS = [
    { key: "node", header: "部署・係", aliases: ["部署", "部署名", "部署・係名", "分掌", "校務分掌", "分掌名", "組織"] },
    { key: "parent", header: "上の部署", aliases: ["上の部署・係", "上位の部署", "上位部署"] },
    // 「部署」と「係」が別の列の分掌表のための列(読み込みだけ)。係はその行の部署の下に作る
    { key: "sub", header: "係", aliases: ["係名", "担当係"] },
    { key: "name", header: "氏名", aliases: ["名前", "担当者", "担当者名", "職員名", "教員名", "教職員名"] },
    { key: "role", header: "役割", aliases: ["役職", "役", "立場"] },
  ];
  const ORG_EXCEL_EXAMPLE = [
    ["校長", "", "架空 正道", ""],
    ["副校長", "校長", "仮名 恵子", ""],
    ["教務部", "副校長", "見本 一郎", "主任"],
    ["時間割係", "教務部", "例示 真一", ""],
    ["行事係", "教務部", "模擬 花", ""],
    ["第1学年", "副校長", "練習 さくら", "学年主任"],
    ["第1学年", "", "例示 真一", "1組担任"],
    ["事務室", "副校長", "見立 直子", ""],
  ];
  const ORG_EXCEL_NOTES = [
    ["役割分担の読み込みの書き方"],
    [""],
    ["・1行目は見出しです(部署・係/上の部署/氏名/役割)。見出しの名前は変えないでください。"],
    ["・1行に担当者を1人書きます。同じ部署・係に何人かいるときは、行を分けて同じ部署名を書きます。"],
    ["・「上の部署」には、その部署・係がどこの下にあるか(ツリーで上の枠)を書きます。一番上(校長など)は空にします。"],
    ["・同じ部署の2行目からは、「上の部署」を空にしてかまいません。"],
    ["・担当者のいない部署・係は、「氏名」を空にして1行書きます。"],
    ["・「氏名」の欄に「主任: 見本 一郎、練習 さくら」のように、何人かをまとめて書いてもかまいません。"],
    ["・氏名は、職員の一覧と同じ書き方(姓と名の間にスペース)にすると、職員とつながります。つながらない名前も、そのまま載ります。"],
    ["・上から順に、ツリーの左から(表の上から)並びます。"],
  ];

  function orgRows(year) {
    const nodes = nodesOf(year);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const rows = [];
    for (const { node } of walk(nodes)) {
      const parent = node.parentId && byId[node.parentId] ? byId[node.parentId].name : "";
      if (node.members.length === 0) rows.push([node.name, parent, "", ""]);
      node.members.forEach((m) => rows.push([node.name, parent, memberName(m), m.role]));
    }
    return rows;
  }

  function writeOrgWorkbook(rows, fileName, withNotes) {
    const aoa = [ORG_EXCEL_FIELDS.filter((f) => f.key !== "sub").map((f) => f.header), ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    A.applyTextFormat(ws, aoa.length - 1, 4);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "役割分担");
    if (withNotes) {
      const notes = XLSX.utils.aoa_to_sheet(ORG_EXCEL_NOTES);
      notes["!cols"] = [{ wch: 100 }];
      XLSX.utils.book_append_sheet(wb, notes, "書き方");
    }
    XLSX.writeFile(wb, fileName);
  }

  $("btnExportOrgExcel").addEventListener("click", () => {
    if (!orgYear || nodesOf(orgYear).length === 0) {
      alert("書き出す役割分担がありません。");
      return;
    }
    writeOrgWorkbook(orgRows(orgYear), `役割分担_${orgYear}年度_${A.todayString()}.xlsx`, true);
  });

  $("btnImportOrgExcel").addEventListener("click", () => {
    $("orgImportYear").value = orgYear || String(fiscalYear());
    $("orgImportError").hidden = true;
    $("orgImportModal").hidden = false;
  });
  $("btnCancelOrgImport").addEventListener("click", () => { $("orgImportModal").hidden = true; });
  $("btnOrgImportExample").addEventListener("click", () => {
    writeOrgWorkbook(ORG_EXCEL_EXAMPLE, "役割分担_記入例.xlsx", true);
  });
  $("btnOrgImportChoose").addEventListener("click", () => {
    const year = $("orgImportYear").value.trim().normalize("NFKC");
    if (!/^\d{4}$/.test(year)) {
      $("orgImportError").textContent = "年度は西暦の4けた(例: 2027)で入れてください。";
      $("orgImportError").hidden = false;
      return;
    }
    $("orgImportYear").value = year;
    $("fileImportOrgExcel").click();
  });

  /** 「氏名」の欄を担当者の一覧にする。「主任: 見本 一郎、練習 さくら」「見本 一郎(主任)」も読む */
  function parseMemberCell(cell, roleCell) {
    const items = String(cell || "").split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
    return items.map((item) => {
      let name = item, role = "";
      let m = item.match(/^(.+?)\s*[:：]\s*(.+)$/);
      if (m) { role = m[1]; name = m[2]; }
      else if ((m = item.match(/^(.+?)\s*[(（](.+)[)）]$/))) { name = m[1]; role = m[2]; }
      if (!role && items.length === 1) role = roleCell || "";
      return { name: name.replace(/　/g, " ").replace(/\s+/g, " ").trim(), role: role.trim() };
    }).filter((x) => x.name);
  }

  $("fileImportOrgExcel").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const year = $("orgImportYear").value;
    let aoa;
    try {
      aoa = await readFirstSheet(file);
    } catch (err) {
      alert("ファイルを読み込めませんでした。Excel(.xlsx)か CSV のファイルを選んでください。\n" + err.message);
      return;
    }
    const map = mapColumns(aoa, ORG_EXCEL_FIELDS, ["node", "sub"]);
    if (!map) {
      alert("「部署・係」の列が見つかりません。\n1行目に「部署・係」「上の部署」「氏名」「役割」の見出しを入れてください(「記入例を書き出す」で見本の形をもらえます)。");
      return;
    }
    const { cols } = map;
    if (cols.node === undefined) { cols.node = cols.sub; delete cols.sub; }   // 「係」の列だけの表は、係を部署として読む
    const get = (row, key) => (cols[key] !== undefined ? String(row[cols[key]] ?? "").trim() : "");
    // 部署・係を、書いてある順に作る。同じ名前で上の部署も同じ(または空)なら、同じ部署とみなす
    const nodes = [];
    let memberCount = 0;
    const ensureNode = (name, parentName) => {
      let node = nodes.find((n) => n.name === name && (!parentName || n.parentName === parentName));
      if (!node) {
        node = { id: A.generateId(), name, parentName, parentId: null, members: [] };
        nodes.push(node);
      } else if (!node.parentName && parentName) {
        node.parentName = parentName;
      }
      return node;
    };
    let lastDept = "";
    for (const row of aoa.slice(map.headerRow + 1)) {
      let dept = get(row, "node");
      const sub = get(row, "sub");
      const person = get(row, "name");
      if (dept) lastDept = dept;
      else if (sub || person) dept = lastDept;   // 結合したセルなど、部署の欄が空の行は上の行と同じ部署
      if (!dept) continue;
      let node = ensureNode(dept, get(row, "parent"));
      if (sub) node = ensureNode(sub, dept);
      for (const { name: p, role } of parseMemberCell(person, get(row, "role"))) {
        const s = findStaffByName(p);
        const display = s ? s.name : p;
        if (node.members.some((m) => m.name === display && m.role === role)) continue;
        node.members.push({ staffId: s ? s.id : "", name: display, role });
        memberCount++;
      }
    }
    if (nodes.length === 0) {
      alert("読み込める行がありませんでした(「部署・係」が空の行は読み込みません)。");
      return;
    }
    // 上の部署を名前でつなぐ。書いてない部署の名前が出てきたら、一番上に作る
    for (const n of [...nodes]) {
      if (!n.parentName) continue;
      let p = nodes.find((x) => x !== n && x.name === n.parentName);
      if (!p) {
        p = { id: A.generateId(), name: n.parentName, parentName: "", parentId: null, members: [] };
        nodes.push(p);
      }
      n.parentId = p.id;
    }
    // 上の部署が輪になっている(AのうえがB、BのうえがA)ときは、輪を切る(ツリーに出なくなるため)
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      const seen = new Set([n.id]);
      let cur = n;
      while (cur.parentId && byId[cur.parentId]) {
        if (seen.has(cur.parentId)) { cur.parentId = null; break; }
        seen.add(cur.parentId);
        cur = byId[cur.parentId];
      }
    }
    const unknown = [...new Set(nodes.flatMap((n) => n.members.filter((m) => !m.staffId).map((m) => m.name)))];
    const lines = [`${year}年度の役割分担に、部署・係 ${nodes.length}個・担当 ${memberCount}件を読み込みます。`];
    if (org.years[year]) lines.push("", `今の${year}年度の役割分担は、読み込んだ内容にすべて置きかわります(元に戻せません)。`);
    if (cols.parent === undefined && cols.sub === undefined) lines.push("", "「上の部署」の列がないので、すべての部署を一番上に並べます(あとで部署の枠を押して直せます)。");
    if (unknown.length) lines.push("", `職員の一覧にない名前(名前だけで載せます): ${listShort(unknown)}`);
    lines.push("", "よろしいですか？");
    if (!confirm(lines.join("\n"))) return;
    org.years[year] = { nodes: nodes.map(({ parentName, ...n }) => n) };
    orgYear = year;
    save();
    $("orgImportModal").hidden = true;
    renderOrg();
    alert(`${year}年度の役割分担を読み込みました。`);
  });

  // ---------- 役割分担(ツリー・表) ----------

  function renderOrgYearSelect() {
    const sel = $("orgYear");
    const years = yearsDesc();
    if (!years.includes(orgYear)) orgYear = defaultYear();
    sel.innerHTML = years.length
      ? years.map((y) => `<option value="${y}">${y}年度</option>`).join("")
      : `<option value="">(まだありません)</option>`;
    sel.value = orgYear;
  }

  function memberLines(node) {
    return node.members.map((m) => `<div class="org-member">${m.role ? `<span class="org-role">${esc(m.role)}</span>` : ""}${esc(memberName(m))}</div>`).join("");
  }

  function treeNodeHtml(nodes, node, depth) {
    const children = childrenOf(nodes, node.id);
    const allLeaves = children.length > 0 && children.every((c) => childrenOf(nodes, c.id).length === 0);
    const box = (inner) => `<div class="org-box" data-node-id="${node.id}"><div class="org-name">${esc(node.name)}</div>${memberLines(node)}${inner}</div>`;
    // 係だけを持つ部署は、係を枠の中に縦に並べる(学校の組織図は部署の数が多く、横に並べると広がりすぎるため)
    if (depth >= NEST_FROM_DEPTH && allLeaves) {
      const inner = children.map((c) => `<div class="org-box org-sub" data-node-id="${c.id}"><div class="org-name">${esc(c.name)}</div>${memberLines(c)}</div>`).join("");
      return `<li>${box(`<div class="org-subs">${inner}</div>`)}</li>`;
    }
    const sub = children.length ? `<ul>${children.map((c) => treeNodeHtml(nodes, c, depth + 1)).join("")}</ul>` : "";
    return `<li>${box("")}${sub}</li>`;
  }

  function treeHtml(nodes) {
    return `<div class="org-tree"><ul>${rootsOf(nodes).map((r) => treeNodeHtml(nodes, r, 0)).join("")}</ul></div>`;
  }

  function deptTableHtml(nodes) {
    const rows = walk(nodes).map(({ node, depth }) => `<tr data-node-id="${node.id}">
        <td style="padding-left:${10 + depth * 22}px">${depth ? "└ " : ""}${esc(node.name)}</td>
        <td>${node.members.map((m) => esc(m.role ? `${m.role}: ${memberName(m)}` : memberName(m))).join("、")}</td></tr>`).join("");
    return `<table class="doc-table org-table"><thead><tr><th>部署・係</th><th>担当者</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function personTableHtml(year) {
    const list = sortedStaff(staff.filter((s) => s.status === "在職"));
    // 職員の一覧にいない担当者(名前だけで入れた人・削除された職員)も表に出す
    const known = new Set(list.map((s) => s.name));
    const extra = [];
    for (const { node } of walk(nodesOf(year))) {
      for (const m of node.members) {
        const n = memberName(m);
        if (!m.staffId && n && !known.has(n)) { known.add(n); extra.push({ id: "", name: n, jobType: "" }); }
        if (m.staffId) {
          const s = staffById(m.staffId);
          if (s && s.status !== "在職" && !known.has(s.name)) { known.add(s.name); extra.push(s); }
        }
      }
    }
    const rows = [...list, ...extra].map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.jobType)}</td>
        <td>${esc(describeAssignments(assignmentsOf(s, year)))}</td></tr>`).join("");
    return `<table class="doc-table org-table"><thead><tr><th>氏名</th><th>職名</th><th>担当</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderOrg() {
    renderOrgYearSelect();
    for (const [id, mode] of [["orgShowTree", "tree"], ["orgShowTable", "table"], ["orgShowPerson", "person"]]) {
      $(id).classList.toggle("active", orgViewMode === mode);
    }
    const content = $("orgContent");
    if (!orgYear) {
      content.innerHTML = `<p class="empty-message">まだ役割分担がありません。${A.isEditMode() ? "「新しい年度を作る」を押して始めてください。" : "「編集する」を押してから「新しい年度を作る」で始めてください。"}</p>`;
      return;
    }
    const nodes = nodesOf(orgYear);
    if (orgViewMode === "person") content.innerHTML = personTableHtml(orgYear);
    else if (nodes.length === 0) content.innerHTML = `<p class="empty-message">${esc(orgYear)}年度の部署がありません。${A.isEditMode() ? "「+ 一番上に部署を追加」で始めてください。" : ""}</p>`;
    else content.innerHTML = orgViewMode === "table" ? deptTableHtml(nodes) : treeHtml(nodes);
  }

  function setOrgView(mode) {
    orgViewMode = mode;
    safeSet(ORG_VIEW_KEY, mode);
    renderOrg();
  }

  $("orgShowTree").addEventListener("click", () => setOrgView("tree"));
  $("orgShowTable").addEventListener("click", () => setOrgView("table"));
  $("orgShowPerson").addEventListener("click", () => setOrgView("person"));
  $("orgYear").addEventListener("change", () => { orgYear = $("orgYear").value; renderOrg(); });

  // 部署の枠(表では行)を押すと、編集画面を開く(編集中だけ)
  $("orgContent").addEventListener("click", (e) => {
    const el = e.target.closest("[data-node-id]");
    if (!el || !A.isEditMode()) return;
    const node = nodesOf(orgYear).find((n) => n.id === el.dataset.nodeId);
    if (node) openNodeModal(node, null);
  });

  $("btnPrintOrg").addEventListener("click", () => {
    if (!orgYear) return;
    const label = { tree: "ツリー", table: "部署ごと", person: "職員ごと" }[orgViewMode];
    const title = `役割分担_${orgYear}年度_${label}`;
    const head = `<h1 class="doc-title">${esc(orgYear)}年度 役割分担</h1><p class="doc-sub">${esc(A.sheetOptions().headerText)}　${esc(A.todayString())} 現在</p>`;
    if (orgViewMode === "tree") {
      // ツリーは横に広いので A3 の横向き。入りきらないときは全体を縮める(A3横の印刷できる幅は約 1500px)
      const tree = $("orgContent").querySelector(".org-tree");
      const width = tree ? tree.scrollWidth : 0;
      const zoom = width > 1500 ? 1500 / width : 1;
      A.printDocument(`${head}<div style="zoom:${zoom}">${$("orgContent").innerHTML}</div>`, title, "A3 landscape");
    } else {
      A.printDocument(head + $("orgContent").innerHTML, title, "A4 portrait");
    }
  });

  // ---------- 部署・係の編集 ----------

  let editingNode = null;   // 直している部署(新しく作るときは null)
  let newNodeParent = null; // 新しく作るときの上の部署

  function addMemberRow(m) {
    const row = document.createElement("div");
    row.className = "org-member-row";
    row.innerHTML = `
      <input type="text" class="m-name" list="orgStaffNames" placeholder="氏名">
      <input type="text" class="m-role" list="orgRoleList" placeholder="役割(例: 主任)">
      <button type="button" class="btn btn-small m-up" title="上へ">↑</button>
      <button type="button" class="btn btn-small btn-danger m-remove" title="この人を外す">✕</button>`;
    row.querySelector(".m-name").value = m ? memberName(m) : "";
    row.querySelector(".m-role").value = m ? m.role : "";
    row.querySelector(".m-remove").addEventListener("click", () => row.remove());
    row.querySelector(".m-up").addEventListener("click", () => {
      if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    });
    $("orgNodeMembers").appendChild(row);
  }

  /** node … 直す部署(null なら新しく作る)、parentId … 新しく作るときの上の部署 */
  function openNodeModal(node, parentId) {
    editingNode = node;
    newNodeParent = parentId;
    const nodes = nodesOf(orgYear);
    $("orgNodeTitle").textContent = node ? "部署・係を直す" : "部署・係を追加";
    $("orgNodeName").value = node ? node.name : "";
    // 上の部署の候補(自分と、自分より下の部署は選べない)
    const banned = new Set();
    if (node) {
      const mark = (id) => { banned.add(id); for (const c of childrenOf(nodes, id)) mark(c.id); };
      mark(node.id);
    }
    const current = node ? (node.parentId || "") : (parentId || "");
    $("orgNodeParent").innerHTML = `<option value="">(なし: 一番上)</option>`
      + walk(nodes).filter(({ node: n }) => !banned.has(n.id))
        .map(({ node: n, depth }) => `<option value="${n.id}">${"　".repeat(depth)}${esc(n.name)}</option>`).join("");
    $("orgNodeParent").value = current;
    $("orgNodeMembers").innerHTML = "";
    for (const m of (node ? node.members : [])) addMemberRow(m);
    if (!node) addMemberRow(null);
    $("orgStaffNames").innerHTML = sortedStaff(staff.filter((s) => s.status === "在職"))
      .map((s) => `<option value="${esc(s.name)}">${esc(s.jobType)}</option>`).join("");
    for (const id of ["btnDeleteOrgNode", "btnOrgNodeUp", "btnOrgNodeDown", "btnAddOrgChild"]) $(id).hidden = !node;
    $("orgNodeError").hidden = true;
    $("orgNodeModal").hidden = false;
    $("orgNodeName").focus();
  }

  /** 画面の入力を部署に入れる。問題があればその説明を返す */
  function applyNodeForm() {
    const name = $("orgNodeName").value.trim();
    if (!name) return "部署・係の名前を入れてください。";
    const members = Array.from($("orgNodeMembers").querySelectorAll(".org-member-row"))
      .map((row) => {
        const n = row.querySelector(".m-name").value.trim().replace(/　/g, " ");
        const role = row.querySelector(".m-role").value.trim();
        // 職員の一覧にいる名前なら職員とつなぐ。いなければ名前だけで残す(外部の方など)
        const s = staff.find((x) => x.name === n && x.status === "在職") || staff.find((x) => x.name === n);
        return { staffId: s ? s.id : "", name: n, role };
      })
      .filter((m) => m.name);
    const nodes = nodesOf(orgYear);
    if (editingNode) {
      editingNode.name = name;
      editingNode.parentId = $("orgNodeParent").value || null;
      editingNode.members = members;
    } else {
      editingNode = { id: A.generateId(), name, parentId: $("orgNodeParent").value || null, members };
      nodes.push(editingNode);
    }
    return "";
  }

  $("btnAddOrgMember").addEventListener("click", () => addMemberRow(null));
  $("btnCancelOrgNode").addEventListener("click", () => { $("orgNodeModal").hidden = true; });

  $("btnSaveOrgNode").addEventListener("click", () => {
    const error = applyNodeForm();
    if (error) {
      $("orgNodeError").textContent = error;
      $("orgNodeError").hidden = false;
      return;
    }
    save();
    $("orgNodeModal").hidden = true;
    renderOrg();
  });

  // 「下に部署を追加」: 今の入力を保存してから、この部署の下に新しい部署を作る
  $("btnAddOrgChild").addEventListener("click", () => {
    const error = applyNodeForm();
    if (error) {
      $("orgNodeError").textContent = error;
      $("orgNodeError").hidden = false;
      return;
    }
    save();
    renderOrg();
    openNodeModal(null, editingNode.id);
  });

  /** 同じ上の部署の中で、順番を1つ前(-1)・後ろ(+1)にずらす */
  function moveNode(delta) {
    const nodes = nodesOf(orgYear);
    const siblings = childrenOf(nodes, editingNode.parentId || null);
    const i = siblings.indexOf(editingNode);
    const other = siblings[i + delta];
    if (!other) return;
    const a = nodes.indexOf(editingNode), b = nodes.indexOf(other);
    [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
    save();
    renderOrg();
  }
  $("btnOrgNodeUp").addEventListener("click", () => moveNode(-1));
  $("btnOrgNodeDown").addEventListener("click", () => moveNode(1));

  $("btnDeleteOrgNode").addEventListener("click", () => {
    const nodes = nodesOf(orgYear);
    const ids = new Set();
    const mark = (id) => { ids.add(id); for (const c of childrenOf(nodes, id)) mark(c.id); };
    mark(editingNode.id);
    const more = ids.size > 1 ? `\n下にある ${ids.size - 1} 個の部署・係も一緒に削除されます。` : "";
    if (!confirm(`「${editingNode.name}」を削除しますか？${more}\n削除すると元に戻せません。`)) return;
    org.years[orgYear].nodes = nodes.filter((n) => !ids.has(n.id));
    save();
    $("orgNodeModal").hidden = true;
    renderOrg();
  });

  $("btnAddOrgTop").addEventListener("click", () => {
    if (!orgYear) {
      alert("先に「新しい年度を作る」で年度を作ってください。");
      return;
    }
    openNodeModal(null, null);
  });

  // ---------- 年度を作る・削除する ----------

  $("btnNewOrgYear").addEventListener("click", () => {
    const years = yearsDesc();
    const next = years.length ? Math.max(Number(years[0]) + 1, fiscalYear()) : fiscalYear();
    $("orgNewYear").value = String(years.includes(String(fiscalYear())) ? next : fiscalYear());
    $("orgCopyFrom").innerHTML = years.map((y) => `<option value="${y}">${y}年度を写して作る</option>`).join("")
      + `<option value="">空の状態から作る</option>`;
    $("orgCopyFrom").value = years[0] || "";
    $("orgYearError").hidden = true;
    $("orgYearModal").hidden = false;
  });
  $("btnCancelOrgYear").addEventListener("click", () => { $("orgYearModal").hidden = true; });

  $("btnDoNewOrgYear").addEventListener("click", () => {
    const year = $("orgNewYear").value.trim();
    const showError = (t) => { $("orgYearError").textContent = t; $("orgYearError").hidden = false; };
    if (!/^\d{4}$/.test(year)) return showError("年度は西暦の4けた(例: 2027)で入れてください。");
    if (org.years[year]) return showError(`${year}年度はもうあります。上の「年度」で選んでください。`);
    const from = $("orgCopyFrom").value;
    let removed = 0;
    const nodes = from ? JSON.parse(JSON.stringify(nodesOf(from))) : [];
    // 転出・退職した職員は、新しい年度の担当から外す(異動した先生の名前が残らないように)
    for (const n of nodes) {
      const before = n.members.length;
      n.members = n.members.filter((m) => { const s = m.staffId && staffById(m.staffId); return !s || s.status === "在職"; });
      removed += before - n.members.length;
    }
    org.years[year] = { nodes };
    orgYear = year;
    save();
    $("orgYearModal").hidden = true;
    renderOrg();
    if (removed) alert(`転出・退職した職員を、担当から ${removed} 件外しました。新しく来た先生を担当に入れてください。`);
  });

  $("btnDeleteOrgYear").addEventListener("click", () => {
    if (!orgYear) return;
    if (!confirm(`${orgYear}年度の役割分担をすべて削除しますか？\n削除すると元に戻せません(必要なら先にバックアップを取ってください)。`)) return;
    delete org.years[orgYear];
    orgYear = defaultYear();
    save();
    renderOrg();
  });

  // ---------- 起動時 ----------

  $("orgRoleList").innerHTML = ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}">`).join("");
  $("staffJobList").innerHTML = JOB_TYPES.map((j) => `<option value="${esc(j)}">`).join("");
  orgViewMode = ["tree", "table", "person"].includes(safeGet(ORG_VIEW_KEY)) ? safeGet(ORG_VIEW_KEY) : "tree";

  window.AccountManagerStaff = { load, collect, render, showTab };
  // app.js がすでにデータを読み込んでいたとき(staff.js より先に開いた場合)に備え、今の状態で始める
  showTab(safeGet(TAB_KEY) || "students");
})();
