// 横に長い表・図のスクロールを使いやすくする(全アプリ共通のルール「UI のルール」による)。
//  1. 枠の上にも横スクロールバーを付け、下のスクロールバーと連動させる
//     (表の一番下まで縦にスクロールしないと横に動かせない、ということがないように)。
//  2. 枠の高さを画面に収まるようにし、枠の中で縦にも横にもスクロールさせる。
//     こうすると、列の見出し・左端の列を CSS の position: sticky で固定できる(style.css の「表の見出しの固定」)。
// 対象は class="scroll-x" を付けた枠。中身(表やツリー)を書きかえても、自動で合わせ直す。
// 印刷には関係しない(印刷は別の領域 #printArea に作るため。念のため印刷用の CSS でも固定を外している)。
(function () {
  "use strict";

  const MIN_HEIGHT = 320;  // 枠の高さの最小(画面が小さくても、表が見えなくならないように)
  const BOTTOM_GAP = 16;   // 画面の下とのすきま

  function setup(wrap) {
    // 上のスクロールバー: 表と同じ幅の空の中身を持つ枠を、表の上に置く
    const bar = document.createElement("div");
    bar.className = "scroll-x-top";
    bar.setAttribute("aria-hidden", "true");
    const inner = document.createElement("div");
    bar.appendChild(inner);
    wrap.parentNode.insertBefore(bar, wrap);

    // 片方を動かしたら、もう片方を同じ位置にする(値が同じなら書きかえないので、行ったり来たりしない)
    bar.addEventListener("scroll", () => {
      if (wrap.scrollLeft !== bar.scrollLeft) wrap.scrollLeft = bar.scrollLeft;
    });
    wrap.addEventListener("scroll", () => {
      if (bar.scrollLeft !== wrap.scrollLeft) bar.scrollLeft = wrap.scrollLeft;
    });

    function refresh() {
      if (!wrap.offsetParent) return; // 隠れている画面(ほかのタブ)では何もしない
      // 枠の高さ: 画面の下までに収める(ページの一番上から見た枠の位置で計算)
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      wrap.style.maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - top - BOTTOM_GAP) + "px";
      inner.style.width = wrap.scrollWidth + "px";
      bar.hidden = wrap.scrollWidth <= wrap.clientWidth + 1;
      bar.scrollLeft = wrap.scrollLeft;
    }

    // 表の幅が変わったとき(行の追加・絞り込み・画面の切り替え・画面の大きさ)に合わせ直す
    const ro = new ResizeObserver(refresh);
    ro.observe(wrap);
    new MutationObserver(() => {
      for (const child of wrap.children) ro.observe(child);
      refresh();
    }).observe(wrap, { childList: true, subtree: true });
    for (const child of wrap.children) ro.observe(child);
    window.addEventListener("resize", refresh);
    refresh();
    return refresh;
  }

  const refreshers = Array.from(document.querySelectorAll(".scroll-x")).map(setup);
  // 画面(生徒・職員・役割分担)を切り替えたり、上の部分の高さが変わったりしたときにも合わせ直す
  const refreshAll = () => refreshers.forEach((f) => f());
  new ResizeObserver(refreshAll).observe(document.body);
  window.TableScroll = { refreshAll };
})();
