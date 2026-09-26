(function () {
  "use strict";

  const VIEWER_CSS = `
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; font-family: "Yu Gothic", "Meiryo", "Hiragino Kaku Gothic ProN", sans-serif; background: #f5f6f8; color: #1f2328; }
    button { font: inherit; cursor: pointer; }
    .lock { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .lock-box { width: 100%; max-width: 420px; background: #fff; border: 1px solid #dcdfe4; border-radius: 10px; padding: 28px; }
    .lock-box h1 { font-size: 1.3rem; margin: 4px 0 6px; }
    .school { margin: 0; color: #4b5563; font-size: 0.9rem; }
    .meta { color: #6b7280; font-size: 0.85rem; }
    .lock-box form { display: flex; gap: 8px; margin: 18px 0 8px; }
    .lock-box input { flex: 1; padding: 9px 10px; border: 1px solid #dcdfe4; border-radius: 6px; font-size: 1rem; }
    .primary { padding: 9px 16px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; }
    .primary:disabled { opacity: 0.6; cursor: wait; }
    .error { color: #b91c1c; font-size: 0.9rem; margin: 6px 0; }
    .note { color: #6b7280; font-size: 0.8rem; line-height: 1.6; margin-top: 16px; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 20px; background: #fff; border-bottom: 1px solid #dcdfe4; }
    header strong { font-size: 1.1rem; margin-right: 8px; }
    .btn { padding: 6px 12px; border: 1px solid #dcdfe4; border-radius: 6px; background: #fff; }
    .warn { margin: 12px 20px; padding: 8px 12px; border: 1px solid #f59e0b; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 0.85rem; }
    .toolbar { display: flex; gap: 8px; margin: 0 20px 12px; }
    .toolbar select, .toolbar input { padding: 7px 9px; border: 1px solid #dcdfe4; border-radius: 6px; font-size: 0.95rem; }
    .toolbar input { flex: 1; max-width: 360px; }
    .table-wrap { margin: 0 20px 40px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dcdfe4; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #dcdfe4; text-align: left; font-size: 0.9rem; white-space: nowrap; vertical-align: top; }
    th { background: #f0f2f5; color: #6b7280; }
    .code { font-family: Consolas, Menlo, monospace; }
    .secret-toggle { margin-left: 6px; padding: 1px 8px; border: 1px solid #dcdfe4; border-radius: 4px; background: #fff; font-size: 0.8rem; }
    .detail td { background: #fafbfc; }
    .detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
    .detail dt { color: #6b7280; }
    .detail dd { margin: 0; }
    .status { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; background: #e5e7eb; color: #374151; font-size: 0.75rem; }
    .empty { text-align: center; color: #6b7280; padding: 30px; }
  `;

  const VIEWER_BODY = `
    <div id="lock" class="lock">
      <div class="lock-box">
        <p class="school" id="lockSchool"></p>
        <h1>アカウント名簿(閲覧用)</h1>
        <p class="meta" id="lockMeta"></p>
        <form id="lockForm">
          <input type="password" id="lockPassword" placeholder="パスワード" autocomplete="off" autofocus>
          <button type="submit" class="primary" id="lockSubmit">開く</button>
        </form>
        <p class="error" id="lockError" hidden></p>
        <p class="note">このファイルには生徒の個人情報が含まれています。パスワードを他の人に教えたり、ファイルを校外に持ち出したりしないでください。</p>
      </div>
    </div>
    <div id="app" hidden>
      <header>
        <div><strong>アカウント名簿(閲覧用)</strong><span class="meta" id="appMeta"></span></div>
        <button type="button" class="btn" id="btnLock">閉じる(ロック)</button>
      </header>
      <p class="warn">個人情報です。画面を開いたまま席を離れないでください。10分間操作がないと自動でロックされます。</p>
      <div class="toolbar">
        <select id="classFilter"></select>
        <input type="search" id="search" placeholder="氏名・学籍番号・IDで検索">
      </div>
      <div class="table-wrap">
        <table>
          <thead id="head"></thead>
          <tbody id="rows"></tbody>
        </table>
        <p class="empty" id="empty" hidden>該当する生徒がいません。</p>
      </div>
    </div>
  `;

  // Runs inside the exported file; it must not reference anything outside its own body.
  function viewerMain(envelope, meta) {
    const IDLE_LOCK_MS = 10 * 60 * 1000;
    const MASK = "••••••";
    const $ = (id) => document.getElementById(id);
    let students = null;
    let lastActivity = Date.now();

    function el(tag, props, children) {
      const node = document.createElement(tag);
      Object.assign(node, props || {});
      for (const child of children || []) node.append(child);
      return node;
    }

    function fromBase64(text) {
      const binary = atob(text);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    async function decrypt(password) {
      const baseKey = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: fromBase64(envelope.salt), iterations: envelope.iter, hash: "SHA-256" },
        baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
      );
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data));
      return JSON.parse(new TextDecoder().decode(plain));
    }

    function secretCell(value) {
      const text = el("span", { className: "code", textContent: MASK });
      const btn = el("button", { type: "button", className: "secret-toggle", textContent: "表示" });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const shown = text.textContent !== MASK;
        text.textContent = shown ? MASK : value;
        btn.textContent = shown ? "表示" : "隠す";
      });
      return value ? [text, btn] : ["-"];
    }

    function valueNodes(field) {
      return field.secret ? secretCell(field.value) : [el("span", { className: field.code ? "code" : "", textContent: field.value || "-" })];
    }

    function renderHead() {
      const cols = ["クラス", "番号", "学籍番号", "氏名", "Google ID"];
      if (students.includePasswords) cols.push("Googleパスワード");
      cols.push("端末番号", "");
      $("head").replaceChildren(el("tr", {}, cols.map((c) => el("th", { textContent: c }))));
    }

    function render() {
      const query = $("search").value.trim().toLowerCase();
      const cls = $("classFilter").value;
      const list = students.list.filter((s) =>
        (!cls || s.className === cls)
        && (!query || [s.name, s.studentNo, s.googleId, s.className].join(" ").toLowerCase().includes(query)));
      const rows = [];
      for (const s of list) {
        const nameCell = el("td", {}, [s.name]);
        if (s.status) nameCell.append(el("span", { className: "status", textContent: s.status }));
        const cells = [
          el("td", { textContent: s.className }),
          el("td", { textContent: s.number }),
          el("td", { textContent: s.studentNo || "" }),
          nameCell,
          el("td", { className: "code", textContent: s.googleId || "" }),
        ];
        if (students.includePasswords) cells.push(el("td", {}, secretCell(s.googlePassword)));
        cells.push(el("td", { textContent: s.deviceNo || "" }));
        const detailBtn = el("button", { type: "button", className: "btn", textContent: "詳細" });
        cells.push(el("td", {}, [detailBtn]));
        const row = el("tr", {}, cells);

        const items = [];
        for (const f of s.details) {
          items.push(el("dt", { textContent: f.label }), el("dd", {}, valueNodes(f)));
        }
        const detail = el("tr", { className: "detail", hidden: true }, [
          el("td", { colSpan: cells.length }, [items.length ? el("dl", {}, items) : "登録されている項目はありません。"]),
        ]);
        detailBtn.addEventListener("click", () => { detail.hidden = !detail.hidden; });
        rows.push(row, detail);
      }
      $("rows").replaceChildren(...rows);
      $("empty").hidden = list.length > 0;
    }

    function lock() {
      students = null;
      $("rows").replaceChildren();
      $("head").replaceChildren();
      $("search").value = "";
      $("app").hidden = true;
      $("lock").hidden = false;
      $("lockPassword").value = "";
      $("lockPassword").focus();
    }

    $("lockSchool").textContent = meta.schoolName || "";
    $("lockMeta").textContent = `作成日時: ${meta.generatedAt}`;
    $("appMeta").textContent = `${meta.schoolName ? meta.schoolName + " / " : ""}作成日時: ${meta.generatedAt}`;

    $("lockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const error = $("lockError");
      error.hidden = true;
      if (!window.crypto || !crypto.subtle) {
        error.textContent = "このブラウザ(開き方)では復号できません。ファイルをPCに保存してから、Chrome または Edge で開いてください。";
        error.hidden = false;
        return;
      }
      $("lockSubmit").disabled = true;
      try {
        students = await decrypt($("lockPassword").value);
      } catch (err) {
        error.textContent = "パスワードが違います。";
        error.hidden = false;
        return;
      } finally {
        $("lockSubmit").disabled = false;
      }
      const classes = Array.from(new Set(students.list.map((s) => s.className))).sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
      $("classFilter").replaceChildren(
        el("option", { value: "", textContent: "すべてのクラス" }),
        ...classes.map((c) => el("option", { value: c, textContent: c }))
      );
      lastActivity = Date.now();
      renderHead();
      render();
      $("lock").hidden = true;
      $("app").hidden = false;
    });

    $("search").addEventListener("input", render);
    $("classFilter").addEventListener("change", render);
    $("btnLock").addEventListener("click", lock);

    for (const type of ["mousemove", "keydown", "click", "scroll", "touchstart"]) {
      document.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true });
    }
    setInterval(() => {
      if (students && Date.now() - lastActivity > IDLE_LOCK_MS) lock();
    }, 15000);
  }

  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  }

  function buildViewerHtml(envelope, meta) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>アカウント名簿(閲覧用)</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
${VIEWER_BODY}
<script>
(${viewerMain.toString()})(${jsonForScript(envelope)}, ${jsonForScript(meta)});
</script>
</body>
</html>
`;
  }

  window.buildViewerHtml = buildViewerHtml;
})();
