const MILLENNIUM_IS_CLIENT_MODULE = true;
const pluginName = "whats-new-rss-ticker";

function InitializePlugins() {
  const plugins = window.PLUGIN_LIST || (window.PLUGIN_LIST = {});
  plugins[pluginName] || (plugins[pluginName] = {});
  window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||
    (window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS = {});
}

InitializePlugins();

let PluginEntryPointMain = function () {
  return function (exports, UI, React) {
    "use strict";

    const STORAGE_KEY = "millennium.ticker.settings";
    const RSS_CACHE_KEY = "millennium.ticker.rss-cache";
    const STYLE_ID = "millennium-whats-new-ticker-style";
    const DEFAULT_SETTINGS = {
      speed: 45,
      manualResumeDelay: 10,
      scrollMode: "continuous",
      pageIntervalSeconds: 10,
      rssFeeds: [],
      orderingMode: "chronological",
      rssPerSteam: 2,
      rssArticleLimit: 20,
      rssRows: [],
      combineYoutubeFeedsAsOneSource: false,
      manualArticleSizeEnabled: false,
      rowArticleWidth: 260,
      rowArticleHeight: 146,
      openedArticleWidth: 900,
      openedArticleHeight: 760,
      refreshOnLibrary: true,
      refreshOnArticleClose: true,
      refreshIntervalMinutes: 60,
      dateLocale: "system",
      dateStyle: "medium",
      weekdayStyle: "short",
      hourCycle: "system",
      datePosition: "above"
    };
    const controllers = new Map();
    const settingsListeners = new Set();
    let settings = loadSettings();
    let rssCache = loadRssCache();
    let refreshPromise = null;
    let refreshTimer = 0;

    function clampSpeed(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(10, Math.min(200, number)) : DEFAULT_SETTINGS.speed;
    }

    function clampResumeDelay(value) {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(1, Math.min(60, Math.round(number)))
        : DEFAULT_SETTINGS.manualResumeDelay;
    }

    function clampPageInterval(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(2, Math.min(120, Math.round(number))) : 10;
    }

    function clampRssPerSteam(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(1, Math.min(20, Math.round(number))) : 2;
    }

    function clampRssArticleLimit(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(1, Math.min(200, Math.round(number))) : 20;
    }

    function normalizeRssRows(rows, legacyShelfEnabled = false) {
      if (!Array.isArray(rows)) return legacyShelfEnabled ? [{ id: "legacy-mixed", feedUrl: "" }] : [];
      return rows
        .filter((row) => row && typeof row === "object")
        .map((row, index) => ({
          id: typeof row.id === "string" && row.id ? row.id : `rss-row-${index}`,
          feedUrl: typeof row.feedUrl === "string" ? row.feedUrl : "",
          sourceType: ["mixed-all", "mixed-non-youtube", "mixed-youtube", "feed"].includes(row.sourceType)
            ? row.sourceType
            : (row.feedUrl ? "feed" : "mixed-all")
        }));
    }

    function clampRefreshInterval(value) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(5, Math.min(1440, Math.round(number))) : 60;
    }

    function clampArticleDimension(value, fallback, min = 80, max = 2400) {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
    }

    function normalizeFeed(feed) {
      if (!feed || typeof feed.url !== "string") return null;
      try {
        const url = new URL(normalizeFeedUrl(feed.url));
        if (!["http:", "https:"].includes(url.protocol)) return null;
        return {
          url: url.href,
          originalUrl: typeof feed.originalUrl === "string" ? feed.originalUrl : url.href,
          title: typeof feed.title === "string" ? feed.title.trim() : "",
          error: typeof feed.error === "string" ? feed.error : "",
          feedType: typeof feed.feedType === "string" ? feed.feedType : feedTypeFromUrl(url.href),
          youtubeKind: typeof feed.youtubeKind === "string" ? feed.youtubeKind : youtubeKindFromUrl(url.href),
          youtubeChannelMode: ["all", "shorts", "videos"].includes(feed.youtubeChannelMode)
            ? feed.youtubeChannelMode
            : "all"
        };
      } catch {
        return null;
      }
    }

    function isYoutubeChannelFeed(feed) {
      return feed?.feedType === "youtube" && feed.youtubeKind === "channel";
    }

    function commonYoutubeChannelMode(feeds) {
      const modes = (Array.isArray(feeds) ? feeds : [])
        .filter(isYoutubeChannelFeed)
        .map((feed) => feed.youtubeChannelMode || "all");
      return modes.length && modes.every((mode) => mode === modes[0]) ? modes[0] : "all";
    }

    function normalizeFeedUrl(value) {
      const url = new URL(value.trim());
      const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (
        hostname === "gametrailers.com" &&
        url.pathname.replace(/\/+$/g, "").toLowerCase() === "/rss/newest.xml"
      ) {
        return "https://www.youtube.com/feeds/videos.xml?user=GameTrailers";
      }
      if (hostname === "youtube.com" || hostname === "m.youtube.com") {
        const playlistId = url.searchParams.get("list");
        if (playlistId) {
          return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
        }
        if (url.pathname.toLowerCase() === "/feeds/videos.xml") {
          return url.href;
        }
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0]?.toLowerCase() === "channel" && parts[1]) {
          return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(parts[1])}`;
        }
      }
      return url.href;
    }

    function feedTypeFromUrl(value) {
      try {
        const url = new URL(value);
        return url.hostname.includes("youtube.com") && url.pathname === "/feeds/videos.xml"
          ? "youtube"
          : "feed";
      } catch {
        return "feed";
      }
    }

    function youtubeKindFromUrl(value) {
      try {
        const url = new URL(value);
        if (!url.hostname.includes("youtube.com") || url.pathname !== "/feeds/videos.xml") return "";
        if (url.searchParams.has("playlist_id")) return "playlist";
        if (url.searchParams.has("channel_id") || url.searchParams.has("user")) return "channel";
      } catch {}
      return "";
    }

    function isYoutubeChannelInput(value) {
      try {
        const url = new URL(value.trim());
        const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
        if (!["youtube.com", "m.youtube.com"].includes(hostname)) return false;
        if (url.pathname.toLowerCase() === "/feeds/videos.xml") return false;
        if (url.searchParams.get("list")) return false;
        const parts = url.pathname.split("/").filter(Boolean);
        return parts[0]?.startsWith("@") ||
          ["channel", "c", "user"].includes(parts[0]?.toLowerCase());
      } catch {
        return false;
      }
    }

    async function fetchUrlBody(url) {
      const backendResult = await Millennium.callServerMethod(pluginName, "FetchFeed", {
        payload: JSON.stringify({ url })
      });
      const response = JSON.parse(backendResult);
      if (response.error) throw new Error(response.error);
      return response.body || "";
    }

    async function resolveYoutubeChannelFeed(inputUrl) {
      const url = new URL(inputUrl.trim());
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]?.toLowerCase() === "channel" && parts[1]) {
        return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(parts[1])}`;
      }
      const html = await fetchUrlBody(url.href);
      const channelId = html.match(/"channelId"\s*:\s*"([^"]+)"/)?.[1] ||
        html.match(/<meta\s+itemprop=["']channelId["']\s+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/youtube\.com\/channel\/(UC[\w-]+)/i)?.[1];
      if (!channelId) {
        throw new Error("Could not find a YouTube channel ID for that URL.");
      }
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    }

    async function normalizeFeedInput(value, youtubeChannelMode) {
      const originalUrl = value.trim();
      const resolvedUrl = isYoutubeChannelInput(originalUrl)
        ? await resolveYoutubeChannelFeed(originalUrl)
        : originalUrl;
      const normalized = normalizeFeed({ url: resolvedUrl, originalUrl });
      if (!normalized) return null;
      if (normalized.feedType === "youtube" && normalized.youtubeKind === "channel") {
        normalized.youtubeChannelMode = youtubeChannelMode;
      }
      return normalized;
    }

    function loadSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return {
          speed: clampSpeed(saved.speed),
          manualResumeDelay: clampResumeDelay(saved.manualResumeDelay),
          scrollMode: ["continuous", "paged"].includes(saved.scrollMode)
            ? saved.scrollMode
            : DEFAULT_SETTINGS.scrollMode,
          pageIntervalSeconds: clampPageInterval(saved.pageIntervalSeconds),
          rssFeeds: Array.isArray(saved.rssFeeds) ? saved.rssFeeds.map(normalizeFeed).filter(Boolean) : [],
          orderingMode: ["chronological", "alternating", "rss-shelf-only"].includes(saved.orderingMode)
            ? saved.orderingMode
            : DEFAULT_SETTINGS.orderingMode,
          rssPerSteam: clampRssPerSteam(saved.rssPerSteam),
          rssArticleLimit: clampRssArticleLimit(saved.rssArticleLimit),
          rssRows: normalizeRssRows(saved.rssRows, saved.rssShelfEnabled === true),
          combineYoutubeFeedsAsOneSource: saved.combineYoutubeFeedsAsOneSource === true,
          manualArticleSizeEnabled: saved.manualArticleSizeEnabled === true,
          rowArticleWidth: clampArticleDimension(
            saved.rowArticleWidth,
            DEFAULT_SETTINGS.rowArticleWidth,
            120
          ),
          rowArticleHeight: clampArticleDimension(
            saved.rowArticleHeight,
            DEFAULT_SETTINGS.rowArticleHeight,
            80
          ),
          openedArticleWidth: clampArticleDimension(
            saved.openedArticleWidth,
            DEFAULT_SETTINGS.openedArticleWidth,
            320
          ),
          openedArticleHeight: clampArticleDimension(
            saved.openedArticleHeight,
            DEFAULT_SETTINGS.openedArticleHeight,
            240
          ),
          refreshOnLibrary: saved.refreshOnLibrary !== false,
          refreshOnArticleClose: saved.refreshOnArticleClose !== false,
          refreshIntervalMinutes: clampRefreshInterval(saved.refreshIntervalMinutes),
          dateLocale: ["system", "us", "eu"].includes(saved.dateLocale)
            ? saved.dateLocale
            : DEFAULT_SETTINGS.dateLocale,
          dateStyle: ["short", "medium", "long"].includes(saved.dateStyle)
            ? saved.dateStyle
            : DEFAULT_SETTINGS.dateStyle,
          weekdayStyle: ["none", "short", "long"].includes(saved.weekdayStyle)
            ? saved.weekdayStyle
            : DEFAULT_SETTINGS.weekdayStyle,
          hourCycle: ["system", "12", "24"].includes(saved.hourCycle)
            ? saved.hourCycle
            : DEFAULT_SETTINGS.hourCycle,
          datePosition: ["above", "below-image", "below-title", "below-source", "beside-source"].includes(
            saved.datePosition
          )
            ? saved.datePosition
            : DEFAULT_SETTINGS.datePosition
        };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function saveSettings(next) {
      settings = {
        ...settings,
        ...next,
        speed: clampSpeed(next.speed ?? settings.speed),
        manualResumeDelay: clampResumeDelay(next.manualResumeDelay ?? settings.manualResumeDelay),
        scrollMode: ["continuous", "paged"].includes(next.scrollMode)
          ? next.scrollMode
          : settings.scrollMode,
        pageIntervalSeconds: clampPageInterval(
          next.pageIntervalSeconds ?? settings.pageIntervalSeconds
        ),
        rssFeeds: (next.rssFeeds ?? settings.rssFeeds).map(normalizeFeed).filter(Boolean),
        rssPerSteam: clampRssPerSteam(next.rssPerSteam ?? settings.rssPerSteam),
        rssArticleLimit: clampRssArticleLimit(next.rssArticleLimit ?? settings.rssArticleLimit),
        rssRows: normalizeRssRows(next.rssRows ?? settings.rssRows),
        combineYoutubeFeedsAsOneSource:
          next.combineYoutubeFeedsAsOneSource ?? settings.combineYoutubeFeedsAsOneSource,
        manualArticleSizeEnabled:
          next.manualArticleSizeEnabled ?? settings.manualArticleSizeEnabled,
        rowArticleWidth: clampArticleDimension(
          next.rowArticleWidth ?? settings.rowArticleWidth,
          settings.rowArticleWidth,
          120
        ),
        rowArticleHeight: clampArticleDimension(
          next.rowArticleHeight ?? settings.rowArticleHeight,
          settings.rowArticleHeight,
          80
        ),
        openedArticleWidth: clampArticleDimension(
          next.openedArticleWidth ?? settings.openedArticleWidth,
          settings.openedArticleWidth,
          320
        ),
        openedArticleHeight: clampArticleDimension(
          next.openedArticleHeight ?? settings.openedArticleHeight,
          settings.openedArticleHeight,
          240
        ),
        refreshIntervalMinutes: clampRefreshInterval(
          next.refreshIntervalMinutes ?? settings.refreshIntervalMinutes
        )
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      controllers.forEach((controller) => controller.setSettings(settings));
      settingsListeners.forEach((listener) => listener(settings));
      scheduleRefreshTimer();
    }

    function formatArticleDate(timestamp) {
      const date = new Date(timestamp);
      if (!Number.isFinite(date.getTime())) return "";
      const locale = settings.dateLocale === "us"
        ? "en-US"
        : settings.dateLocale === "eu"
          ? "en-GB"
          : undefined;
      const options = {
        dateStyle: settings.dateStyle,
        timeStyle: "short"
      };
      if (settings.hourCycle === "12") options.hour12 = true;
      if (settings.hourCycle === "24") options.hour12 = false;
      let formatted = new Intl.DateTimeFormat(locale, options).format(date);
      if (settings.weekdayStyle !== "none") {
        const weekday = new Intl.DateTimeFormat(locale, {
          weekday: settings.weekdayStyle
        }).format(date);
        formatted = `${weekday}, ${formatted}`;
      }
      return formatted;
    }

    function loadRssCache() {
      try {
        const saved = JSON.parse(localStorage.getItem(RSS_CACHE_KEY) || "{}");
        return saved && typeof saved === "object" ? saved : {};
      } catch {
        return {};
      }
    }

    function saveRssCache() {
      try {
        localStorage.setItem(RSS_CACHE_KEY, JSON.stringify(rssCache));
      } catch {
        const compactCache = Object.fromEntries(
          Object.entries(rssCache).map(([url, cache]) => [
            url,
            {
              ...cache,
              articles: (cache.articles || []).slice(0, 15).map((article) => ({
                ...article,
                content: (article.content || "").slice(0, 5000)
              }))
            }
          ])
        );
        rssCache = compactCache;
        try {
          localStorage.setItem(RSS_CACHE_KEY, JSON.stringify(rssCache));
        } catch {}
      }
    }

    function notifyControllers() {
      controllers.forEach((controller) => controller.onRssUpdated());
      settingsListeners.forEach((listener) => listener(settings));
    }

    function injectStyles(document) {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        [data-millennium-ticker-viewport] {
          overflow: hidden !important;
          scrollbar-width: none !important;
        }
        [data-millennium-ticker-viewport]::-webkit-scrollbar {
          display: none !important;
        }
        [data-millennium-ticker-track] {
          display: flex !important;
          flex-flow: row nowrap !important;
          align-items: stretch;
          width: max-content !important;
          max-width: none !important;
          transition: none !important;
          will-change: transform;
          backface-visibility: hidden;
          transform-style: preserve-3d;
        }
        [data-millennium-ticker-track] > [data-millennium-ticker-unit] {
          flex: 0 0 auto !important;
        }
        [data-millennium-ticker-clone] {
          pointer-events: auto;
        }
        .millennium-ticker-speed {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
        }
        .millennium-ticker-speed input[type="range"] {
          flex: 1;
          min-width: 120px;
          accent-color: currentColor;
        }
        .millennium-ticker-speed output {
          min-width: 72px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .millennium-ticker-setting-row,
        .millennium-rss-add-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        .millennium-ticker-setting-row input[type="number"],
        .millennium-rss-add-row input {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          padding: 8px 10px;
          color: inherit;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .millennium-ticker-setting-row select {
          width: 100%;
          padding: 8px 10px;
          color: inherit;
          background: #1f2935;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .millennium-manual-size-settings {
          width: 100%;
          margin: 0 0 12px;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .millennium-manual-size-settings h3 {
          margin: 0 0 4px;
          color: #dcdedf;
          font-size: 14px;
          font-weight: 600;
        }
        .millennium-manual-size-settings p {
          margin: 0 0 10px;
          color: #8f98a0;
          font-size: 12px;
          line-height: 1.4;
        }
        .millennium-manual-size-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 8px 12px;
          width: 100%;
          margin-top: 8px;
        }
        .millennium-manual-size-grid label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          color: #b8bcbf;
          font-size: 12px;
        }
        .millennium-manual-size-grid input {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          color: inherit;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .millennium-date-settings {
          display: grid;
          grid-template-columns: minmax(120px, auto) minmax(170px, 1fr);
          align-items: center;
          gap: 8px 12px;
          width: 100%;
        }
        .millennium-date-settings select {
          width: 100%;
          padding: 7px 9px;
          color: inherit;
          background: #1f2935;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .millennium-rss-add-row button,
        .millennium-rss-feed button {
          padding: 7px 12px;
          color: inherit;
          background: rgba(255, 255, 255, 0.1);
          border: 0;
          border-radius: 2px;
          cursor: pointer;
        }
        .millennium-rss-feed-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          margin-top: 10px;
        }
        .millennium-rss-feed {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.18);
        }
        .millennium-rss-feed-details {
          flex: 1;
          min-width: 0;
        }
        .millennium-rss-feed-title,
        .millennium-rss-feed-url,
        .millennium-rss-feed-error {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .millennium-rss-feed-url {
          opacity: 0.65;
          font-size: 11px;
        }
        .millennium-rss-feed-error,
        .millennium-rss-warning {
          color: #ffb36b;
          font-size: 12px;
        }
        .millennium-rss-card {
          position: relative;
          width: 100%;
          min-width: 260px;
          aspect-ratio: 16 / 9;
          overflow: hidden;
          cursor: pointer;
          background: #17212b;
          border-radius: 3px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.35);
        }
        .millennium-rss-card img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .millennium-rss-card-fallback {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #1b5f84, #182637 70%);
        }
        [data-millennium-rss-unit] {
          position: relative !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          box-sizing: border-box;
          overflow: visible !important;
        }
        .millennium-rss-card-date {
          height: 16px;
          overflow: hidden;
          color: #8f98a0;
          font-size: 12px;
          line-height: 16px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        [data-millennium-rss-date-position="above"] .millennium-rss-card-date {
          position: absolute;
          top: -16px;
          left: 0;
          right: 0;
        }
        [data-millennium-rss-date-position="below-image"] .millennium-rss-card-date,
        [data-millennium-rss-date-position="below-title"] .millennium-rss-card-date,
        [data-millennium-rss-date-position="below-source"] .millennium-rss-card-date {
          position: static;
          margin-top: 6px;
        }
        .millennium-rss-card-title {
          display: -webkit-box;
          min-height: 38px;
          margin-top: 9px;
          overflow: hidden;
          color: #f5f5f5;
          cursor: pointer;
          font-size: 15px;
          font-weight: 500;
          line-height: 19px;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .millennium-rss-source-button {
          align-self: flex-start;
          max-width: 100%;
          margin-top: 7px;
          padding: 5px 9px;
          overflow: hidden;
          color: #dcdedf;
          background: rgba(103, 193, 245, 0.14);
          border: 0;
          border-radius: 2px;
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          line-height: 16px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .millennium-rss-source-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          margin-top: 7px;
        }
        .millennium-rss-source-row .millennium-rss-source-button {
          flex: 0 1 auto;
          margin-top: 0;
        }
        [data-millennium-rss-date-position="beside-source"] .millennium-rss-card-date {
          flex: 1 1 auto;
          min-width: 0;
          text-align: right;
        }
        .millennium-rss-source-button:hover,
        .millennium-rss-source-button:focus {
          color: white;
          background: rgba(103, 193, 245, 0.3);
        }
        .millennium-rss-card-source {
          margin-bottom: 4px;
          color: #67c1f5;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .millennium-rss-modal {
          position: fixed;
          z-index: 100000;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          background: rgba(0, 0, 0, 0.72);
        }
        .millennium-rss-modal-panel {
          position: relative;
          width: min(900px, 90vw);
          max-height: 88vh;
          overflow: auto;
          color: #d6d7d8;
          background: #18222e;
          box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
        }
        .millennium-rss-modal-hero {
          width: 100%;
          max-height: 360px;
          object-fit: cover;
        }
        .millennium-rss-modal-video {
          width: 100%;
          aspect-ratio: 16 / 9;
          display: block;
          background: #000;
          border: 0;
        }
        .millennium-rss-modal-body {
          padding: 28px 34px 34px;
        }
        .millennium-rss-modal-body h1 {
          margin: 4px 48px 10px 0;
          color: white;
          font-size: 28px;
        }
        .millennium-rss-modal-content {
          font-size: 15px;
          line-height: 1.6;
        }
        .millennium-rss-modal-content img {
          max-width: 100%;
          height: auto;
        }
        .millennium-rss-modal-close {
          position: absolute;
          z-index: 1;
          top: 12px;
          right: 12px;
          width: 36px;
          height: 36px;
          color: white;
          background: rgba(0, 0, 0, 0.65);
          border: 0;
          border-radius: 2px;
          cursor: pointer;
          font-size: 22px;
        }
        .millennium-rss-modal-link {
          display: inline-block;
          margin-top: 18px;
          padding: 9px 14px;
          color: white;
          background: linear-gradient(90deg, #06bfff, #2d73ff);
          text-decoration: none;
        }
        .millennium-archive-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          flex: 0 0 30px;
          margin-right: 6px;
          padding: 0;
          color: #8b929a;
          background: transparent;
          border: 0;
          border-radius: 2px;
          cursor: pointer;
        }
        .millennium-archive-button:hover,
        .millennium-archive-button:focus {
          color: white;
          background: rgba(255, 255, 255, 0.1);
        }
        .millennium-archive-button svg {
          width: 19px;
          height: 19px;
          fill: currentColor;
        }
        .millennium-archive-modal {
          position: fixed;
          z-index: 100000;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: rgba(0, 0, 0, 0.76);
        }
        .millennium-archive-panel {
          position: relative;
          display: flex;
          flex-direction: column;
          width: min(1280px, 94vw);
          max-height: 92vh;
          color: #d6d7d8;
          background: #18222e;
          box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
        }
        .millennium-archive-header {
          flex: 0 0 auto;
          padding: 22px 62px 18px 26px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        }
        .millennium-archive-header h1 {
          margin: 0;
          color: white;
          font-size: 24px;
          font-weight: 500;
        }
        .millennium-archive-header div {
          margin-top: 4px;
          color: #8f98a0;
          font-size: 13px;
        }
        .millennium-archive-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 22px;
          min-height: 180px;
          padding: 24px 26px 32px;
          overflow: auto;
        }
        .millennium-archive-item {
          min-width: 0;
          cursor: pointer;
        }
        .millennium-archive-item > [data-millennium-ticker-unit] {
          width: 100% !important;
          min-width: 0 !important;
          transform: none !important;
        }
        .millennium-archive-empty {
          grid-column: 1 / -1;
          padding: 50px;
          text-align: center;
          color: #8f98a0;
        }
        .millennium-rss-shelf {
          position: relative;
          margin: 18px 0;
          padding: 0 16px;
        }
        .millennium-rss-shelf-track {
          display: flex !important;
          flex-flow: row nowrap !important;
          align-items: flex-start;
          gap: 18px;
          width: max-content;
          min-height: 0;
          will-change: transform;
        }
        .millennium-rss-shelf-viewport {
          overflow: hidden;
          min-width: 0;
        }
        .millennium-rss-shelf-item,
        [data-millennium-rss-shelf-unit] {
          position: relative;
          display: flex;
          flex-direction: column;
          flex: 0 0 auto;
          min-width: var(--millennium-rss-shelf-item-width, 260px) !important;
          width: var(--millennium-rss-shelf-item-width, 260px) !important;
          max-width: var(--millennium-rss-shelf-item-width, 260px) !important;
        }
        .millennium-rss-shelf-item .millennium-rss-card,
        [data-millennium-rss-shelf-unit] .millennium-rss-card {
          min-width: 0;
        }
        .millennium-rss-shelf[data-millennium-manual-article-size="true"] [data-millennium-rss-shelf-unit] .millennium-rss-card {
          height: var(--millennium-rss-shelf-item-height, 146px) !important;
          aspect-ratio: auto !important;
        }
        .millennium-rss-shelf-item[data-millennium-rss-date-position="above"] .millennium-rss-card-date {
          position: static;
          margin-bottom: 0;
        }
        .millennium-rss-shelf-empty {
          padding: 18px 0;
          color: #8f98a0;
        }
        .millennium-rss-shelf-reminder {
          margin-top: 8px;
          color: #ffb36b;
          font-size: 12px;
        }
        .millennium-row-controls {
          display: inline-flex;
          align-items: center;
          margin-right: 4px;
        }
        .millennium-row-control {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          padding: 0;
          color: #8b929a;
          background: transparent;
          border: 0;
          border-radius: 2px;
          cursor: pointer;
          font-size: 22px;
          line-height: 1;
        }
        .millennium-row-control:hover,
        .millennium-row-control:focus {
          color: white;
          background: rgba(255, 255, 255, 0.1);
        }
        .millennium-row-control:disabled {
          opacity: 0.35;
          cursor: default;
          background: transparent;
        }
        .millennium-row-picker {
          position: fixed;
          z-index: 100001;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: rgba(0, 0, 0, 0.72);
        }
        .millennium-row-picker-panel {
          width: min(460px, 90vw);
          padding: 22px;
          color: #d6d7d8;
          background: #18222e;
          box-shadow: 0 12px 60px rgba(0, 0, 0, 0.7);
        }
        .millennium-row-picker-panel h2 {
          margin: 0 0 6px;
          color: white;
          font-size: 20px;
        }
        .millennium-row-picker-panel p {
          margin: 0 0 16px;
          color: #8f98a0;
        }
        .millennium-row-picker-options {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .millennium-row-picker-options button {
          padding: 10px 12px;
          color: #dcdedf;
          background: rgba(255, 255, 255, 0.08);
          border: 0;
          cursor: pointer;
          font: inherit;
          text-align: left;
        }
        .millennium-row-picker-options button:hover,
        .millennium-row-picker-options button:focus {
          color: white;
          background: rgba(103, 193, 245, 0.25);
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    function directChild(element, names) {
      const expected = new Set(names.map((name) => name.toLowerCase()));
      return [...(element?.children || [])].find(
        (child) => expected.has(child.localName.toLowerCase())
      );
    }

    function directChildText(element, names) {
      return directChild(element, names)?.textContent?.trim() || "";
    }

    function resolveUrl(value, baseUrl) {
      if (!value) return "";
      try {
        const url = new URL(value, baseUrl || undefined);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
      } catch {
        return "";
      }
    }

    function imageFrom(entry, baseUrl, content) {
      const mediaItems = [...entry.getElementsByTagName("*")].filter((element) => {
        const name = element.localName.toLowerCase();
        return ["content", "thumbnail", "enclosure"].includes(name) &&
          (element.hasAttribute("url") || element.hasAttribute("href"));
      });
      for (const media of mediaItems) {
        const mediaUrl = media.getAttribute("url") || media.getAttribute("href");
        if (mediaUrl && (media.getAttribute("type") || "").startsWith("image/")) {
          return resolveUrl(mediaUrl, baseUrl);
        }
        if (mediaUrl && /(\.png|\.jpe?g|\.webp|\.gif)(\?|$)/i.test(mediaUrl)) {
          return resolveUrl(mediaUrl, baseUrl);
        }
      }
      const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
      return resolveUrl(match?.[1] || "", baseUrl);
    }

    function youtubeVideoId(entry, link) {
      const videoId = directChildText(entry, ["videoId"]);
      if (videoId) return videoId;
      const id = directChildText(entry, ["id"]);
      const taggedId = id.match(/video:([^:]+)$/i)?.[1];
      if (taggedId) return taggedId;
      try {
        const url = new URL(link);
        if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
        if (url.hostname.includes("youtube.com")) return url.searchParams.get("v") || "";
      } catch {}
      return "";
    }

    function articleImage(entry, feedUrl, content, videoId) {
      return imageFrom(entry, feedUrl, content) ||
        (videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "");
    }

    function youtubeArticleKind(entry, link, content) {
      const haystack = `${link || ""} ${content || ""} ${
        [...entry.getElementsByTagName("*")].map((element) =>
          `${element.getAttribute("url") || ""} ${element.getAttribute("href") || ""}`
        ).join(" ")
      }`.toLowerCase();
      return haystack.includes("/shorts/") || /(^|\s)#shorts?(\s|$)/i.test(haystack) ? "short" : "video";
    }

    function feedSourceTitle(feed, parsedTitle) {
      if (settings.combineYoutubeFeedsAsOneSource && feed.feedType === "youtube") return "YouTube";
      return parsedTitle || new URL(feed.url).hostname;
    }

    function parseFeed(xmlText, feed) {
      const feedUrl = typeof feed === "string" ? feed : feed.url;
      const feedSettings = typeof feed === "string" ? normalizeFeed({ url: feed }) : feed;
      const parser = new DOMParser();
      const document = parser.parseFromString(xmlText, "application/xml");
      const parseError = document.querySelector("parsererror");
      if (parseError) throw new Error("The response is not valid RSS or Atom XML.");

      const root = document.documentElement;
      const channel = document.querySelector("channel");
      const atom = root?.localName?.toLowerCase() === "feed";
      if (!channel && !atom) throw new Error("No RSS channel or Atom feed was found.");

      const parsedTitle = directChildText(atom ? root : channel, ["title"]);
      const sourceTitle = feedSourceTitle(feedSettings, parsedTitle);
      const entries = (atom
        ? [...root.children].filter((element) => element.localName.toLowerCase() === "entry")
        : [...channel.children].filter((element) => element.localName.toLowerCase() === "item"))
        .filter((entry) => {
          if (feedSettings.youtubeKind !== "channel" || feedSettings.youtubeChannelMode === "all") return true;
          const content = directChildText(entry, ["encoded", "content", "description", "summary"]);
          const atomLink = [...entry.children].filter(
            (element) => element.localName.toLowerCase() === "link"
          ).find(
            (link) => !link.getAttribute("rel") || link.getAttribute("rel") === "alternate"
          );
          const link = resolveUrl(
            atomLink?.getAttribute("href") || directChildText(entry, ["link"]),
            feedUrl
          );
          const kind = youtubeArticleKind(entry, link, content);
          return feedSettings.youtubeChannelMode === "shorts" ? kind === "short" : kind !== "short";
        });

      return {
        title: sourceTitle,
        articles: entries.slice(0, 30).map((entry, index) => {
          const title = directChildText(entry, ["title"]) || "Untitled article";
          const content = directChildText(
            entry,
            ["encoded", "content", "description", "summary"]
          ).slice(0, 30000);
          const atomLink = [...entry.children].filter(
            (element) => element.localName.toLowerCase() === "link"
          ).find(
            (link) => !link.getAttribute("rel") || link.getAttribute("rel") === "alternate"
          );
          const link = resolveUrl(
            atomLink?.getAttribute("href") || directChildText(entry, ["link"]),
            feedUrl
          );
          const dateText = directChildText(entry, ["pubDate", "published", "updated", "date"]);
          const timestamp = Date.parse(dateText);
          const guid = directChildText(entry, ["guid", "id"]) || link || `${title}-${index}`;
          const videoId = youtubeVideoId(entry, link);
          return {
            id: `${feedUrl}::${guid}`,
            feedUrl,
            source: sourceTitle,
            title,
            link,
            content,
            summary: content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
            image: articleImage(entry, feedUrl, content, videoId),
            videoId,
            videoProvider: videoId ? "youtube" : "",
            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() - index
          };
        })
      };
    }

    async function fetchFeed(feed) {
      try {
        const backendResult = await Millennium.callServerMethod(pluginName, "FetchFeed", {
          payload: JSON.stringify({ url: feed.url })
        });
        const response = JSON.parse(backendResult);
        if (response.error) throw new Error(response.error);
        const xmlText = response.body || "";
        if (!xmlText) throw new Error("The feed response was empty.");
        const parsed = parseFeed(xmlText, feed);
        rssCache[feed.url] = {
          title: parsed.title,
          articles: parsed.articles,
          updatedAt: Date.now(),
          error: ""
        };
        return { ...feed, title: parsed.title, error: "" };
      } catch (error) {
        const message = `Could not load feed: ${error?.message || String(error)}`;
        rssCache[feed.url] = {
          ...(rssCache[feed.url] || {}),
          updatedAt: rssCache[feed.url]?.updatedAt || 0,
          error: message
        };
        return { ...feed, error: message };
      }
    }

    async function refreshFeeds(reason = "manual") {
      if (refreshPromise) return refreshPromise;
      const feeds = settings.rssFeeds;
      if (!feeds.length) return [];
      console.log(`[What's New RSS Ticker] Refreshing ${feeds.length} RSS feed(s): ${reason}`);
      refreshPromise = Promise.all(feeds.map(fetchFeed))
        .then((updatedFeeds) => {
          settings = { ...settings, rssFeeds: updatedFeeds };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
          saveRssCache();
          notifyControllers();
          return updatedFeeds;
        })
        .finally(() => {
          refreshPromise = null;
        });
      return refreshPromise;
    }

    function scheduleRefreshTimer() {
      clearInterval(refreshTimer);
      refreshTimer = 0;
      if (!settings.rssFeeds.length) return;
      refreshTimer = setInterval(
        () => refreshFeeds("scheduled interval"),
        settings.refreshIntervalMinutes * 60 * 1000
      );
    }

    function allRssArticles() {
      const activeUrls = new Set(settings.rssFeeds.map((feed) => feed.url));
      return Object.entries(rssCache)
        .filter(([url]) => activeUrls.has(url))
        .flatMap(([, cache]) => Array.isArray(cache.articles) ? cache.articles : [])
        .sort((left, right) => right.timestamp - left.timestamp);
    }

    function mixedRssArticles() {
      const articles = allRssArticles();
      return articles;
    }

    function feedIsYoutube(feedUrl) {
      return settings.rssFeeds.some((feed) => feed.url === feedUrl && feed.feedType === "youtube");
    }

    function articlesForRowType(sourceType) {
      const articles = mixedRssArticles();
      if (sourceType === "mixed-youtube") return articles.filter((article) => feedIsYoutube(article.feedUrl));
      if (sourceType === "mixed-non-youtube") return articles.filter((article) => !feedIsYoutube(article.feedUrl));
      return articles;
    }

    function currentAutomaticArticleSizes() {
      const controller = [...controllers.values()].find((candidate) => candidate.document?.documentElement);
      const win = controller?.window || globalThis;
      const templateUnit = controller?.currentUnits?.find(
        (unit) => unit?.isConnected && !unit.hasAttribute("data-millennium-ticker-clone")
      );
      const rowRect = templateUnit?.getBoundingClientRect?.();
      const rowWidth = rowRect?.width > 0 ? Math.round(rowRect.width) : DEFAULT_SETTINGS.rowArticleWidth;
      const rowHeight = rowRect?.height > 0
        ? Math.round(rowRect.height)
        : Math.round(rowWidth * 9 / 16);
      const innerWidth = Number(win.innerWidth) || 1000;
      const innerHeight = Number(win.innerHeight) || 864;
      return {
        rowArticleWidth: clampArticleDimension(rowWidth, DEFAULT_SETTINGS.rowArticleWidth, 120),
        rowArticleHeight: clampArticleDimension(rowHeight, DEFAULT_SETTINGS.rowArticleHeight, 80),
        openedArticleWidth: clampArticleDimension(
          Math.min(900, Math.round(innerWidth * 0.9)),
          DEFAULT_SETTINGS.openedArticleWidth,
          320
        ),
        openedArticleHeight: clampArticleDimension(
          Math.round(innerHeight * 0.88),
          DEFAULT_SETTINGS.openedArticleHeight,
          240
        )
      };
    }

    function sanitizeArticleHtml(document, html, baseUrl) {
      const template = document.createElement("template");
      template.innerHTML = html || "";
      template.content.querySelectorAll(
        "script,style,iframe,object,embed,form,input,button,textarea,select,meta,link"
      ).forEach((element) => element.remove());
      template.content.querySelectorAll("*").forEach((element) => {
        [...element.attributes].forEach((attribute) => {
          if (attribute.name.startsWith("on") || attribute.name === "style") {
            element.removeAttribute(attribute.name);
          }
        });
        if (element.hasAttribute("href")) {
          element.setAttribute("href", resolveUrl(element.getAttribute("href"), baseUrl));
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noreferrer");
        }
        if (element.hasAttribute("src")) {
          element.setAttribute("src", resolveUrl(element.getAttribute("src"), baseUrl));
        }
      });
      return template.innerHTML;
    }

    function openRssArticle(document, article, onClose) {
      document.querySelector("[data-millennium-rss-modal]")?.remove();
      const modal = document.createElement("div");
      modal.className = "millennium-rss-modal";
      modal.setAttribute("data-millennium-rss-modal", "");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const panel = document.createElement("article");
      panel.className = "millennium-rss-modal-panel";
      if (settings.manualArticleSizeEnabled) {
        panel.style.setProperty("width", `${settings.openedArticleWidth}px`, "important");
        panel.style.setProperty("height", `${settings.openedArticleHeight}px`, "important");
        panel.style.setProperty("max-height", `${settings.openedArticleHeight}px`, "important");
      }
      const close = document.createElement("button");
      close.className = "millennium-rss-modal-close";
      close.setAttribute("aria-label", "Close");
      close.textContent = "\u00d7";
      panel.appendChild(close);
      if (article.videoProvider === "youtube" && article.videoId) {
        const video = document.createElement("iframe");
        video.className = "millennium-rss-modal-video";
        video.src = `https://www.youtube.com/embed/${encodeURIComponent(article.videoId)}?autoplay=1&rel=0`;
        video.title = article.title;
        video.allow = "autoplay; encrypted-media; picture-in-picture";
        video.allowFullscreen = true;
        panel.appendChild(video);
      } else if (article.image) {
        const image = document.createElement("img");
        image.className = "millennium-rss-modal-hero";
        image.src = article.image;
        image.alt = "";
        panel.appendChild(image);
      }
      const body = document.createElement("div");
      body.className = "millennium-rss-modal-body";
      const source = document.createElement("div");
      source.className = "millennium-rss-card-source";
      source.textContent = article.source;
      const title = document.createElement("h1");
      title.textContent = article.title;
      const content = document.createElement("div");
      content.className = "millennium-rss-modal-content";
      content.innerHTML = sanitizeArticleHtml(
        document,
        article.content || article.summary,
        article.link || article.feedUrl
      );
      body.append(source, title, content);
      if (article.link) {
        const link = document.createElement("a");
        link.className = "millennium-rss-modal-link";
        link.href = article.link;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = article.videoProvider === "youtube" ? "Open in browser" : "Continue reading";
        body.appendChild(link);
      }
      panel.appendChild(body);
      modal.appendChild(panel);
      const dismiss = () => {
        modal.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        onClose?.();
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") dismiss();
      };
      close.addEventListener("click", dismiss);
      modal.addEventListener("click", (event) => {
        if (event.target === modal) dismiss();
      });
      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(modal);
      close.focus();
    }

    function isVisible(element) {
      if (!(element instanceof element.ownerDocument.defaultView.HTMLElement)) return false;
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }

    function findSection(document) {
      const currentSteamSection = document.querySelector("._17uEBe5Ri8TMsnfELvs8-N");
      if (currentSteamSection) return currentSteamSection;

      let localizedHeading = "";
      try {
        localizedHeading = globalThis.LocalizationManager?.LocalizeString?.("#LibraryHome_NewUpdates") || "";
      } catch {}

      const expected = new Set(["what's new", "whats new", localizedHeading.trim().toLowerCase()].filter(Boolean));
      const candidates = document.querySelectorAll("h1,h2,h3,[role='heading'],button,div,span");
      for (const candidate of candidates) {
        const text = candidate.textContent?.trim().toLowerCase();
        if (!expected.has(text)) continue;
        let parent = candidate.parentElement;
        for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
          if (findCards(parent).length >= 2) return parent;
        }
      }

      return null;
    }

    function findSectionHeading(section) {
      let localizedHeading = "";
      try {
        localizedHeading = globalThis.LocalizationManager?.LocalizeString?.("#LibraryHome_NewUpdates") || "";
      } catch {}
      const expected = new Set(["what's new", "whats new", localizedHeading.trim().toLowerCase()].filter(Boolean));
      return [...section.querySelectorAll("h1,h2,h3,[role='heading'],div,span")].find((element) => {
        const text = element.textContent?.trim().toLowerCase();
        return expected.has(text) && !element.querySelector("img");
      }) || null;
    }

    function findCards(section) {
      const steamCards = [...section.querySelectorAll(".B-vCdL38RiJlhfSRgZv78")].filter(isVisible);
      if (steamCards.length >= 2) return steamCards;

      return [...section.querySelectorAll("[role='button'],[tabindex='0'],a")].filter((element) => {
        if (!isVisible(element) || !element.querySelector("img")) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 180 && rect.height >= 90;
      });
    }

    function lowestCommonAncestor(elements, boundary) {
      if (!elements.length) return null;
      let candidate = elements[0];
      while (candidate && candidate !== boundary.parentElement) {
        if (elements.every((element) => candidate.contains(element))) return candidate;
        candidate = candidate.parentElement;
      }
      return null;
    }

    function directUnit(card, track) {
      let unit = card;
      while (unit.parentElement && unit.parentElement !== track) unit = unit.parentElement;
      return unit.parentElement === track ? unit : null;
    }

    function createRssUnit(document, templateUnit, article, onOpen) {
      const unit = templateUnit ? templateUnit.cloneNode(false) : document.createElement("div");
      unit.removeAttribute("id");
      unit.setAttribute("data-millennium-rss-unit", article.id);
      unit.setAttribute("data-millennium-rss-source", article.source);
      unit.setAttribute("data-millennium-rss-date-position", settings.datePosition);
      const date = document.createElement("div");
      date.className = "millennium-rss-card-date";
      date.textContent = formatArticleDate(article.timestamp);
      date.title = new Date(article.timestamp).toString();
      const card = document.createElement("div");
      card.className = "millennium-rss-card";
      card.setAttribute("data-millennium-rss-card", "");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      if (article.image) {
        const image = document.createElement("img");
        image.src = article.image;
        image.alt = "";
        image.loading = "lazy";
        card.appendChild(image);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "millennium-rss-card-fallback";
        card.appendChild(fallback);
      }
      const title = document.createElement("div");
      title.className = "millennium-rss-card-title";
      title.setAttribute("role", "button");
      title.setAttribute("tabindex", "0");
      title.textContent = article.title;
      const source = document.createElement("button");
      source.className = "millennium-rss-source-button";
      source.type = "button";
      source.title = article.source;
      source.textContent = article.source;
      const sourceRow = document.createElement("div");
      sourceRow.className = "millennium-rss-source-row";
      sourceRow.appendChild(source);
      const open = (event) => {
        if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(article);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", open);
      title.addEventListener("click", open);
      title.addEventListener("keydown", open);
      source.addEventListener("click", open);
      if (settings.datePosition === "above") unit.append(date, card, title, sourceRow);
      else if (settings.datePosition === "below-image") unit.append(card, date, title, sourceRow);
      else if (settings.datePosition === "below-title") unit.append(card, title, date, sourceRow);
      else if (settings.datePosition === "below-source") unit.append(card, title, sourceRow, date);
      else {
        sourceRow.appendChild(date);
        unit.append(card, title, sourceRow);
      }
      return unit;
    }

    function orderedUnits(nativeUnits, rssUnits, mode, rssPerSteam) {
      if (!rssUnits.length) return nativeUnits;
      if (mode === "alternating") {
        const result = [];
        let rssIndex = 0;
        nativeUnits.forEach((unit) => {
          result.push(unit);
          for (let index = 0; index < rssPerSteam && rssIndex < rssUnits.length; index++) {
            result.push(rssUnits[rssIndex++]);
          }
        });
        return [...result, ...rssUnits.slice(rssIndex)];
      }
      return [...nativeUnits, ...rssUnits];
    }

    function removeDuplicateIds(root) {
      if (root.id) root.removeAttribute("id");
      root.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    }

    function nodePath(node, root) {
      const path = [];
      let current = node;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) return [];
        path.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return path;
    }

    function followPath(root, path) {
      let current = root;
      for (const index of path) {
        current = current?.children[index];
        if (!current) return root;
      }
      return current;
    }

    function openArticleArchive(document, units, rssArticles = []) {
      document.querySelector("[data-millennium-archive-modal]")?.remove();
      const originals = units.filter((unit) => unit?.isConnected);
      const totalCount = originals.length + rssArticles.length;
      const modal = document.createElement("div");
      modal.className = "millennium-archive-modal";
      modal.setAttribute("data-millennium-archive-modal", "");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      const panel = document.createElement("section");
      panel.className = "millennium-archive-panel";
      const close = document.createElement("button");
      close.className = "millennium-rss-modal-close";
      close.type = "button";
      close.setAttribute("aria-label", "Close all articles");
      close.textContent = "\u00d7";
      const header = document.createElement("header");
      header.className = "millennium-archive-header";
      const title = document.createElement("h1");
      title.textContent = "What's New - All Articles";
      const count = document.createElement("div");
      count.textContent = `${totalCount} Steam and RSS article${totalCount === 1 ? "" : "s"}`;
      header.append(title, count);
      const grid = document.createElement("div");
      grid.className = "millennium-archive-grid";
      if (!totalCount) {
        const empty = document.createElement("div");
        empty.className = "millennium-archive-empty";
        empty.textContent = "No articles are currently available.";
        grid.appendChild(empty);
      } else {
        originals.forEach((original) => {
          const wrapper = document.createElement("div");
          wrapper.className = "millennium-archive-item";
          const clone = original.cloneNode(true);
          clone.querySelectorAll("[data-millennium-ticker-clone]").forEach((element) => element.remove());
          clone.removeAttribute("aria-hidden");
          removeDuplicateIds(clone);
          wrapper.appendChild(clone);
          wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = followPath(original, nodePath(event.target, clone));
            dismiss();
            target.dispatchEvent(new document.defaultView.MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY
            }));
          });
          grid.appendChild(wrapper);
        });
        rssArticles.forEach((article) => {
          const wrapper = document.createElement("div");
          wrapper.className = "millennium-archive-item";
          const unit = createRssUnit(document, null, article, (selectedArticle) => {
            dismiss();
            openRssArticle(document, selectedArticle);
          });
          unit.setAttribute("data-millennium-ticker-unit", "");
          wrapper.appendChild(unit);
          grid.appendChild(wrapper);
        });
      }
      panel.append(close, header, grid);
      modal.appendChild(panel);
      const dismiss = () => {
        modal.remove();
        document.removeEventListener("keydown", onKeyDown, true);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") dismiss();
      };
      close.addEventListener("click", dismiss);
      modal.addEventListener("click", (event) => {
        if (event.target === modal) dismiss();
      });
      document.addEventListener("keydown", onKeyDown, true);
      document.body.appendChild(modal);
      close.focus();
    }

    function createRssShelfItem(document, article, onOpen) {
      const item = document.createElement("article");
      item.className = "millennium-rss-shelf-item";
      item.setAttribute("data-millennium-rss-date-position", settings.datePosition);
      const date = document.createElement("div");
      date.className = "millennium-rss-card-date";
      date.textContent = formatArticleDate(article.timestamp);
      const card = document.createElement("div");
      card.className = "millennium-rss-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      if (article.image) {
        const image = document.createElement("img");
        image.src = article.image;
        image.alt = "";
        image.loading = "lazy";
        card.appendChild(image);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "millennium-rss-card-fallback";
        card.appendChild(fallback);
      }
      const title = document.createElement("div");
      title.className = "millennium-rss-card-title";
      title.setAttribute("role", "button");
      title.setAttribute("tabindex", "0");
      title.textContent = article.title;
      const source = document.createElement("button");
      source.className = "millennium-rss-source-button";
      source.type = "button";
      source.textContent = article.source;
      const sourceRow = document.createElement("div");
      sourceRow.className = "millennium-rss-source-row";
      sourceRow.appendChild(source);
      const open = (event) => {
        if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(article);
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", open);
      title.addEventListener("click", open);
      title.addEventListener("keydown", open);
      source.addEventListener("click", open);
      if (settings.datePosition === "above") item.append(date, card, title, sourceRow);
      else if (settings.datePosition === "below-image") item.append(card, date, title, sourceRow);
      else if (settings.datePosition === "below-title") item.append(card, title, date, sourceRow);
      else if (settings.datePosition === "below-source") item.append(card, title, sourceRow, date);
      else {
        sourceRow.appendChild(date);
        item.append(card, title, sourceRow);
      }
      return item;
    }

    function modalIsOpen(document) {
      const selectors = [
        "[role='dialog']",
        ".ModalOverlayContent.active",
        ".ModalPosition",
        "[class*='ModalOverlay']",
        "[class*='EventDetail']",
        "[class*='eventdetail']",
        "[class*='EventDetails']"
      ];
      return [...document.querySelectorAll(selectors.join(","))].some(isVisible);
    }

    class TickerController {
      constructor(popup) {
        this.popup = popup;
        this.window = popup.window || popup.m_popup?.window || popup;
        this.document = this.window?.document || popup.document || popup.m_popup?.document;
        this.speed = settings.speed;
        this.manualResumeDelay = settings.manualResumeDelay;
        this.offset = 0;
        this.span = 0;
        this.pageNextAt = 0;
        this.pageResetAt = 0;
        this.trackTransitionAnimated = null;
        this.track = null;
        this.viewport = null;
        this.originalTrackStyle = "";
        this.originalViewportStyle = "";
        this.lastFrame = 0;
        this.raf = 0;
        this.destroyed = false;
        this.scanTimer = 0;
        this.resizeObserver = null;
        this.section = null;
        this.manualUntil = 0;
        this.articleOpen = false;
        this.articleOverlaySeen = false;
        this.forwardingCloneClick = false;
        this.lastLibrarySection = null;
        this.lastLibraryRefresh = 0;
        this.currentUnits = [];
        this.archiveButton = null;
        this.rowControls = null;
        this.rssRows = [];
        this.rssShelfLastFrame = 0;
        this.onVisibilityChange = () => {
          this.lastFrame = 0;
          this.rssShelfLastFrame = 0;
        };
        this.onDocumentClick = (event) => {
          if (this.forwardingCloneClick) return;

          const arrow = event.target.closest(
            ".bsNegRKT1Hbv4tqHrOk9- button,._14b-hQsLwSwYcELtknxCUX,._3IIEUTw03Vm3Mk54jlnUaT"
          );
          if (arrow && !event.target.closest(".millennium-archive-button,.millennium-row-control")) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.pageCombinedTrack(this.navigationDirection(arrow));
            return;
          }

          if (this.articleOpen) {
            this.window.setTimeout(() => {
              this.articleOpen = false;
              this.articleOverlaySeen = false;
              if (settings.refreshOnArticleClose) refreshFeeds("article closed");
            }, 150);
            return;
          }

          const section = findSection(this.document);
          if (!section || !section.contains(event.target)) return;

          const article = event.target.closest(
            "[data-millennium-ticker-unit],.B-vCdL38RiJlhfSRgZv78"
          );
          const articleControl = event.target.closest(
            "._2-p7shAZYrRijpaTU9bAFR,[aria-haspopup='menu'],[aria-label*='option' i]"
          );
          if (article && !articleControl) {
            this.articleOpen = true;
            this.articleOverlaySeen = false;
          }
        };
        this.onKeyDown = (event) => {
          if (event.key === "Escape" && this.articleOpen) {
            this.window.setTimeout(() => {
              if (!modalIsOpen(this.document)) {
                this.articleOpen = false;
                this.articleOverlaySeen = false;
              }
            }, 100);
          }
        };
      }

      start() {
        if (!this.document?.documentElement) return;
        injectStyles(this.document);
        this.document.addEventListener("visibilitychange", this.onVisibilityChange);
        this.document.addEventListener("click", this.onDocumentClick, true);
        this.document.addEventListener("keydown", this.onKeyDown, true);
        this.scan();
        this.scanTimer = this.window.setInterval(() => this.scan(), 1500);
        this.raf = this.window.requestAnimationFrame((time) => this.animate(time));
      }

      setSettings(nextSettings) {
        this.speed = clampSpeed(nextSettings.speed);
        this.manualResumeDelay = clampResumeDelay(nextSettings.manualResumeDelay);
        this.teardownTrack();
        this.renderRssShelf();
        this.scan();
      }

      onRssUpdated() {
        this.teardownTrack();
        this.renderRssShelf();
        this.scan();
      }

      addRssRow(feedUrl, sourceType = feedUrl ? "feed" : "mixed-all") {
        const row = {
          id: `rss-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          feedUrl,
          sourceType
        };
        saveSettings({ rssRows: [...settings.rssRows, row] });
      }

      removeRssRow(rowId) {
        saveSettings({ rssRows: settings.rssRows.filter((row) => row.id !== rowId) });
      }

      rssRowLabel(row, index) {
        if (row.sourceType === "mixed-youtube") return `Mixed YouTube RSS row ${index + 1}`;
        if (row.sourceType === "mixed-non-youtube") return `Mixed non-YouTube RSS row ${index + 1}`;
        if (!row.feedUrl) return `Mixed all sources RSS row ${index + 1}`;
        const feed = settings.rssFeeds.find((candidate) => candidate.url === row.feedUrl);
        let source = feed?.title;
        if (!source) {
          try {
            source = new URL(row.feedUrl).hostname;
          } catch {
            source = "Configured source";
          }
        }
        return `${source} RSS row`;
      }

      openRssRowPicker() {
        this.document.querySelector("[data-millennium-row-picker]")?.remove();
        const modal = this.document.createElement("div");
        modal.className = "millennium-row-picker";
        modal.setAttribute("data-millennium-row-picker", "");
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        const panel = this.document.createElement("div");
        panel.className = "millennium-row-picker-panel";
        const title = this.document.createElement("h2");
        title.textContent = "Add RSS row";
        const description = this.document.createElement("p");
        description.textContent = "Choose all RSS sources or one configured source for this row.";
        const options = this.document.createElement("div");
        options.className = "millennium-row-picker-options";
        const addOption = (label, feedUrl, sourceType) => {
          const button = this.document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.addEventListener("click", () => {
            modal.remove();
            this.addRssRow(feedUrl, sourceType);
          });
          options.appendChild(button);
        };
        addOption("Mixed - all RSS sources", "", "mixed-all");
        addOption("Mixed - non-YouTube sources only", "", "mixed-non-youtube");
        addOption("Mixed - YouTube sources only", "", "mixed-youtube");
        settings.rssFeeds.forEach((feed) => {
          addOption(feed.title || new URL(feed.url).hostname, feed.url, "feed");
        });
        const dismiss = () => modal.remove();
        modal.addEventListener("click", (event) => {
          if (event.target === modal) dismiss();
        });
        modal.addEventListener("keydown", (event) => {
          if (event.key === "Escape") dismiss();
        });
        panel.append(title, description, options);
        modal.appendChild(panel);
        this.document.body.appendChild(modal);
        options.querySelector("button")?.focus();
      }

      openRssRowRemovalPicker() {
        if (!settings.rssRows.length) return;
        this.document.querySelector("[data-millennium-row-picker]")?.remove();
        const modal = this.document.createElement("div");
        modal.className = "millennium-row-picker";
        modal.setAttribute("data-millennium-row-picker", "");
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        const panel = this.document.createElement("div");
        panel.className = "millennium-row-picker-panel";
        const title = this.document.createElement("h2");
        title.textContent = "Remove RSS row";
        const description = this.document.createElement("p");
        description.textContent = "Choose which configured RSS row to remove.";
        const options = this.document.createElement("div");
        options.className = "millennium-row-picker-options";
        settings.rssRows.forEach((row, index) => {
          const button = this.document.createElement("button");
          button.type = "button";
          button.textContent = this.rssRowLabel(row, index);
          button.addEventListener("click", () => {
            modal.remove();
            this.removeRssRow(row.id);
          });
          options.appendChild(button);
        });
        const dismiss = () => modal.remove();
        modal.addEventListener("click", (event) => {
          if (event.target === modal) dismiss();
        });
        modal.addEventListener("keydown", (event) => {
          if (event.key === "Escape") dismiss();
        });
        panel.append(title, description, options);
        modal.appendChild(panel);
        this.document.body.appendChild(modal);
        options.querySelector("button")?.focus();
      }

      articlesForRssRows() {
        const rows = settings.rssRows.map(() => []);
        const allArticles = allRssArticles();
        ["mixed-all", "mixed-non-youtube", "mixed-youtube"].forEach((sourceType) => {
          const mixedIndexes = settings.rssRows
            .map((row, index) => row.sourceType === sourceType ? index : -1)
            .filter((index) => index >= 0);
          if (!mixedIndexes.length) return;
          articlesForRowType(sourceType).slice(0, settings.rssArticleLimit).forEach((article, index) => {
            rows[mixedIndexes[index % mixedIndexes.length]].push(article);
          });
        });
        settings.rssRows.forEach((row, index) => {
          if (row.sourceType === "feed" && row.feedUrl) {
            rows[index] = allArticles
              .filter((article) => article.feedUrl === row.feedUrl)
              .slice(0, settings.rssArticleLimit);
          }
        });
        return rows;
      }

      renderRssShelf() {
        this.teardownRssShelf();
        this.updateRowControls();
        if (!settings.rssRows.length) return;
        const addShelfRow = this.document.querySelector("._3SkuN_ykQuWGF94fclHdhJ");
        const whatsNewSection = findSection(this.document);
        const parent = addShelfRow?.parentElement || whatsNewSection?.parentElement;
        const anchor = addShelfRow || whatsNewSection?.nextSibling || null;
        if (!parent) return;

        const section = whatsNewSection || findSection(this.document);
        const cards = section ? findCards(section) : [];
        const nativeTrack = cards.length ? lowestCommonAncestor(cards, section) : null;
        const templateUnit =
          this.currentUnits.find((unit) => unit?.isConnected && !unit.hasAttribute("data-millennium-ticker-clone")) ||
          (nativeTrack ? directUnit(cards[0], nativeTrack) : null);
        const templateRect = templateUnit?.getBoundingClientRect();
        const templateWidth = templateRect?.width;
        const templateHeight = templateRect?.height;
        const rowWidth = settings.manualArticleSizeEnabled
          ? settings.rowArticleWidth
          : (Number.isFinite(templateWidth) && templateWidth > 0 ? templateWidth : 260);
        const rowHeight = settings.manualArticleSizeEnabled
          ? settings.rowArticleHeight
          : (Number.isFinite(templateHeight) && templateHeight > 0 ? templateHeight : Math.round(rowWidth * 9 / 16));
        const rowArticles = this.articlesForRssRows();

        settings.rssRows.forEach((rowConfig, rowIndex) => {
          const shelf = this.document.createElement("section");
          shelf.className = "millennium-rss-shelf";
          shelf.setAttribute("data-millennium-rss-shelf", rowConfig.id);
          shelf.setAttribute(
            "data-millennium-manual-article-size",
            settings.manualArticleSizeEnabled ? "true" : "false"
          );
          shelf.style.setProperty(
            "--millennium-rss-shelf-item-width",
            `${rowWidth}px`
          );
          shelf.style.setProperty(
            "--millennium-rss-shelf-item-height",
            `${rowHeight}px`
          );
          const viewport = this.document.createElement("div");
          viewport.className = "millennium-rss-shelf-viewport";
          const track = this.document.createElement("div");
          track.className = "millennium-rss-shelf-track";
          track.setAttribute("data-millennium-rss-shelf-track", "");
          const articles = rowArticles[rowIndex];
          if (!articles.length) {
            const empty = this.document.createElement("div");
            empty.className = "millennium-rss-shelf-empty";
            empty.textContent = settings.rssFeeds.length
              ? "No RSS articles are currently available for this row."
              : "Add an RSS feed in What's New RSS Ticker settings.";
            track.appendChild(empty);
          }
          articles.forEach((article) => {
            const unit = createRssUnit(this.document, templateUnit, article, (selectedArticle) => {
              this.articleOpen = true;
              this.articleOverlaySeen = true;
              openRssArticle(this.document, selectedArticle, () => {
                this.articleOpen = false;
                this.articleOverlaySeen = false;
                if (settings.refreshOnArticleClose) refreshFeeds("RSS article closed");
              });
            });
            unit.setAttribute("data-millennium-rss-shelf-unit", "");
            track.appendChild(unit);
          });
          viewport.appendChild(track);
          shelf.appendChild(viewport);
          parent.insertBefore(shelf, anchor);
          const state = {
            shelf,
            track,
            viewport,
            resizeObserver: null,
            offset: 0,
            span: 0,
            pageNextAt: 0,
            pageResetAt: 0,
            trackTransitionAnimated: null,
            currentUnits: [...track.children].filter(
              (unit) => unit.hasAttribute("data-millennium-rss-shelf-unit")
            )
          };
          state.currentUnits.forEach((unit, index) => {
            unit.setAttribute("data-millennium-ticker-unit", "");
            const clone = unit.cloneNode(true);
            clone.setAttribute("data-millennium-ticker-unit", "");
            clone.setAttribute("data-millennium-ticker-clone", "");
            clone.setAttribute("aria-hidden", "true");
            removeDuplicateIds(clone);
            clone.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              const target = followPath(state.currentUnits[index], nodePath(event.target, clone));
              this.forwardingCloneClick = true;
              try {
                target.dispatchEvent(new this.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  button: event.button,
                  clientX: event.clientX,
                  clientY: event.clientY
                }));
              } finally {
                this.forwardingCloneClick = false;
              }
            });
            track.appendChild(clone);
          });
          viewport.setAttribute("data-millennium-rss-shelf-viewport", "");
          track.setAttribute("data-millennium-ticker-track", "");
          this.rssRows.push(state);
          this.measureRssShelf(state);
          state.resizeObserver = new this.window.ResizeObserver(() => this.measureRssShelf(state));
          state.resizeObserver.observe(viewport);
          state.resizeObserver.observe(track);
        });
      }

      ensureRowControls(archiveButton) {
        if (this.rowControls?.isConnected) {
          this.updateRowControls();
          return;
        }
        const controls = this.document.createElement("span");
        controls.className = "millennium-row-controls";
        const remove = this.document.createElement("button");
        remove.className = "millennium-row-control";
        remove.type = "button";
        remove.textContent = "\u2212";
        remove.title = "Remove RSS row";
        remove.setAttribute("aria-label", "Remove RSS row");
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openRssRowRemovalPicker();
        });
        const add = this.document.createElement("button");
        add.className = "millennium-row-control";
        add.type = "button";
        add.textContent = "+";
        add.title = "Add RSS row";
        add.setAttribute("aria-label", "Add RSS row");
        add.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openRssRowPicker();
        });
        controls.append(remove, add);
        archiveButton.insertAdjacentElement("beforebegin", controls);
        this.rowControls = controls;
        this.updateRowControls();
      }

      updateRowControls() {
        const remove = this.rowControls?.querySelector("[aria-label='Remove RSS row']");
        if (remove) remove.disabled = settings.rssRows.length === 0;
      }

      ensureArchiveButton(section) {
        if (this.archiveButton?.isConnected) {
          this.ensureRowControls(this.archiveButton);
          return;
        }
        const button = this.document.createElement("button");
        button.className = "millennium-archive-button";
        button.type = "button";
        button.setAttribute("aria-label", "View all What's New articles");
        button.title = "View all Steam and RSS articles";
        button.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 3h13a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm0 2v13a1 1 0 0 0 2 0V5H4Zm4 0v14h12V8h-3V5H8Zm2 2h5v4h-5V7Zm0 6h8v2h-8v-2Zm0 4h8v2h-8v-2Z"/>
          </svg>
        `;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const liveUnits = this.currentUnits.filter((unit) => unit?.isConnected);
          const fallbackUnits = this.track
            ? [...this.track.children].filter(
                (unit) => !unit.hasAttribute("data-millennium-ticker-clone")
              )
            : [];
          const visibleUnits = (liveUnits.length ? liveUnits : fallbackUnits).filter(
            (unit) => !unit.hasAttribute("data-millennium-rss-unit")
          );
          openArticleArchive(this.document, visibleUnits, allRssArticles());
        });

        const arrowSelector =
          ".bsNegRKT1Hbv4tqHrOk9- button,._14b-hQsLwSwYcELtknxCUX,._3IIEUTw03Vm3Mk54jlnUaT";
        const firstArrow = section.querySelector(arrowSelector);
        if (firstArrow?.parentElement) {
          firstArrow.parentElement.insertBefore(button, firstArrow);
          this.archiveButton = button;
          this.ensureRowControls(button);
          return;
        }

        const heading = findSectionHeading(section);
        if (!heading) return;
        let container = heading.parentElement;
        let settingsButton = null;
        const headingRect = heading.getBoundingClientRect();
        for (let depth = 0; container && section.contains(container) && depth < 4; depth++) {
          const buttons = [...container.querySelectorAll("button")].filter(
            (candidate) => {
              const rect = candidate.getBoundingClientRect();
              return (
                !candidate.classList.contains("millennium-archive-button") &&
                !candidate.closest("[data-millennium-ticker-unit],.B-vCdL38RiJlhfSRgZv78") &&
                Math.abs(rect.top - headingRect.top) < 50
              );
            }
          );
          settingsButton = buttons.find((candidate) => {
            const label = `${candidate.getAttribute("aria-label") || ""} ${candidate.title || ""}`.toLowerCase();
            return /setting|option|filter|customi[sz]e/.test(label);
          }) || buttons[buttons.length - 1] || null;
          if (settingsButton) break;
          container = container.parentElement;
        }
        if (settingsButton?.parentElement) settingsButton.insertAdjacentElement("afterend", button);
        else heading.insertAdjacentElement("afterend", button);
        this.archiveButton = button;
        this.ensureRowControls(button);
      }

      prepareCombinedArrows(section) {
        const selector =
          ".bsNegRKT1Hbv4tqHrOk9- button,._14b-hQsLwSwYcELtknxCUX,._3IIEUTw03Vm3Mk54jlnUaT";
        section.querySelectorAll(selector).forEach((arrow) => {
          if (
            arrow.classList.contains("millennium-archive-button") ||
            arrow.classList.contains("millennium-row-control")
          ) return;
          arrow.classList.remove("_16nHYucq6xgfe67DrVWLCI");
          if ("disabled" in arrow) arrow.disabled = false;
          arrow.setAttribute("aria-disabled", "false");
          arrow.style.setProperty("pointer-events", "auto", "important");
          arrow.style.setProperty("opacity", "1", "important");
          arrow.style.setProperty("filter", "none", "important");
        });
      }

      navigationDirection(arrow) {
        const label = `${arrow.getAttribute("aria-label") || ""} ${arrow.title || ""}`.toLowerCase();
        if (/previous|prev|left|back/.test(label)) return -1;
        if (/next|right|forward/.test(label)) return 1;
        const selector =
          ".bsNegRKT1Hbv4tqHrOk9- button,._14b-hQsLwSwYcELtknxCUX,._3IIEUTw03Vm3Mk54jlnUaT";
        const arrows = [...new Set([...(this.section?.querySelectorAll(selector) || [])])]
          .filter(
            (candidate) =>
              isVisible(candidate) &&
              !candidate.classList.contains("millennium-archive-button") &&
              !candidate.classList.contains("millennium-row-control")
          )
          .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
        return arrows.indexOf(arrow) <= 0 ? -1 : 1;
      }

      pageCombinedTrack(direction) {
        if (!this.track?.isConnected || !this.viewport?.isConnected) return;
        this.measure();
        this.rssRows.forEach((state) => this.measureRssShelf(state));
        const resumeAt = this.window.performance.now() + this.manualResumeDelay * 1000;
        [this, ...this.rssRows].forEach((state) => {
          this.pageTrack(state, direction);
          state.pageNextAt = resumeAt + settings.pageIntervalSeconds * 1000;
        });
        this.manualUntil = resumeAt;
      }

      pageTrack(state, direction) {
        if (!state.track?.isConnected || !state.viewport?.isConnected) return;
        const pageWidth = this.pageDistance(state);
        const maxOffset = Math.max(0, state.span - state.viewport.clientWidth);
        state.offset = Math.max(0, Math.min(maxOffset, state.offset + direction * pageWidth));
        state.pageResetAt = 0;
        this.setTrackOffset(state, state.offset, true);
      }

      setTrackOffset(state, offset, animate = false) {
        if (state.trackTransitionAnimated !== animate) {
          state.track.style.setProperty(
            "transition",
            animate ? "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
            "important"
          );
          state.trackTransitionAnimated = animate;
        }
        state.track.style.setProperty("transform", `translate3d(${-offset}px, 0, 0)`, "important");
      }

      pageDistance(state) {
        const originals = [...state.track.children].filter(
          (element) => !element.hasAttribute("data-millennium-ticker-clone")
        );
        if (!originals.length) return Math.max(1, state.viewport.clientWidth);
        const first = originals[0].getBoundingClientRect();
        const trackStyle = this.window.getComputedStyle(state.track);
        const gap = parseFloat(trackStyle.columnGap || trackStyle.gap) || 0;
        const stride = Math.max(1, first.width + gap);
        const visibleCount = Math.max(1, Math.floor((state.viewport.clientWidth + gap) / stride));
        return visibleCount * stride;
      }

      advancePagedTrack(state, time) {
        if (state.span <= state.viewport.clientWidth) return;
        if (state.pageResetAt && time >= state.pageResetAt) {
          state.offset %= state.span;
          state.pageResetAt = 0;
          this.setTrackOffset(state, state.offset);
        }
        if (!state.pageNextAt) {
          state.pageNextAt = time + settings.pageIntervalSeconds * 1000;
          return;
        }
        if (time < state.pageNextAt || state.pageResetAt) return;
        state.offset += this.pageDistance(state);
        this.setTrackOffset(state, state.offset, true);
        if (state.offset >= state.span) state.pageResetAt = time + 500;
        state.pageNextAt = time + settings.pageIntervalSeconds * 1000;
      }

      measureRssShelf(state) {
        if (!state?.track?.isConnected || !state.viewport?.isConnected) return;
        const originals = [...state.track.children].filter(
          (element) =>
            element.hasAttribute("data-millennium-rss-shelf-unit") &&
            !element.hasAttribute("data-millennium-ticker-clone")
        );
        if (!originals.length) return;
        const first = originals[0].getBoundingClientRect();
        const last = originals[originals.length - 1].getBoundingClientRect();
        const trackStyle = this.window.getComputedStyle(state.track);
        const gap = parseFloat(trackStyle.columnGap || trackStyle.gap) || 0;
        state.span = Math.max(0, last.right - first.left + gap);
        this.setTrackOffset(state, state.offset);
      }

      animateRssShelf(time, delta) {
        this.rssRows.forEach((state) => {
          if (!state.track?.isConnected || !state.viewport?.isConnected) return;
          const paused =
            this.document.hidden ||
            modalIsOpen(this.document) ||
            this.articleOpen ||
            time < this.manualUntil ||
            state.span <= 0;
          if (!paused && settings.scrollMode === "continuous") {
            state.offset = (state.offset + (this.speed * delta) / 1000) % state.span;
            this.setTrackOffset(state, state.offset);
          } else if (!paused) {
            this.advancePagedTrack(state, time);
          }
        });
      }

      scan() {
        if (this.destroyed) return;
        if (
          settings.rssRows.length &&
          (this.rssRows.length !== settings.rssRows.length ||
            this.rssRows.some((state) => !state.shelf?.isConnected))
        ) {
          this.renderRssShelf();
        }
        if (this.window.performance.now() < this.manualUntil) return;
        if (this.track && this.track.isConnected && this.track.querySelector("[data-millennium-ticker-clone]")) {
          if (this.section) {
            this.ensureArchiveButton(this.section);
            this.prepareCombinedArrows(this.section);
          }
          this.measure();
          return;
        }

        this.teardownTrack();
        const section = findSection(this.document);
        if (!section) {
          this.lastLibrarySection = null;
          return;
        }
        this.ensureArchiveButton(section);
        this.prepareCombinedArrows(section);
        if (
          settings.refreshOnLibrary &&
          settings.rssFeeds.length &&
          section !== this.lastLibrarySection &&
          Date.now() - this.lastLibraryRefresh > 10000
        ) {
          this.lastLibrarySection = section;
          this.lastLibraryRefresh = Date.now();
          refreshFeeds("Library section refreshed");
        }
        const cards = findCards(section);
        if (cards.length < 2) return;

        const track = lowestCommonAncestor(cards, section);
        if (!track || track === section) return;
        const nativeUnits = [...new Set(cards.map((card) => directUnit(card, track)).filter(Boolean))];
        if (nativeUnits.length < 2 || nativeUnits.length > 50) return;
        track.querySelectorAll(":scope > [data-millennium-rss-unit]").forEach((unit) => unit.remove());
        const templateUnit = nativeUnits[0];
        const tickerRssArticles = settings.orderingMode === "rss-shelf-only"
          ? []
          : mixedRssArticles().slice(0, settings.rssArticleLimit);
        const rssUnits = tickerRssArticles.map((article) => {
          const unit = createRssUnit(this.document, templateUnit, article, (selectedArticle) => {
            this.articleOpen = true;
            this.articleOverlaySeen = true;
            openRssArticle(this.document, selectedArticle, () => {
              this.articleOpen = false;
              this.articleOverlaySeen = false;
              if (settings.refreshOnArticleClose) refreshFeeds("RSS article closed");
            });
          });
          unit.setAttribute("data-millennium-rss-time", String(article.timestamp));
          return unit;
        });
        const units = orderedUnits(
          nativeUnits,
          rssUnits,
          settings.orderingMode,
          settings.rssPerSteam
        );
        units.forEach((unit) => track.appendChild(unit));
        this.currentUnits = units;

        const viewport = track.parentElement;
        if (!viewport) return;
        this.track = track;
        this.viewport = viewport;
        this.section = section;
        this.originalTrackStyle = track.getAttribute("style") || "";
        this.originalViewportStyle = viewport.getAttribute("style") || "";
        viewport.setAttribute("data-millennium-ticker-viewport", "");
        track.setAttribute("data-millennium-ticker-track", "");

        units.forEach((unit, index) => {
          unit.setAttribute("data-millennium-ticker-unit", "");
          const clone = unit.cloneNode(true);
          clone.setAttribute("data-millennium-ticker-unit", "");
          clone.setAttribute("data-millennium-ticker-clone", "");
          clone.setAttribute("aria-hidden", "true");
          removeDuplicateIds(clone);
          clone.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = followPath(units[index], nodePath(event.target, clone));
            this.forwardingCloneClick = true;
            try {
              target.dispatchEvent(new this.window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                button: event.button,
                clientX: event.clientX,
                clientY: event.clientY
              }));
            } finally {
              this.forwardingCloneClick = false;
            }
          });
          track.appendChild(clone);
        });

        this.offset = 0;
        this.pageNextAt = 0;
        this.pageResetAt = 0;
        this.trackTransitionAnimated = null;
        this.measure();
        this.resizeObserver = new this.window.ResizeObserver(() => this.measure());
        this.resizeObserver.observe(viewport);
        this.resizeObserver.observe(track);
      }

      measure() {
        if (!this.track) return;
        const originals = [...this.track.children].filter(
          (element) => !element.hasAttribute("data-millennium-ticker-clone")
        );
        if (!originals.length) return;
        const first = originals[0].getBoundingClientRect();
        const last = originals[originals.length - 1].getBoundingClientRect();
        const trackStyle = this.window.getComputedStyle(this.track);
        const gap = parseFloat(trackStyle.columnGap || trackStyle.gap) || 0;
        this.span = Math.max(0, last.right - first.left + gap);
      }

      animate(time) {
        if (this.destroyed) return;
        if (!this.lastFrame) this.lastFrame = time;
        const delta = Math.min(50, Math.max(0, time - this.lastFrame));
        this.lastFrame = time;

        const overlayOpen = modalIsOpen(this.document);
        if (this.articleOpen && overlayOpen) this.articleOverlaySeen = true;
        if (this.articleOpen && this.articleOverlaySeen && !overlayOpen) {
          this.articleOpen = false;
          this.articleOverlaySeen = false;
          if (settings.refreshOnArticleClose) refreshFeeds("article closed");
        }
        const paused =
          this.document.hidden ||
          overlayOpen ||
          this.articleOpen ||
          time < this.manualUntil ||
          !this.track ||
          !this.track.isConnected ||
          this.span <= 0;

        if (!paused && settings.scrollMode === "continuous") {
          this.offset = (this.offset + (this.speed * delta) / 1000) % this.span;
          this.setTrackOffset(this, this.offset);
        } else if (!paused) {
          this.advancePagedTrack(this, time);
        }

        this.animateRssShelf(time, delta);

        this.raf = this.window.requestAnimationFrame((nextTime) => this.animate(nextTime));
      }

      teardownTrack() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.track) {
          this.track.querySelectorAll("[data-millennium-ticker-clone]").forEach((clone) => clone.remove());
          this.track.querySelectorAll("[data-millennium-ticker-unit]").forEach(
            (unit) => unit.removeAttribute("data-millennium-ticker-unit")
          );
          this.track.querySelectorAll(":scope > [data-millennium-rss-unit]").forEach(
            (unit) => unit.remove()
          );
          this.track.removeAttribute("data-millennium-ticker-track");
          if (this.originalTrackStyle) this.track.setAttribute("style", this.originalTrackStyle);
          else this.track.removeAttribute("style");
        }
        if (this.viewport) {
          this.viewport.removeAttribute("data-millennium-ticker-viewport");
          if (this.originalViewportStyle) this.viewport.setAttribute("style", this.originalViewportStyle);
          else this.viewport.removeAttribute("style");
        }
        this.track = null;
        this.viewport = null;
        this.section = null;
        this.currentUnits = [];
        this.offset = 0;
        this.span = 0;
        this.pageNextAt = 0;
        this.pageResetAt = 0;
      }

      teardownRssShelf() {
        this.rssRows.forEach((state) => {
          state.resizeObserver?.disconnect();
          state.shelf?.remove();
        });
        this.rssRows = [];
      }

      destroy() {
        this.destroyed = true;
        this.window.clearInterval(this.scanTimer);
        this.window.cancelAnimationFrame(this.raf);
        this.document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.document.removeEventListener("click", this.onDocumentClick, true);
        this.document.removeEventListener("keydown", this.onKeyDown, true);
        this.teardownTrack();
        this.teardownRssShelf();
        this.archiveButton?.remove();
        this.archiveButton = null;
        this.rowControls?.remove();
        this.rowControls = null;
        this.document.querySelector("[data-millennium-row-picker]")?.remove();
      }
    }

    function attachPopup(popup) {
      const windowObject = popup?.window || popup?.m_popup?.window || popup;
      const name = popup?.m_strName || windowObject?.name || "";
      if (!windowObject?.document) return;
      if (name && /contextmenu|popup/i.test(name)) return;
      if (name && !name.startsWith("SP Desktop_")) return;
      if (controllers.has(windowObject)) return;
      const controller = new TickerController(popup);
      controllers.set(windowObject, controller);
      controller.start();
      windowObject.addEventListener("unload", () => {
        controller.destroy();
        controllers.delete(windowObject);
      }, { once: true });
    }

    function findExistingDesktopPopup() {
      try {
        return globalThis.g_PopupManager?.GetExistingPopup?.("SP Desktop_uid0");
      } catch {
        return null;
      }
    }

    function SettingsPanel() {
      const [speed, setSpeed] = React.useState(settings.speed);
      const [manualResumeDelay, setManualResumeDelay] = React.useState(settings.manualResumeDelay);
      const [scrollMode, setScrollMode] = React.useState(settings.scrollMode);
      const [pageIntervalSeconds, setPageIntervalSeconds] = React.useState(settings.pageIntervalSeconds);
      const [feeds, setFeeds] = React.useState(settings.rssFeeds);
      const [feedUrl, setFeedUrl] = React.useState("");
      const [youtubeChannelMode, setYoutubeChannelMode] = React.useState(
        commonYoutubeChannelMode(settings.rssFeeds)
      );
      const [feedMessage, setFeedMessage] = React.useState("");
      const [orderingMode, setOrderingMode] = React.useState(settings.orderingMode);
      const [rssPerSteam, setRssPerSteam] = React.useState(settings.rssPerSteam);
      const [rssArticleLimit, setRssArticleLimit] = React.useState(settings.rssArticleLimit);
      const [combineYoutubeFeedsAsOneSource, setCombineYoutubeFeedsAsOneSource] = React.useState(
        settings.combineYoutubeFeedsAsOneSource
      );
      const [manualArticleSizeEnabled, setManualArticleSizeEnabled] = React.useState(
        settings.manualArticleSizeEnabled
      );
      const [rowArticleWidth, setRowArticleWidth] = React.useState(settings.rowArticleWidth);
      const [rowArticleHeight, setRowArticleHeight] = React.useState(settings.rowArticleHeight);
      const [openedArticleWidth, setOpenedArticleWidth] = React.useState(settings.openedArticleWidth);
      const [openedArticleHeight, setOpenedArticleHeight] = React.useState(settings.openedArticleHeight);
      const [rowArticleWidthInput, setRowArticleWidthInput] = React.useState(String(settings.rowArticleWidth));
      const [rowArticleHeightInput, setRowArticleHeightInput] = React.useState(String(settings.rowArticleHeight));
      const [openedArticleWidthInput, setOpenedArticleWidthInput] = React.useState(String(settings.openedArticleWidth));
      const [openedArticleHeightInput, setOpenedArticleHeightInput] = React.useState(String(settings.openedArticleHeight));
      const [refreshOnLibrary, setRefreshOnLibrary] = React.useState(settings.refreshOnLibrary);
      const [refreshOnArticleClose, setRefreshOnArticleClose] = React.useState(
        settings.refreshOnArticleClose
      );
      const [refreshIntervalMinutes, setRefreshIntervalMinutes] = React.useState(
        settings.refreshIntervalMinutes
      );
      const [dateLocale, setDateLocale] = React.useState(settings.dateLocale);
      const [dateStyle, setDateStyle] = React.useState(settings.dateStyle);
      const [weekdayStyle, setWeekdayStyle] = React.useState(settings.weekdayStyle);
      const [hourCycle, setHourCycle] = React.useState(settings.hourCycle);
      const [datePosition, setDatePosition] = React.useState(settings.datePosition);
      React.useEffect(() => {
        const listener = (nextSettings) => {
          setSpeed(nextSettings.speed);
          setManualResumeDelay(nextSettings.manualResumeDelay);
          setScrollMode(nextSettings.scrollMode);
          setPageIntervalSeconds(nextSettings.pageIntervalSeconds);
          setFeeds([...nextSettings.rssFeeds]);
          setYoutubeChannelMode(commonYoutubeChannelMode(nextSettings.rssFeeds));
          setOrderingMode(nextSettings.orderingMode);
          setRssPerSteam(nextSettings.rssPerSteam);
          setRssArticleLimit(nextSettings.rssArticleLimit);
          setCombineYoutubeFeedsAsOneSource(nextSettings.combineYoutubeFeedsAsOneSource);
          setManualArticleSizeEnabled(nextSettings.manualArticleSizeEnabled);
          setRowArticleWidth(nextSettings.rowArticleWidth);
          setRowArticleHeight(nextSettings.rowArticleHeight);
          setOpenedArticleWidth(nextSettings.openedArticleWidth);
          setOpenedArticleHeight(nextSettings.openedArticleHeight);
          setRowArticleWidthInput(String(nextSettings.rowArticleWidth));
          setRowArticleHeightInput(String(nextSettings.rowArticleHeight));
          setOpenedArticleWidthInput(String(nextSettings.openedArticleWidth));
          setOpenedArticleHeightInput(String(nextSettings.openedArticleHeight));
          setRefreshOnLibrary(nextSettings.refreshOnLibrary);
          setRefreshOnArticleClose(nextSettings.refreshOnArticleClose);
          setRefreshIntervalMinutes(nextSettings.refreshIntervalMinutes);
          setDateLocale(nextSettings.dateLocale);
          setDateStyle(nextSettings.dateStyle);
          setWeekdayStyle(nextSettings.weekdayStyle);
          setHourCycle(nextSettings.hourCycle);
          setDatePosition(nextSettings.datePosition);
        };
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      }, []);
      const onSpeedChange = (event) => {
        const value = clampSpeed(event.currentTarget.value);
        setSpeed(value);
        saveSettings({ speed: value });
      };
      const onDelayChange = (event) => {
        const value = clampResumeDelay(event.currentTarget.value);
        setManualResumeDelay(value);
        saveSettings({ manualResumeDelay: value });
      };
      const changeScrollMode = (event) => {
        const value = event.currentTarget.value;
        setScrollMode(value);
        saveSettings({ scrollMode: value });
      };
      const changePageInterval = (event) => {
        const value = clampPageInterval(event.currentTarget.value);
        setPageIntervalSeconds(value);
        saveSettings({ pageIntervalSeconds: value });
      };
      const addFeed = async () => {
        let normalized = null;
        try {
          normalized = await normalizeFeedInput(feedUrl, youtubeChannelMode);
        } catch (error) {
          setFeedMessage(`Could not resolve feed URL: ${error?.message || String(error)}`);
          return;
        }
        if (!normalized) {
          setFeedMessage("Enter a valid HTTP, HTTPS, RSS, Atom, YouTube playlist, or YouTube channel URL.");
          return;
        }
        if (settings.rssFeeds.some((feed) => feed.url === normalized.url)) {
          setFeedMessage("That feed has already been added.");
          return;
        }
        setFeedMessage("Loading feed...");
        const loaded = await fetchFeed(normalized);
        if (loaded.error) {
          delete rssCache[normalized.url];
          saveRssCache();
          setFeedMessage(loaded.error);
          return;
        }
        saveSettings({ rssFeeds: [...settings.rssFeeds, loaded] });
        saveRssCache();
        notifyControllers();
        setFeedUrl("");
        setFeedMessage("Feed added.");
      };
      const removeFeed = (url) => {
        const nextFeeds = settings.rssFeeds.filter((feed) => feed.url !== url);
        delete rssCache[url];
        saveRssCache();
        saveSettings({ rssFeeds: nextFeeds });
        notifyControllers();
        setFeedMessage("");
      };
      const applyYoutubeChannelModeToAll = async (mode) => {
        const value = ["all", "videos", "shorts"].includes(mode) ? mode : "all";
        setYoutubeChannelMode(value);
        const channelFeeds = settings.rssFeeds.filter(isYoutubeChannelFeed);
        if (!channelFeeds.length) {
          setFeedMessage("New YouTube channel feeds will use that video type.");
          return;
        }
        const interimFeeds = settings.rssFeeds.map((feed) =>
          isYoutubeChannelFeed(feed) ? { ...feed, youtubeChannelMode: value } : feed
        );
        saveSettings({ rssFeeds: interimFeeds });
        setFeedMessage(`Updating ${channelFeeds.length} YouTube channel feed${channelFeeds.length === 1 ? "" : "s"}...`);
        const loadedFeeds = await Promise.all(
          interimFeeds.map((feed) => isYoutubeChannelFeed(feed) ? fetchFeed(feed) : feed)
        );
        saveSettings({ rssFeeds: loadedFeeds });
        saveRssCache();
        notifyControllers();
        const failed = loadedFeeds.filter((feed) => isYoutubeChannelFeed(feed) && feed.error).length;
        setFeedMessage(
          failed
            ? `Updated YouTube channel modes, but ${failed} feed${failed === 1 ? "" : "s"} could not refresh.`
            : "Updated all YouTube channel feed modes."
        );
      };
      const changeFeedYoutubeChannelMode = async (url, mode) => {
        const value = ["all", "videos", "shorts"].includes(mode) ? mode : "all";
        const existing = settings.rssFeeds.find((feed) => feed.url === url);
        if (!existing) return;
        const updatedFeed = { ...existing, youtubeChannelMode: value };
        const interimFeeds = settings.rssFeeds.map((feed) =>
          feed.url === url ? updatedFeed : feed
        );
        saveSettings({ rssFeeds: interimFeeds });
        setFeedMessage("Updating YouTube feed...");
        const loaded = await fetchFeed(updatedFeed);
        const nextFeeds = interimFeeds.map((feed) => feed.url === url ? loaded : feed);
        saveSettings({ rssFeeds: nextFeeds });
        saveRssCache();
        notifyControllers();
        setFeedMessage(loaded.error || "YouTube feed updated.");
      };
      const changeOrderingMode = (event) => {
        const value = event.currentTarget.value;
        setOrderingMode(value);
        saveSettings({ orderingMode: value });
      };
      const changeRssPerSteam = (event) => {
        const value = clampRssPerSteam(event.currentTarget.value);
        setRssPerSteam(value);
        saveSettings({ rssPerSteam: value });
      };
      const changeRssArticleLimit = (event) => {
        const value = clampRssArticleLimit(event.currentTarget.value);
        setRssArticleLimit(value);
        saveSettings({ rssArticleLimit: value });
      };
      const changeManualArticleSizeEnabled = (event) => {
        const enabled = event.currentTarget.checked;
        setManualArticleSizeEnabled(enabled);
        if (!enabled) {
          saveSettings({ manualArticleSizeEnabled: false });
          return;
        }
        const automatic = currentAutomaticArticleSizes();
        setRowArticleWidth(automatic.rowArticleWidth);
        setRowArticleHeight(automatic.rowArticleHeight);
        setOpenedArticleWidth(automatic.openedArticleWidth);
        setOpenedArticleHeight(automatic.openedArticleHeight);
        setRowArticleWidthInput(String(automatic.rowArticleWidth));
        setRowArticleHeightInput(String(automatic.rowArticleHeight));
        setOpenedArticleWidthInput(String(automatic.openedArticleWidth));
        setOpenedArticleHeightInput(String(automatic.openedArticleHeight));
        saveSettings({
          manualArticleSizeEnabled: true,
          rowArticleWidth: automatic.rowArticleWidth,
          rowArticleHeight: automatic.rowArticleHeight,
          openedArticleWidth: automatic.openedArticleWidth,
          openedArticleHeight: automatic.openedArticleHeight
        });
      };
      const changeRowArticleWidth = (event) => {
        setRowArticleWidthInput(event.currentTarget.value);
      };
      const changeRowArticleHeight = (event) => {
        setRowArticleHeightInput(event.currentTarget.value);
      };
      const changeOpenedArticleWidth = (event) => {
        setOpenedArticleWidthInput(event.currentTarget.value);
      };
      const changeOpenedArticleHeight = (event) => {
        setOpenedArticleHeightInput(event.currentTarget.value);
      };
      const commitRowArticleWidth = () => {
        const value = clampArticleDimension(rowArticleWidthInput, rowArticleWidth, 120);
        setRowArticleWidth(value);
        setRowArticleWidthInput(String(value));
        saveSettings({ rowArticleWidth: value });
      };
      const commitRowArticleHeight = () => {
        const value = clampArticleDimension(rowArticleHeightInput, rowArticleHeight, 80);
        setRowArticleHeight(value);
        setRowArticleHeightInput(String(value));
        saveSettings({ rowArticleHeight: value });
      };
      const commitOpenedArticleWidth = () => {
        const value = clampArticleDimension(openedArticleWidthInput, openedArticleWidth, 320);
        setOpenedArticleWidth(value);
        setOpenedArticleWidthInput(String(value));
        saveSettings({ openedArticleWidth: value });
      };
      const commitOpenedArticleHeight = () => {
        const value = clampArticleDimension(openedArticleHeightInput, openedArticleHeight, 240);
        setOpenedArticleHeight(value);
        setOpenedArticleHeightInput(String(value));
        saveSettings({ openedArticleHeight: value });
      };
      const changeRefreshInterval = (event) => {
        const value = clampRefreshInterval(event.currentTarget.value);
        setRefreshIntervalMinutes(value);
        saveSettings({ refreshIntervalMinutes: value });
      };
      return React.createElement(
        "div",
        null,
        React.createElement(
          UI.Field,
          {
            label: "Scrolling mode",
            description: "Continuously scroll articles or automatically advance by complete visible pages.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { className: "millennium-ticker-setting-row" },
            React.createElement(
              "select",
              { value: scrollMode, onChange: changeScrollMode },
              React.createElement("option", { value: "continuous" }, "Continuous smooth scrolling"),
              React.createElement("option", { value: "paged" }, "Automatically advance visible pages")
            )
          )
        ),
        scrollMode === "continuous"
          ? React.createElement(
              UI.Field,
              {
                label: "Scroll speed",
                description: "How quickly What's New and RSS rows move from right to left.",
                bottomSeparator: "standard",
                focusable: true
              },
              React.createElement(
                "div",
                { className: "millennium-ticker-speed" },
                React.createElement("input", {
                  type: "range",
                  min: 10,
                  max: 200,
                  step: 5,
                  value: speed,
                  onChange: onSpeedChange
                }),
                React.createElement("output", null, `${speed} px/s`)
              )
            )
          : React.createElement(
              UI.Field,
              {
                label: "Page interval",
                description: "Seconds each complete set of visible articles remains on screen.",
                bottomSeparator: "standard",
                focusable: true
              },
              React.createElement(
                "div",
                { className: "millennium-ticker-setting-row" },
                React.createElement("input", {
                  type: "number",
                  min: 2,
                  max: 120,
                  value: pageIntervalSeconds,
                  onChange: changePageInterval
                })
              )
            ),
        React.createElement(
          UI.Field,
          {
            label: "Resume after manual navigation",
            description: "How long automatic scrolling waits after a previous or next arrow is clicked.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { className: "millennium-ticker-speed" },
            React.createElement("input", {
              type: "range",
              min: 1,
              max: 60,
              step: 1,
              value: manualResumeDelay,
              onChange: onDelayChange
            }),
            React.createElement("output", null, `${manualResumeDelay} s`)
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "RSS feeds",
            description: "Add RSS 2.0 or Atom feed URLs to the Library What's New carousel.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { style: { width: "100%" } },
            React.createElement(
              "div",
              { className: "millennium-rss-add-row" },
              React.createElement("input", {
                type: "url",
                value: feedUrl,
                placeholder: "https://example.com/feed.xml",
                "aria-label": "RSS feed URL",
                onChange: (event) => setFeedUrl(event.currentTarget.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") addFeed();
                }
              }),
              React.createElement("button", { type: "button", onClick: addFeed }, "Add")
            ),
            React.createElement(
              "div",
              { className: "millennium-ticker-setting-row", style: { marginTop: "8px" } },
              React.createElement(
                "select",
                {
                  value: youtubeChannelMode,
                  "aria-label": "Set all YouTube channel feed video types",
                  onChange: (event) => applyYoutubeChannelModeToAll(event.currentTarget.value)
                },
                React.createElement("option", { value: "all" }, "Set all YouTube channels: all videos"),
                React.createElement("option", { value: "videos" }, "Set all YouTube channels: normal videos only"),
                React.createElement("option", { value: "shorts" }, "Set all YouTube channels: Shorts only")
              )
            ),
            feedMessage
              ? React.createElement("div", { className: "millennium-rss-warning" }, feedMessage)
              : null,
            React.createElement(
              "div",
              { className: "millennium-rss-feed-list" },
              feeds.length
                ? feeds.map((feed) =>
                    React.createElement(
                      "div",
                      { className: "millennium-rss-feed", key: feed.url },
                      React.createElement(
                        "div",
                        { className: "millennium-rss-feed-details" },
                        React.createElement(
                          "div",
                          { className: "millennium-rss-feed-title" },
                          feed.title || "RSS feed"
                        ),
                        React.createElement(
                          "div",
                          { className: "millennium-rss-feed-url", title: feed.originalUrl || feed.url },
                          feed.originalUrl || feed.url
                        ),
                        feed.error
                          ? React.createElement(
                              "div",
                              { className: "millennium-rss-feed-error", title: feed.error },
                              feed.error
                            )
                          : null
                        ,
                        feed.feedType === "youtube" && feed.youtubeKind === "channel"
                          ? React.createElement(
                              "select",
                              {
                                value: feed.youtubeChannelMode || "all",
                                "aria-label": `Video type for ${feed.title || feed.originalUrl || feed.url}`,
                                onChange: (event) =>
                                  changeFeedYoutubeChannelMode(feed.url, event.currentTarget.value)
                              },
                              React.createElement("option", { value: "all" }, "All videos"),
                              React.createElement("option", { value: "videos" }, "Normal videos only"),
                              React.createElement("option", { value: "shorts" }, "Shorts only")
                            )
                          : null
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          "aria-label": `Delete ${feed.title || feed.url}`,
                          onClick: () => removeFeed(feed.url)
                        },
                        "\u00d7"
                      )
                    )
                  )
                : React.createElement("div", { style: { opacity: 0.65 } }, "No RSS feeds added.")
            )
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "Article ordering",
            description: "Choose how Steam and RSS articles are arranged.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { className: "millennium-ticker-setting-row" },
            React.createElement(
              "select",
              { value: orderingMode, onChange: changeOrderingMode },
              React.createElement("option", { value: "chronological" }, "Steam, then newest RSS articles"),
              React.createElement("option", { value: "alternating" }, "Alternate Steam and RSS articles"),
              React.createElement("option", { value: "rss-shelf-only" }, "RSS articles on separate shelf only")
            )
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "Maximum RSS articles",
            description: "Load up to this many RSS articles. If fewer are available, all available articles are loaded.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { className: "millennium-ticker-setting-row" },
            React.createElement("input", {
              type: "number",
              min: 1,
              max: 200,
              value: rssArticleLimit,
              onChange: changeRssArticleLimit
            })
          )
        ),
        React.createElement(
          "section",
          { className: "millennium-manual-size-settings" },
          React.createElement("h3", null, "Manual article size override"),
          React.createElement(
            "p",
            null,
            "Force RSS row card size and opened article popup size instead of using automatic layout measurements."
          ),
          React.createElement(
            "label",
            null,
            React.createElement("input", {
              type: "checkbox",
              checked: manualArticleSizeEnabled,
              onChange: changeManualArticleSizeEnabled
            }),
            " Enable manual sizing"
          ),
          React.createElement(
            "div",
            { className: "millennium-manual-size-grid" },
            React.createElement(
              "label",
              null,
              "Row width",
              React.createElement("input", {
                type: "number",
                min: 120,
                max: 2400,
                disabled: !manualArticleSizeEnabled,
                value: rowArticleWidthInput,
                onChange: changeRowArticleWidth,
                onBlur: commitRowArticleWidth,
                onKeyDown: (event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }
              })
            ),
            React.createElement(
              "label",
              null,
              "Row height",
              React.createElement("input", {
                type: "number",
                min: 80,
                max: 2400,
                disabled: !manualArticleSizeEnabled,
                value: rowArticleHeightInput,
                onChange: changeRowArticleHeight,
                onBlur: commitRowArticleHeight,
                onKeyDown: (event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }
              })
            ),
            React.createElement(
              "label",
              null,
              "Opened width",
              React.createElement("input", {
                type: "number",
                min: 320,
                max: 2400,
                disabled: !manualArticleSizeEnabled,
                value: openedArticleWidthInput,
                onChange: changeOpenedArticleWidth,
                onBlur: commitOpenedArticleWidth,
                onKeyDown: (event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }
              })
            ),
            React.createElement(
              "label",
              null,
              "Opened height",
              React.createElement("input", {
                type: "number",
                min: 240,
                max: 2400,
                disabled: !manualArticleSizeEnabled,
                value: openedArticleHeightInput,
                onChange: changeOpenedArticleHeight,
                onBlur: commitOpenedArticleHeight,
                onKeyDown: (event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }
              })
            )
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "Mixed RSS rows",
            description: "Control how YouTube feeds are grouped in mixed rows.",
            bottomSeparator: "standard"
          },
          React.createElement(
            "label",
            { style: { width: "100%" } },
            React.createElement("input", {
              type: "checkbox",
              checked: combineYoutubeFeedsAsOneSource,
              onChange: (event) => {
                const value = event.currentTarget.checked;
                setCombineYoutubeFeedsAsOneSource(value);
                saveSettings({ combineYoutubeFeedsAsOneSource: value });
                refreshFeeds("YouTube source grouping changed");
              }
            }),
            " Combine all YouTube feeds as one source"
          )
        ),
        orderingMode === "alternating"
          ? React.createElement(
              UI.Field,
              {
                label: "RSS articles between Steam articles",
                description: "Number of RSS articles inserted after each Steam article.",
                bottomSeparator: "standard",
                focusable: true
              },
              React.createElement(
                "div",
                { className: "millennium-ticker-setting-row" },
                React.createElement("input", {
                  type: "number",
                  min: 1,
                  max: 20,
                  value: rssPerSteam,
                  onChange: changeRssPerSteam
                })
              )
            )
          : null,
        React.createElement(
          UI.Field,
          {
            label: "RSS article date and time",
            description: "Control the exact timestamp shown above each RSS article card.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { className: "millennium-date-settings" },
            React.createElement("label", { htmlFor: "millennium-date-locale" }, "Date order"),
            React.createElement(
              "select",
              {
                id: "millennium-date-locale",
                value: dateLocale,
                onChange: (event) => {
                  const value = event.currentTarget.value;
                  setDateLocale(value);
                  saveSettings({ dateLocale: value });
                }
              },
              React.createElement("option", { value: "system" }, "System locale"),
              React.createElement("option", { value: "us" }, "US (month / day / year)"),
              React.createElement("option", { value: "eu" }, "European (day / month / year)")
            ),
            React.createElement("label", { htmlFor: "millennium-date-style" }, "Date length"),
            React.createElement(
              "select",
              {
                id: "millennium-date-style",
                value: dateStyle,
                onChange: (event) => {
                  const value = event.currentTarget.value;
                  setDateStyle(value);
                  saveSettings({ dateStyle: value });
                }
              },
              React.createElement("option", { value: "short" }, "Short date"),
              React.createElement("option", { value: "medium" }, "Medium date"),
              React.createElement("option", { value: "long" }, "Long date")
            ),
            React.createElement("label", { htmlFor: "millennium-weekday-style" }, "Day name"),
            React.createElement(
              "select",
              {
                id: "millennium-weekday-style",
                value: weekdayStyle,
                onChange: (event) => {
                  const value = event.currentTarget.value;
                  setWeekdayStyle(value);
                  saveSettings({ weekdayStyle: value });
                }
              },
              React.createElement("option", { value: "none" }, "Do not show"),
              React.createElement("option", { value: "short" }, "Short (Sun)"),
              React.createElement("option", { value: "long" }, "Long (Sunday)")
            ),
            React.createElement("label", { htmlFor: "millennium-hour-cycle" }, "Time format"),
            React.createElement(
              "select",
              {
                id: "millennium-hour-cycle",
                value: hourCycle,
                onChange: (event) => {
                  const value = event.currentTarget.value;
                  setHourCycle(value);
                  saveSettings({ hourCycle: value });
                }
              },
              React.createElement("option", { value: "system" }, "System preference"),
              React.createElement("option", { value: "12" }, "12-hour"),
              React.createElement("option", { value: "24" }, "24-hour")
            ),
            React.createElement("label", { htmlFor: "millennium-date-position" }, "Position"),
            React.createElement(
              "select",
              {
                id: "millennium-date-position",
                value: datePosition,
                onChange: (event) => {
                  const value = event.currentTarget.value;
                  setDatePosition(value);
                  saveSettings({ datePosition: value });
                }
              },
              React.createElement("option", { value: "above" }, "Above image"),
              React.createElement("option", { value: "below-image" }, "Below image"),
              React.createElement("option", { value: "below-title" }, "Below title"),
              React.createElement("option", { value: "below-source" }, "Below source"),
              React.createElement("option", { value: "beside-source" }, "Next to source")
            )
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "RSS refresh triggers",
            description: "Refresh feeds when returning to Library or after closing an article.",
            bottomSeparator: "standard"
          },
          React.createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "8px", width: "100%" } },
            React.createElement(
              "label",
              null,
              React.createElement("input", {
                type: "checkbox",
                checked: refreshOnLibrary,
                onChange: (event) => {
                  const value = event.currentTarget.checked;
                  setRefreshOnLibrary(value);
                  saveSettings({ refreshOnLibrary: value });
                }
              }),
              " When the Library What's New section is refreshed"
            ),
            React.createElement(
              "label",
              null,
              React.createElement("input", {
                type: "checkbox",
                checked: refreshOnArticleClose,
                onChange: (event) => {
                  const value = event.currentTarget.checked;
                  setRefreshOnArticleClose(value);
                  saveSettings({ refreshOnArticleClose: value });
                }
              }),
              " After an article is opened and closed"
            )
          )
        ),
        React.createElement(
          UI.Field,
          {
            label: "RSS refresh interval",
            description: "Feeds are also refreshed on this schedule. Default: 60 minutes.",
            bottomSeparator: "standard",
            focusable: true
          },
          React.createElement(
            "div",
            { style: { width: "100%" } },
            React.createElement(
              "div",
              { className: "millennium-ticker-setting-row" },
              React.createElement("input", {
                type: "number",
                min: 5,
                max: 1440,
                value: refreshIntervalMinutes,
                onChange: changeRefreshInterval
              }),
              React.createElement("span", null, "minutes")
            ),
            refreshIntervalMinutes < 15
              ? React.createElement(
                  "div",
                  { className: "millennium-rss-warning" },
                  "Frequent refreshes can increase network use, CPU work, and Library UI updates."
                )
              : null
          )
        )
      );
    }

    const plugin = UI.definePlugin(async () => {
      console.log("[What's New RSS Ticker] Frontend startup");

      const existing = findExistingDesktopPopup();
      if (existing) attachPopup(existing);
      UI.Millennium.AddWindowCreateHook(attachPopup);
      scheduleRefreshTimer();
      if (settings.rssFeeds.length) refreshFeeds("plugin startup");

      return {
        title: "What's New RSS Ticker",
        icon: React.createElement(UI.IconsModule?.Update || UI.IconsModule?.Settings || "span", null),
        content: React.createElement(SettingsPanel, null)
      };
    });

    exports.default = plugin;
    Object.defineProperty(exports, "__esModule", { value: true });
    return exports;
  }({}, window.MILLENNIUM_API, window.SP_REACT);
};

async function ExecutePluginModule() {
  const module = PluginEntryPointMain();
  Object.assign(window.PLUGIN_LIST[pluginName], {
    ...module,
    __millennium_internal_plugin_name_do_not_use_or_change__: pluginName
  });
  const navigation = await module.default();
  if (navigation?.title !== undefined && navigation?.icon !== undefined && navigation?.content !== undefined) {
    window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName] = navigation;
  }
  MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName });
}

ExecutePluginModule();
