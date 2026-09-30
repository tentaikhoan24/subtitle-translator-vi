// ============================================================
//  SUBTITLE TRANSLATOR VI — content.js
//  Phát hiện & dịch phụ đề sang tiếng Việt
// ============================================================

(function () {
  "use strict";

  // ── Cấu hình mặc định ────────────────────────────────────
  let config = {
    enabled: true,
    targetLang: "vi",
    fontSize: "16",
    bgOpacity: "85",
    showOriginal: true,
    boxPosition: "bottom", // bottom | top (bị ghi đè nếu có customPos)
    customPos: null, // { x, y } — tỉ lệ 0..1 so với player (x = tâm, y = mép trên)
  };

  // Tải cấu hình đã lưu
  chrome.storage.sync.get(config, (saved) => {
    config = { ...config, ...saved };
    updateBoxStyle();
  });
  chrome.storage.onChanged.addListener((changes) => {
    for (const [k, v] of Object.entries(changes)) config[k] = v.newValue;
    updateBoxStyle();
  });

  // ── Cache dịch ───────────────────────────────────────────
  const cache = new Map();

  // ── Danh sách selector phụ đề ────────────────────────────
  const SUBTITLE_SELECTORS = [
    // ChatGPT start
    // Anthropic Academy (JW Player)
    ".jw-text-track-cue", // 🎯 subtitle text chính
    ".jw-text-track-display",
    ".jw-text-track-container",

    // JW Player (fallback rộng hơn)
    '[class*="jw-text-track"]',
    // ChatGPT end

    // Anthropic Academy (Wistia player)
    '.w-css-reset .w-bpb-wrapper [class*="caption"]',
    '[class*="captionText"]',
    '[class*="subtitle"]',
    ".w-vulcan-v2-button ~ div span",
    // Wistia generic
    ".wistia_captions_text",
    '.w-css-reset span[data-handle="captions"]',
    // YouTube
    ".ytp-caption-segment",
    // Vimeo
    ".vp-captions span",
    // Generic HTML5
    'track[kind="subtitles"]',
    'track[kind="captions"]',
    // Mux player
    "mux-player::cue",
    '[data-testid="subtitle-cue"]',
    // Custom players — broad catch
    '[class*="caption"]:not(figure):not(figcaption)',
    '[class*="Caption"]:not(figure):not(figcaption)',
    '[class*="cue"]',
  ];

  // ── Phần tử dịch overlay ─────────────────────────────────
  let translationBox = null;
  let lastOriginal = "";
  let translateTimer = null;

  function createTranslationBox() {
    if (translationBox) return translationBox;

    translationBox = document.createElement("div");
    translationBox.id = "sttrans-box";
    translationBox.setAttribute("data-sttrans", "true");
    makeDraggable(translationBox);

    attachToPlayer();

    return translationBox;
  }

  function getPlayerRoot() {
    if (document.fullscreenElement) return document.fullscreenElement;

    const player = document.querySelector(".jwplayer, #movie_player, .w-vulcan-v2");
    if (player) return player;

    // <wistia-player> render trong shadow DOM → gắn box vào phần tử cha của nó
    const wp = document.querySelector("wistia-player");
    if (wp && wp.parentElement) {
      const parent = wp.parentElement;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      return parent;
    }

    return document.body;
  }

  function attachToPlayer() {
    const root = getPlayerRoot();
    if (translationBox && translationBox.parentElement !== root) {
      root.appendChild(translationBox);
      updateBoxStyle();
    }
  }
  document.addEventListener("fullscreenchange", attachToPlayer);

  // Gắn vào body → dùng fixed theo viewport; gắn vào player → absolute theo player
  function isInPlayer() {
    return translationBox && translationBox.parentElement !== document.body;
  }

  function containerRect() {
    if (isInPlayer()) return translationBox.parentElement.getBoundingClientRect();
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function updateBoxStyle() {
    if (!translationBox) return;

    const isFullscreen = !!document.fullscreenElement;
    // popup lưu 0–100, bản cũ gửi 0–1
    const op = parseFloat(config.bgOpacity);
    const opacity = isNaN(op) ? 0.85 : op > 1 ? op / 100 : op;

    let pos;
    if (config.customPos) {
      pos = `
        left: ${config.customPos.x * 100}%;
        top: ${config.customPos.y * 100}%;
        bottom: auto;`;
    } else if (config.boxPosition === "top") {
      pos = `
        left: 50%;
        top: ${isFullscreen ? "8%" : "40px"};
        bottom: auto;`;
    } else {
      pos = `
        left: 50%;
        top: auto;
        bottom: ${isFullscreen ? "10%" : "80px"};`;
    }

    translationBox.style.cssText = `
      position: ${isInPlayer() ? "absolute" : "fixed"};
      ${pos}
      transform: translateX(-50%);
      z-index: 2147483647;
      font-size: ${config.fontSize}px;
      background: rgba(0,0,0,${opacity});
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      text-align: center;
      max-width: 80%;
    `;
  }

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim();
  }

  // ── Kéo thả: giữ Shift + kéo chuột ───────────────────────
  function makeDraggable(el) {
    let isDragging = false;
    let grabX = 0; // vị trí chuột so với mép trái/trên của box
    let grabY = 0;

    // Chỉ nhận chuột khi giữ Shift, để không chặn click vào video
    const setShift = (on) => el.classList.toggle("sttrans-draggable", on);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Shift") setShift(true);
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Shift" && !isDragging) setShift(false);
    });
    window.addEventListener("blur", () => setShift(false));

    el.addEventListener("mousedown", (e) => {
      if (!e.shiftKey) return;
      isDragging = true;
      const rect = el.getBoundingClientRect();
      grabX = e.clientX - rect.left;
      grabY = e.clientY - rect.top;
      e.preventDefault();
      e.stopPropagation();
    });

    // Không để click khi kéo lan xuống player (tránh pause video)
    el.addEventListener("click", (e) => {
      if (e.shiftKey) e.stopPropagation();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const c = containerRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(c.left, Math.min(c.left + c.width - w, e.clientX - grabX));
      const top = Math.max(c.top, Math.min(c.top + c.height - h, e.clientY - grabY));

      config.customPos = {
        x: (left + w / 2 - c.left) / c.width,
        y: (top - c.top) / c.height,
      };
      updateBoxStyle();
    });

    document.addEventListener("mouseup", (e) => {
      if (!isDragging) return;
      isDragging = false;
      if (!e.shiftKey) setShift(false);
      // Chỉ lưu khi thả chuột để không vượt quota của storage.sync
      chrome.storage.sync.set({ customPos: config.customPos });
    });
  }

  // ── Gọi Google Translate miễn phí ───────────────────────
  async function translate(text, target) {
    const key = `${target}:${normalize(text)}`;
    if (cache.has(key)) return cache.get(key);

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(
      text
    )}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      const translated = json[0].map((s) => s[0]).join("");
      cache.set(key, translated);
      return translated;
    } catch {
      return null;
    }
  }

  // ── Hiển thị bản dịch ────────────────────────────────────
  function showTranslation(original, translated) {
    const box = createTranslationBox();
    updateBoxStyle();

    if (!config.showOriginal) {
      box.innerHTML = `<span class="sttrans-vi">${translated}</span>`;
    } else {
      box.innerHTML = `
        <span class="sttrans-orig">${original}</span>
        <span class="sttrans-sep">↓</span>
        <span class="sttrans-vi">${translated}</span>
      `;
    }
    box.classList.add("sttrans-visible");
  }

  function hideTranslation() {
    if (translationBox) translationBox.classList.remove("sttrans-visible");
  }

  // ── Xử lý văn bản phụ đề mới ─────────────────────────────
  async function handleSubtitleText(text) {
    text = text.trim();
    if (!text || text === lastOriginal) return;
    if (!config.enabled) return;

    lastOriginal = text;

    // Debounce 300ms
    clearTimeout(translateTimer);
    translateTimer = setTimeout(async () => {
      const translated = await translate(text, config.targetLang);
      if (translated && translated.toLowerCase() !== text.toLowerCase()) {
        showTranslation(text, translated);
      } else {
        hideTranslation();
      }
    }, 100);
  }

  // ── Tìm phụ đề trong DOM ─────────────────────────────────
  const IS_YOUTUBE = /(^|\.)youtube\.com$/.test(location.hostname);
  const IS_TOP = window === window.top;

  // YouTube: ghép tất cả segment (phụ đề nhiều dòng), trả "" nếu không có phụ đề
  function findYouTubeCaption() {
    const segs = document.querySelectorAll(
      "#movie_player .ytp-caption-segment, .html5-video-player .ytp-caption-segment"
    );
    return Array.from(segs)
      .map((s) => s.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  // Wistia: phụ đề là các <p class="w-captions-line">, có thể nằm trong
  // shadow DOM của <wistia-player> (embed mới) hoặc light DOM (embed cũ / iframe)
  function wistiaRoots() {
    const roots = [document];
    document.querySelectorAll("wistia-player").forEach((p) => {
      if (p.shadowRoot) roots.push(p.shadowRoot);
    });
    return roots;
  }

  function isWistiaPage() {
    return !!document.querySelector("wistia-player, .w-vulcan-v2, .wistia_embed");
  }

  function findWistiaCaption() {
    const lines = [];
    for (const root of wistiaRoots()) {
      root.querySelectorAll(".w-captions-line").forEach((l) => {
        const t = l.textContent.trim();
        if (t) lines.push(t);
      });
    }
    return lines.join(" ");
  }

  // Player đã biết: trả text ("" = đang không có phụ đề); null = không nhận ra player
  function findKnownPlayerCaption() {
    if (IS_YOUTUBE) return findYouTubeCaption();
    if (isWistiaPage()) return findWistiaCaption();
    return null;
  }

  function findSubtitleText() {
    for (const sel of SUBTITLE_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 3) {
          return el.textContent.trim();
        }
      } catch {
        /* invalid selector, skip */
      }
    }
    return null;
  }

  // ── Anthropic Academy: Observer trên shadow DOM ───────────
  function watchWistiaPlayer() {
    // Wistia nhúng caption vào div động, quan sát toàn body
    const opts = { childList: true, subtree: true, characterData: true };
    const observedRoots = new WeakSet();

    const observer = new MutationObserver(() => {
      // MutationObserver trên body không thấy thay đổi trong shadow DOM
      document.querySelectorAll("wistia-player").forEach((p) => {
        const r = p.shadowRoot;
        if (r && !observedRoots.has(r)) {
          observedRoots.add(r);
          observer.observe(r, opts);
        }
      });

      const known = findKnownPlayerCaption();
      if (known !== null) {
        if (known) {
          attachToPlayer();
          handleSubtitleText(known);
        } else if (lastOriginal) {
          lastOriginal = "";
          clearTimeout(translateTimer);
          hideTranslation();
        }
        return;
      }

      // Selector chung dễ bắt nhầm — không chạy trong iframe quảng cáo/embed lạ
      if (!IS_TOP) return;
      const text = findSubtitleText();
      if (text) handleSubtitleText(text);
      else {
        // Xem thêm các span thay đổi gần video
        const videos = document.querySelectorAll("video");
        videos.forEach((v) => {
          const nearbyText = getNearbyCaption(v);
          if (nearbyText) handleSubtitleText(nearbyText);
        });
      }
    });

    observer.observe(document.body, opts);
  }

  function getNearbyCaption(videoEl) {
    // Đi lên 5 cấp cha, tìm bất kỳ span chứa text ngắn (<300 ký tự)
    let el = videoEl;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;
      const spans = el.querySelectorAll("span, p, div");
      for (const span of spans) {
        const t = span.textContent.trim();
        if (
          t.length > 5 &&
          t.length < 300 &&
          span.children.length === 0 &&
          !span.getAttribute("data-sttrans") &&
          span.offsetParent !== null // visible
        ) {
          return t;
        }
      }
    }
    return null;
  }

  // ── TextTrack API (HTML5 native captions) ─────────────────
  function watchTextTracks() {
    document.querySelectorAll("video").forEach(attachTrackListener);

    // Quan sát video mới thêm vào
    const mo = new MutationObserver(() => {
      document.querySelectorAll("video").forEach(attachTrackListener);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  const attachedVideos = new WeakSet();
  function attachTrackListener(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);

    const tryTracks = () => {
      for (const track of video.textTracks) {
        if (["subtitles", "captions"].includes(track.kind)) {
          track.mode = "hidden"; // Tắt hiển thị mặc định để chúng ta tự xử lý
          track.oncuechange = () => {
            const cue = track.activeCues?.[0];
            if (cue) handleSubtitleText(cue.text.replace(/<[^>]+>/g, ""));
            else hideTranslation();
          };
        }
      }
    };

    video.addEventListener("loadedmetadata", tryTracks);
    tryTracks();
  }

  // ── Khởi động ────────────────────────────────────────────
  function init() {
    createTranslationBox();
    updateBoxStyle();
    watchWistiaPlayer();
    watchTextTracks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ── Nhận lệnh từ popup ───────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE") {
      config.enabled = msg.value;
      if (!config.enabled) hideTranslation();
    }
    if (msg.type === "CONFIG_UPDATED") {
      Object.assign(config, msg.config);
      updateBoxStyle();
    }
  });
})();
