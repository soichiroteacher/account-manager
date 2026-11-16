// 画面ガイド(はじめての人向けの使い方の案内)。画面の部品を1つずつ枠で囲んで説明する。
// 画面のボタンの名前や位置を変えたら、ここの説明も同時に直すこと(共通ルール)。
// 作りは時間割ツール(timetable/js/guide.js)の画面ガイドとそろえている。
(function () {
  "use strict";

  // tab … その画面(students・staff・org)に切り替えてから説明する。sel … 囲む部品。見つからない・表示されていない部品のときは、枠を出さずに説明だけを画面の上の方に出す。
  const GUIDE_STEPS = [
    { sel: "#modeBadge", title: "今の状態(閲覧のみ・編集中)",
      text: "開いた直後は「閲覧のみ」です。名簿を見る・検索する・印刷する・書き出すことができます。名簿を直しているときは「編集中」になります。" },
    { sel: "#btnToggleEdit", title: "直すときは「編集する」",
      text: "名簿を直すときはここを押します。名前を聞かれるので、自分の名前を入れて「OK」を押します(前回の名前が入っています。空のままでは始められません)。ほかの先生の画面には「○○先生が編集中」と出ます。変更は自動で保存されます。終わったら同じボタン(「編集を終える」になります)を押します。" },
    { sel: "#btnEditLog", title: "編集の記録",
      text: "だれが・いつ編集したかの一覧を見られます(新しい順。何を変えたかは記録しません)。見本には、架空の記録が入っています。" },
    { sel: "#mainTabs", title: "画面の切り替え(生徒・職員・役割分担)",
      text: "「生徒」は生徒の名簿とアカウント、「職員」は先生方の名簿とアカウント、「役割分担」は年度ごとの校務分掌(ツリーと表)です。ここを押して切り替えます。データは1つのファイルにまとめて保存されます。" },
    { tab: "students", sel: "#statusFilter", title: "表示する生徒を選ぶ",
      text: "在籍中の生徒・転出や卒業した生徒のほか、「端末が未配布」「故障・修理・交換の記録がある」「名前・写真の掲載が不可」などで絞り込めます。学年だよりを作るときは「掲載不可」を選ぶと、載せてはいけない生徒だけが出ます。" },
    { tab: "students", sel: "#searchBox", title: "検索",
      text: "氏名・ふりがな・クラス・出席番号・学籍番号・ID・端末番号(以前の番号も)で探せます。" },
    { tab: "students", sel: "#studentTable", title: "名簿の一覧",
      text: "1行が1人の生徒です。「詳細」(編集中は「編集」)でアカウント・端末・掲載の可否・備考を見たり直したりします。「シート印刷」で、その生徒に配るアカウントシートを印刷します。名前の横の印は、外字や「掲載不可あり」などのお知らせです。" },
    { tab: "students", sel: "#btnAddStudent", title: "生徒を追加(編集中だけ)",
      text: "生徒を1人ずつ登録します。氏名は姓と名の間にスペースを入れてください。たくさん登録するときは、Excel から読み込むほうが早くできます。" },
    { tab: "students", sel: "#menuSheet", title: "アカウントシート",
      text: "「全員分のシートを印刷」で、一覧に出ている生徒全員のシート(B5・1人1枚)を印刷します。印刷画面の「送信先」で「PDFに保存」を選ぶと、PDFにもなります。学校名や文言は「シートの設定」(編集中だけ)で変えます。" },
    { tab: "students", sel: "#menuExcel", title: "Excel・CSV",
      text: "名簿を Excel に書き出したり、Excel から読み込んでまとめて登録・更新したりします。Google のアカウントを一括登録するための CSV もここで作ります。" },
    { tab: "students", sel: "#menuBulk", title: "まとめて処理(編集中だけ)",
      text: "パスワードをまとめて作る「パスワード一括生成」と、卒業・進級の「年度更新」があります。年度更新の前には、必ずバックアップを取ってください。" },
    { sel: "#menuBackup", title: "バックアップ",
      text: "「データを書き出す(バックアップ)」で、今の名簿を日付入りのファイルに控えておけます。間違えて消したときは「データを読み込む(復元)」(編集中だけ)で元に戻せます。" },
    { tab: "staff", sel: "#staffView .view-actions", title: "職員の画面",
      text: "先生方の名簿です。編集中は「職員を追加」か「Excel読み込み」で登録します(ほかの名簿の Excel や CSV もそのまま読めます)。「アカウントシートを印刷」で職員用のシート、「回覧用の名簿を印刷」で氏名・職名・担当と確認の欄が付いた表(A4)を印刷します。" },
    { tab: "staff", sel: "#staffTable", title: "職員の一覧",
      text: "職名の順に並びます。「担当」の列は、今年度の役割分担から自動で出ます。「詳細」(編集中は「編集」)で、Google などのアカウント・端末・備考を見たり直したりします。異動した先生は、削除せずに「状況」を「転出・退職」にすると、過去の役割分担とつながったまま残せます。" },
    { tab: "org", sel: "#orgView .view-actions", title: "役割分担: 年度と見せ方",
      text: "年度を選び、「ツリー」(指示系統の図)・「表(部署ごと)」・「表(職員ごと)」を切り替えます。「印刷」で、今見ている形のまま印刷します(ツリーは A3 横、表は A4 縦)。「Excel書き出し」で表にでき、編集中は「Excel読み込み」で Excel の分掌表から1年度分を作れます。「新しい年度を作る」では、前の年度を写して新しい年度を作れます。" },
    { tab: "org", sel: "#orgContent", title: "役割分担のツリー",
      text: "編集中は、部署・係の枠を押すと、名前・上の部署・担当者・並び順を直せます。係だけを持つ部署は、係を枠の中に縦に並べます。過去の年度を選ぶと、その年の担当者が分かります。" },
    { sel: "#btnSettings", title: "設定",
      text: "編集するときの名前、自動で編集を終えるまでの時間、名前・写真の掲載で確認する項目などを変えます。" },
    { sel: "#btnHelp", title: "使い方と、この案内",
      text: "くわしい使い方は、ここを押すといつでも見られます。この画面ガイドも、使い方の画面の一番上から何度でも見られます。" },
    { sel: "#sampleBanner", title: "見本を終える",
      text: "見本で試している間は、ここに紫色の帯が出ます。何を変えても本物の名簿は変わりません。終わるときは「見本を終える」を押します。" },
  ];

  const $ = (id) => document.getElementById(id);
  let guideIdx = -1;

  /** 部品が画面に表示されているか(編集中だけのボタンなどは、閲覧中は隠れている) */
  function isShown(el) {
    return Boolean(el) && el.getClientRects().length > 0;
  }

  function startGuide() {
    $("helpModal").hidden = true;
    // 生徒の画面から案内する(職員・役割分担の画面にいても、生徒の画面に戻す)
    if (window.AccountManagerStaff) window.AccountManagerStaff.showTab("students");
    // 名簿の画面でないと部品がないので、ファイルを開いていなければ見本を開いてから始める
    if ($("appRoot").hidden) {
      $("btnTrySample").click();
    }
    // 開いているメニューは閉じておく(枠の位置がずれるため)
    for (const menu of document.querySelectorAll(".header-actions details")) menu.open = false;
    guideIdx = 0;
    showGuideStep();
  }

  function endGuide() {
    guideIdx = -1;
    $("guide").hidden = true;
  }

  function showGuideStep() {
    const st = GUIDE_STEPS[guideIdx];
    if (!st) {
      endGuide();
      return;
    }
    // 別の画面(職員・役割分担)の部品を説明するときは、その画面に切り替える
    if (st.tab && window.AccountManagerStaff) window.AccountManagerStaff.showTab(st.tab);
    const el = document.querySelector(st.sel);
    const box = $("gBox");
    const bub = $("gBubble");
    const dim = $("gDim");
    $("guide").hidden = false;
    $("gTitle").textContent = `${guideIdx + 1} / ${GUIDE_STEPS.length}　${st.title}`;
    $("gText").textContent = st.text;
    $("gPrev").disabled = guideIdx === 0;
    $("gNext").textContent = guideIdx === GUIDE_STEPS.length - 1 ? "終わる" : "次へ";
    const bw = Math.min(460, window.innerWidth - 20);
    bub.style.width = `${bw}px`;

    if (!isShown(el)) {
      // 閲覧中に「編集中だけ」の部品を説明するときなど。枠は出さず、説明だけを出す。
      box.hidden = true;
      dim.style.clipPath = "";
      bub.style.left = `${Math.max(10, (window.innerWidth - bw) / 2)}px`;
      bub.style.top = "120px";
      return;
    }
    // 表などの大きな部品は、上の端が見えるように置く(真ん中に合わせると、見出しが画面の外に出てしまうため)
    el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.5 ? "start" : "center", inline: "nearest" });
    // scrollIntoView のすぐ後でも位置は正しく取れるので、そのまま計算する
    // (requestAnimationFrame を使うと、ウィンドウが裏にあるときに動かないことがあるため)
    const r = el.getBoundingClientRect();
    // 大きすぎる部品(表など)は、見えている範囲だけを囲む
    const top = Math.max(r.top, 4);
    const bottom = Math.min(r.bottom, window.innerHeight - 4);
    const left = Math.max(r.left, 4);
    const right = Math.min(r.right, window.innerWidth - 4);
    const x1 = left - 6, y1 = top - 6, x2 = right + 6, y2 = bottom + 6;
    box.hidden = false;
    Object.assign(box.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
    // 囲んだところだけ暗くしない(暗い幕に穴をあける)
    dim.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px)`;
    const bh = bub.offsetHeight || 170;
    const bubLeft = Math.max(10, Math.min(left, window.innerWidth - bw - 10));
    if (y2 + 10 + bh < window.innerHeight) {
      bub.style.top = `${y2 + 10}px`;
      bub.style.left = `${bubLeft}px`;
    } else if (y1 - 10 - bh > 0) {
      bub.style.top = `${y1 - 10 - bh}px`;
      bub.style.left = `${bubLeft}px`;
    } else {
      // 上にも下にも入らないときは、右下の角に
      bub.style.top = `${window.innerHeight - bh - 16}px`;
      bub.style.left = `${window.innerWidth - bw - 24}px`;
    }
  }

  for (const id of ["btnStartGuide", "btnStartGuideHelp"]) {
    $(id).addEventListener("click", startGuide);
  }
  $("gNext").addEventListener("click", () => { guideIdx++; showGuideStep(); });
  $("gPrev").addEventListener("click", () => { if (guideIdx > 0) { guideIdx--; showGuideStep(); } });
  $("gClose").addEventListener("click", endGuide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && guideIdx >= 0) endGuide();
  });
  window.addEventListener("resize", () => { if (guideIdx >= 0) showGuideStep(); });
})();
