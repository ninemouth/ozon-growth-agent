// content.js — Page context reader and human-like page operator for Skill Runner

(function () {
  "use strict";

  function closePopups() {
    const popupSelectors = [
      'button[id*="accept"]', 'button[class*="accept"]',
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      'button[class*="close"]', '.close-btn', '.modal-close',
      'a[class*="close"]', 'div[class*="close-icon"]',
      '.tb-ie-updater-close',
      '.identity-dialog-close', '.su-dialog-close', '.mod-close',
      '.s-dialog-close', '[class*="dialog-close"]', '[class*="modal-close"]'
    ];
    let closed = 0;
    for (const sel of popupSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (isVisibleElement(el)) {
          try { el.click(); closed++; } catch (_) {}
        }
      });
    }
    return closed;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function normalizeUrl(value) {
    if (!value) return "";
    try {
      if (value.startsWith("//")) return window.location.protocol + value;
      if (value.startsWith("/")) return window.location.origin + value;
      return new URL(value, window.location.href).href;
    } catch (_) {
      return value;
    }
  }

  function normalizeText(value, maxLength = 240) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function generateHash(str) {
    let hash = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function simulateHumanClick(el, options = {}) {
    if (!el) return false;
    const target = options.exactTarget ? el : (getClickableActionTarget(el) || el);
    try {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (_) {}

    const rect = target.getBoundingClientRect();
    const clientX = Math.max(1, rect.left + rect.width / 2);
    const clientY = Math.max(1, rect.top + rect.height / 2);
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };

    try {
      ["pointerover", "pointermove", "mouseover", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        const EventCtor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
        target.dispatchEvent(new EventCtor(type, eventInit));
      });
      if (typeof target.click === "function" && !isFileUploadLikeElement(target)) {
        target.click();
      }
      return true;
    } catch (_) {
      try {
        target.click();
        return true;
      } catch (err) {
        console.warn("simulateHumanClick failed:", err.message);
        return false;
      }
    }
  }

  function isFileUploadLikeElement(el) {
    if (!el) return false;
    if (el.tagName === "INPUT" && el.type === "file") return true;
    if (el.closest?.('input[type="file"]')) return true;
    if (el.querySelector?.('input[type="file"]')) return true;
    return false;
  }

  function getClickableActionTarget(el) {
    if (!el) return null;
    const selectors = [
      "button",
      "a",
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '[class*="btn"]',
      '[class*="button"]',
      '[class*="submit"]',
      '[class*="confirm"]',
      '[class*="primary"]',
    ].join(",");
    let target = null;
    try {
      target = el.closest?.(selectors) || null;
    } catch (_) {}
    if (target && isVisibleElement(target) && !isFileUploadLikeElement(target)) return target;
    return null;
  }

  function interactionMemoryKey(kind) {
    return `ecommerce_growth_agent.interaction.${location.hostname}.${kind}`;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get([key], (data) => resolve(data?.[key] || null));
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        resolve(false);
        return;
      }
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    });
  }

  function buildStableSelector(el) {
    if (!el || !el.tagName) return "";
    if (el.id) return `#${cssEscape(el.id)}`;

    const attrs = ["aria-label", "title", "name", "type", "role"];
    const attrSelector = attrs
      .map((attr) => {
        const value = el.getAttribute?.(attr);
        return value ? `[${attr}="${String(value).replace(/"/g, '\\"')}"]` : "";
      })
      .find(Boolean);
    if (attrSelector) return `${el.tagName.toLowerCase()}${attrSelector}`;

    const className = typeof el.className === "string" ? el.className : "";
    const classes = className.split(/\s+/).filter(Boolean).slice(0, 3);
    if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes.map(cssEscape).join(".")}`;

    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
    const nth = siblings.indexOf(el) + 1;
    return `${buildStableSelector(parent)} > ${el.tagName.toLowerCase()}:nth-of-type(${Math.max(nth, 1)})`;
  }

  async function rememberInteraction(kind, el) {
    if (!el || !isVisibleElement(el)) return false;
    const rect = el.getBoundingClientRect();
    const memory = {
      selector: buildStableSelector(el),
      text: (el.innerText || el.value || el.title || el.getAttribute?.("aria-label") || "").trim().slice(0, 80),
      normalizedX: (rect.left + rect.width / 2) / Math.max(window.innerWidth, 1),
      normalizedY: (rect.top + rect.height / 2) / Math.max(window.innerHeight, 1),
      width: rect.width,
      height: rect.height,
      learnedAt: Date.now(),
      href: location.href,
    };
    return await storageSet(interactionMemoryKey(kind), memory);
  }

  async function _clickRememberedInteraction(kind) {
    const memory = await storageGet(interactionMemoryKey(kind));
    if (!memory) return false;

    let el = null;
    if (memory.selector) {
      try {
        el = document.querySelector(memory.selector);
      } catch (_) {}
    }
    if (!isVisibleElement(el) && Number.isFinite(memory.normalizedX) && Number.isFinite(memory.normalizedY)) {
      const x = Math.min(Math.max(memory.normalizedX * window.innerWidth, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(memory.normalizedY * window.innerHeight, 1), window.innerHeight - 1);
      el = document.elementFromPoint(x, y);
    }
    if (!isVisibleElement(el)) return false;
    return simulateHumanClick(el);
  }

  function getElementLabel(el) {
    return `${el?.innerText || ""} ${el?.value || ""} ${el?.title || ""} ${el?.getAttribute?.("aria-label") || ""} ${el?.className || ""}`;
  }

  function isImageSearchSubmitLike(el) {
    if (!el) return false;
    const label = getElementLabel(el);
    return /搜图|搜索图片|图片搜索|以图搜索|以图搜款|找同款|开始搜索|确认|确定|上传|search|find similar/i.test(label) &&
      !/取消|关闭|重置|清空|delete|remove|close|cancel|reset/i.test(label);
  }

  function parseRgbColor(color) {
    const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }

  function isWarmPrimaryColor(color) {
    const rgb = parseRgbColor(color);
    if (!rgb) return /orange|orangered|#ff|#f5/i.test(String(color || ""));
    return rgb.r >= 210 && rgb.g >= 45 && rgb.g <= 185 && rgb.b <= 110 && rgb.r > rgb.g + 35;
  }

  function looksLikeVisualPrimaryButton(el) {
    if (!isVisibleElement(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 45 || rect.height < 24 || rect.width > 360 || rect.height > 140) return false;

    const style = window.getComputedStyle(el);
    const warm = isWarmPrimaryColor(style.backgroundColor) ||
      isWarmPrimaryColor(style.borderColor) ||
      isWarmPrimaryColor(style.color);
    const pointer = style.cursor === "pointer" ||
      el.tagName === "BUTTON" ||
      el.tagName === "A" ||
      el.getAttribute("role") === "button" ||
      typeof el.onclick === "function";
    const label = getElementLabel(el);
    const reject = /最近搜索|热门搜索|采购车|消息|订单|下载插件|首页|我的阿里|取消|关闭|删除|清空|reset|cancel|close/i.test(label);
    return warm && pointer && !reject;
  }

  function getMetaImageUrl() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[property="twitter:image"]',
      'meta[name="twitter:image"]',
      'link[rel="image_src"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const src = el?.getAttribute("content") || el?.getAttribute("href") || "";
      if (src && /^https?:\/\//i.test(src)) return normalizeUrl(src);
    }
    return "";
  }

  function getBestImageSrc(img) {
    if (!img) return "";
    const direct = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-original") || img.getAttribute("data-img") || img.getAttribute("data-ks-lazyload") || "";
    if (direct) return normalizeUrl(direct);
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (!srcset) return "";
    const first = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).find(Boolean);
    return first ? normalizeUrl(first) : "";
  }

  function scoreProductImage(img, h1, title, metaImageUrl) {
    const src = getBestImageSrc(img);
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    const area = width * height;
    const rect = img.getBoundingClientRect();
    const alt = img.alt || "";
    const descriptor = `${src} ${alt} ${img.title || ""} ${img.className || ""} ${img.id || ""}`.toLowerCase();
    const pageWords = `${h1} ${title}`.toLowerCase().split(/\s+/).filter((w) => w.length >= 3).slice(0, 10);
    const inProductArea = !!img.closest('[class*="product"], [id*="product"], [class*="gallery"], [id*="gallery"], [class*="main"], [id*="main"], [class*="hero"], [id*="hero"], [class*="image"], [id*="image"], [class*="photo"], [id*="photo"], [class*="sku"], [class*="thumb"], [class*="swiper"]');
    const inThumbArea = !!img.closest('[class*="thumb"], [class*="Thumb"], [class*="sku"], [class*="gallery"], [class*="swiper"], [aria-selected="true"], [class*="selected"], [class*="active"]');

    let score = Math.min(area / 1000, 1200);
    let searchScore = Math.min(area / 1200, 900);
    if (src === metaImageUrl) {
      score += 1000;
      searchScore += 220;
    }
    if (width >= 300 && height >= 300) {
      score += 260;
      searchScore += 220;
    }
    if (rect.top >= -100 && rect.top < window.innerHeight * 1.5) {
      score += 180;
      searchScore += 120;
    }
    if (inProductArea) {
      score += 300;
      searchScore += 350;
    }
    if (inThumbArea && width >= 80 && height >= 80) {
      searchScore += 420;
    }
    if (rect.width >= 45 && rect.width <= 220 && rect.height >= 45 && rect.height <= 220 && inThumbArea) {
      searchScore += 260;
    }
    if (pageWords.some((word) => alt.toLowerCase().includes(word))) {
      score += 160;
      searchScore += 120;
    }

    if (/logo|icon|avatar|sprite|badge|star|rating|payment|visa|mastercard|placeholder|blank|loading|qr|qrcode/.test(descriptor)) {
      score -= 800;
      searchScore -= 1000;
    }
    if (/banner|cover|promo|review|comment|desc|description|video|brand|seller|shop/.test(descriptor)) {
      searchScore -= 380;
    }
    if (width < 80 || height < 80 || area < 6400) {
      score -= 500;
      searchScore -= 450;
    }
    if (!isVisibleElement(img)) {
      score -= 300;
      searchScore -= 300;
    }

    return {
      score,
      searchScore,
      src,
      alt,
      width,
      height,
      area,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      roleHint: inThumbArea ? "gallery_thumbnail_or_variant" : (inProductArea ? "product_media" : "page_image"),
    };
  }

  function extractRankedImages(h1, title) {
    const metaImageUrl = getMetaImageUrl();
    const seen = new Set();
    const scored = Array.from(document.querySelectorAll("img"))
      .map((img) => scoreProductImage(img, h1, title, metaImageUrl))
      .filter((img) => img.src && img.src.startsWith("http") && !seen.has(img.src) && seen.add(img.src))
      .sort((a, b) => b.score - a.score);

    if (metaImageUrl && !seen.has(metaImageUrl)) {
      scored.unshift({
        src: metaImageUrl,
        alt: "metadata product image",
        width: 0,
        height: 0,
        area: 0,
        score: 1000,
        searchScore: 650,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        roleHint: "metadata",
      });
    }

    return scored.slice(0, 30);
  }

  function pickSearchImage(images) {
    return [...images].sort((a, b) => {
      if (Math.abs((b.searchScore || 0) - (a.searchScore || 0)) > 80) {
        return (b.searchScore || 0) - (a.searchScore || 0);
      }
      return (b.score || 0) - (a.score || 0);
    })[0] || null;
  }

  function looksLikeProductHref(href) {
    const lowerHref = String(href || "").toLowerCase();
    if (!lowerHref) return false;
    if (lowerHref.includes("1688.com")) {
      return lowerHref.includes("offer") ||
        lowerHref.includes("item") ||
        lowerHref.includes("click") ||
        lowerHref.includes("jump") ||
        /\/\d{9,15}\.html/.test(lowerHref) ||
        /[?&](offerid|id)=\d+/i.test(lowerHref);
    }
    if (lowerHref.includes("taobao.com") || lowerHref.includes("tmall.com")) {
      return lowerHref.includes("item.htm") || lowerHref.includes("/item/") || /[?&]id=\d+/i.test(lowerHref);
    }
    if (lowerHref.includes("amazon.com") || lowerHref.includes("amazon.co.jp") || lowerHref.includes("amazon.de") || lowerHref.includes("amazon.co.uk")) {
      return lowerHref.includes("/dp/") || lowerHref.includes("/gp/product/");
    }
    if (lowerHref.includes("tiktok.com")) {
      return lowerHref.includes("/product/") || 
             lowerHref.includes("/t/") || 
             lowerHref.includes("/view/") || 
             lowerHref.includes("/product-detail/") || 
             /[?&]product_id=/i.test(lowerHref);
    }
    return lowerHref.includes("etsy.com/listing/") ||
      lowerHref.includes("temu.com/") ||
      lowerHref.includes("aliexpress.com/item/");
  }

  function extractPriceFromText(text) {
    const value = String(text || "");
    const match = value.match(/[¥￥]\s*\d+(?:\.\d+)?(?:\s*[-~至]\s*[¥￥]?\s*\d+(?:\.\d+)?)?/i) ||
      value.match(/\d+(?:\.\d+)?\s*元(?:\s*[-~至]\s*\d+(?:\.\d+)?\s*元)?/i);
    return match ? normalizeText(match[0], 40) : "";
  }

  function pickLikelyCardContainer(anchor) {
    const preferred = anchor.closest([
      '[class*="offer"]',
      '[class*="Offer"]',
      '[class*="product"]',
      '[class*="Product"]',
      '[class*="item"]',
      '[class*="Item"]',
      '[class*="card"]',
      '[class*="Card"]',
      '[class*="goods"]',
      '[class*="Goods"]',
      '[data-offer-id]',
      '[data-item-id]',
      "li",
    ].join(","));
    
    if (preferred && isVisibleElement(preferred)) {
      if (!hasMultipleProductLinks(preferred)) {
        const rect = preferred.getBoundingClientRect();
        if (rect.width >= 90 && rect.height >= 90 && rect.width <= window.innerWidth * 0.98 && rect.height <= Math.max(window.innerHeight * 1.4, 900)) {
          return preferred;
        }
      }
    }

    let el = anchor;
    for (let depth = 0; depth < 6 && el?.parentElement; depth++) {
      el = el.parentElement;
      if (hasMultipleProductLinks(el)) {
        break; // Stop going up if we hit a grid container holding multiple items
      }
      const rect = el.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 120 && rect.width <= window.innerWidth * 0.95 && el.querySelector("img")) {
        return el;
      }
    }
    return anchor;
  }

  function hasMultipleProductLinks(container) {
    if (!container) return false;
    const anchors = Array.from(container.querySelectorAll('a[href]'));
    const productUrls = new Set();
    for (const a of anchors) {
      if (looksLikeProductHref(a.href)) {
        productUrls.add(a.href.split('?')[0]);
      }
    }
    return productUrls.size > 1;
  }

  function getLargestProductImage(card) {
    const images = Array.from(card.querySelectorAll("img, div[style*=\"background-image\"], span[style*=\"background-image\"]"))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        let src = "";
        
        if (el.tagName === "IMG") {
          src = el.getAttribute("data-src") || 
                el.getAttribute("data-lazy-src") || 
                el.getAttribute("original-src") || 
                el.src;
          if (el.srcset) {
            const parts = el.srcset.split(",").map(p => p.trim().split(/\s+/));
            if (parts.length > 0) {
              src = parts[parts.length - 1][0] || src;
            }
          }
        } else {
          const bg = el.style.backgroundImage || window.getComputedStyle(el).backgroundImage;
          const match = bg.match(/url\((['"]?)(.*?)\1\)/);
          if (match) {
            src = match[2];
          }
        }

        const descriptor = String((el.className || "") + " " + (el.getAttribute("alt") || "") + " " + src).toLowerCase();
        let score = rect.width * rect.height;
        if (rect.width >= 120 && rect.height >= 120) score += 400;
        if (/logo|icon|avatar|sprite|badge|star|rating|qr|qrcode|placeholder|blank|loading/.test(descriptor)) score -= 1200;
        if (!src || !/^https?:\/\//i.test(src)) {
          if (src && !src.startsWith("data:") && !src.startsWith("blob:")) {
            try {
              src = new URL(src, window.location.href).href;
            } catch (_) {}
          }
          if (!src || !/^https?:\/\//i.test(src)) {
            score -= 800;
          }
        }
        if (!isVisibleElement(el)) score -= 400;
        return {
          img: el,
          src,
          alt: el.tagName === "IMG" ? normalizeText(el.alt || el.title || "", 120) : "",
          rect,
          naturalWidth: el.naturalWidth || el.width || rect.width || 0, naturalHeight: el.naturalHeight || el.height || rect.height || 0,
          score,
        };
      })
      .filter((item) => item.src && item.score > -100)
      .sort((a, b) => b.score - a.score);
    return images[0] || null;
  }

  function extractProductCards() {
    const seenLinks = new Set();
    const seenCards = new Set();
    const candidates = [];
    const anchors = Array.from(document.querySelectorAll("a[href]"));

    for (const anchor of anchors) {
      const href = normalizeUrl(anchor.getAttribute("href") || "");
      if (!looksLikeProductHref(href) || seenLinks.has(href)) continue;
      const card = pickLikelyCardContainer(anchor);
      if (!card || seenCards.has(card)) continue;
      const rect = card.getBoundingClientRect();
      if (rect.width < 90 || rect.height < 90 || rect.bottom < 0 || rect.top > window.innerHeight * 2.5) continue;
      const image = getLargestProductImage(card);
      if (!image?.src) continue;

      const cardText = normalizeText(card.innerText || anchor.innerText || image.alt, 700);
      const anchorText = normalizeText(anchor.innerText || anchor.getAttribute("title") || "", 220);
      const title = anchorText || image.alt || cardText.split(/[。|｜\n]/)[0] || "";
      const price = extractPriceFromText(cardText);
      const imageRect = image.rect;
      const area = Math.max(rect.width * rect.height, 1);
      let confidence = Math.min(100, Math.round((imageRect.width * imageRect.height / area) * 70 + Math.min(rect.width * rect.height / 12000, 30)));
      if (price) confidence += 8;
      if (title && title.length >= 6) confidence += 8;
      confidence = Math.min(confidence, 100);

      seenLinks.add(href);
      seenCards.add(card);
      candidates.push({
        index: candidates.length + 1,
        href,
        title: normalizeText(title, 180),
        price,
        text: cardText,
        imageSrc: image.src,
        imageAlt: image.alt,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        cardRect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          normalizedCenterX: Number(((rect.left + rect.width / 2) / Math.max(window.innerWidth, 1)).toFixed(4)),
          normalizedCenterY: Number(((rect.top + rect.height / 2) / Math.max(window.innerHeight, 1)).toFixed(4)),
        },
        imageRect: {
          x: Math.round(imageRect.left),
          y: Math.round(imageRect.top),
          width: Math.round(imageRect.width),
          height: Math.round(imageRect.height),
        },
        extractionConfidence: confidence,
      });
      if (candidates.length >= 50) break;
    }

    candidates.sort((a, b) => {
      const ay = a.cardRect.y;
      const by = b.cardRect.y;
      if (Math.abs(ay - by) > 80) return ay - by;
      return a.cardRect.x - b.cardRect.x;
    });
    return candidates.slice(0, 40).map((card, idx) => ({ ...card, index: idx + 1 }));
  }

  function extractProductLinks() {
    const productLinks = [];
    try {
      const anchors = Array.from(document.querySelectorAll("a"));
      const isSearchEngine = window.location.hostname.includes("google.com") || window.location.hostname.includes("bing.com");
      const processedLinks = new Set();
      for (const a of anchors) {
        let href = normalizeUrl(a.getAttribute("href") || "");
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;

        const lowerHref = href.toLowerCase();

        if (isSearchEngine) {
          if (
            lowerHref.includes("google.com") ||
            lowerHref.includes("bing.com") ||
            lowerHref.includes("gstatic.com") ||
            lowerHref.includes("microsoft.com") ||
            lowerHref.includes("live.com") ||
            lowerHref.includes("search?")
          ) {
            continue;
          }
          const text = normalizeText(a.innerText || "", 100);
          if (text && !processedLinks.has(href)) {
            processedLinks.add(href);
            productLinks.push({ href, text });
            if (productLinks.length >= 50) break;
          }
          continue;
        }

        if (looksLikeProductHref(href) && !processedLinks.has(href)) {
          processedLinks.add(href);
          productLinks.push({ href, text: normalizeText(a.innerText || "", 100) });
          if (productLinks.length >= 50) break;
        }
      }
    } catch (_) {}
    return productLinks;
  }

  function extractTikTokProductCards() {
    const cards = [];
    const processedUrls = new Set();
    const processedContainers = new Set();

    // Strategy A: Class / attribute selectors
    const classElements = Array.from(document.querySelectorAll('[data-e2e*="product-card"], [class*="ProductCard"], [class*="product-card"], [class*="ShowcaseProduct"], [class*="ProductItem"], [class*="product-item"], a[href*="/product/"], a[href*="/t/"], a[href*="product_id="]'));
    
    // Strategy B: Price-first text match
    const allTextEls = Array.from(document.querySelectorAll('span, div, p, strong, b'));
    const priceElements = allTextEls.filter(el => {
      if (el.children.length > 2) return false;
      const text = el.innerText?.trim() || "";
      // Matches prices like $25.00, $26, or ranges like $10 - $20
      return /^\$\s*\d+(?:\.\d+)?(?:\s*-\s*\$\s*\d+(?:\.\d+)?)?$/i.test(text);
    });

    const combinedElements = [...classElements, ...priceElements];

    for (const el of combinedElements) {
      const container = pickLikelyCardContainer(el) || el;
      if (!container || processedContainers.has(container)) continue;
      processedContainers.add(container);
      
      let title = '';
      let titleEl = container.querySelector('[class*="productName" i], [class*="product-name" i], [class*="goodsName" i], [class*="goods-name" i]');
      if (!titleEl) {
        const generalTitleEls = Array.from(container.querySelectorAll('[class*="title" i], [class*="name" i], h3, h4, h5'));
        for (const te of generalTitleEls) {
          const className = String(te.className || "").toLowerCase();
          const text = (te.innerText || "").trim();
          if (className.includes("price") || className.includes("discount") || className.includes("promo")) {
            continue;
          }
          if (text.startsWith('$') || /^\d+(\.\d+)?$/g.test(text) || text.toLowerCase() === "medicube us store") {
            continue;
          }
          titleEl = te;
          break;
        }
      }

      if (titleEl) {
        title = titleEl.innerText?.trim();
      }
      if (!title) {
        const textContent = container.innerText || '';
        const lines = textContent.split('\n')
          .map(l => l.trim())
          .filter(l => {
            if (!l) return false;
            if (l.startsWith('$')) return false;
            if (/^\d+(\.\d+)?$/g.test(l)) return false;
            if (/sold/i.test(l)) return false;
            if (/k\+/i.test(l)) return false;
            if (l.toLowerCase() === "tiktok shop") return false;
            if (l.toLowerCase() === "medicube us store") return false;
            return true;
          });
        const candidates = lines.slice(0, 3).sort((a, b) => b.length - a.length);
        if (candidates.length > 0) {
          title = candidates[0];
        }
      }
      if (!title || title.toLowerCase() === "tiktok shop" || title.toLowerCase() === "medicube us store") continue;

      let anchor = null;
      const storeHomepagePath = window.location.pathname.split('?')[0];
      const anchors = Array.from(container.querySelectorAll('a[href]'));
      
      for (const a of anchors) {
        const aHref = a.getAttribute('href') || '';
        const resolvedHref = new URL(aHref, window.location.href).pathname.split('?')[0];
        if (resolvedHref === storeHomepagePath || resolvedHref === storeHomepagePath + '/') {
          continue;
        }
        if (looksLikeProductHref(a.href)) {
          anchor = a;
          break;
        }
      }
      
      if (!anchor) {
        for (const a of anchors) {
          const aHref = a.getAttribute('href') || '';
          const resolvedHref = new URL(aHref, window.location.href).pathname.split('?')[0];
          if (resolvedHref !== storeHomepagePath && resolvedHref !== storeHomepagePath + '/') {
            anchor = a;
            break;
          }
        }
      }

      let href = "";
      if (anchor && anchor.href) {
        href = anchor.href;
      } else {
        let pid = "";
        const idEl = container.closest('[data-product-id]') || container.querySelector('[data-product-id]');
        if (idEl) pid = idEl.getAttribute('data-product-id');
        
        if (!pid) {
          const idMatch = container.innerHTML.match(/["'](?:product_id|itemId|id)["']\s*:\s*["']?(\d{10,})["']?/);
          if (idMatch) pid = idMatch[1];
        }

        if (pid) {
          href = `https://shop.tiktok.com/us/store/product/${pid}`;
        }
      }

      const isStoreHomepage = /\/store\/[a-zA-Z0-9._-]+\/\d{10,}/.test(href) === false && href.includes("/store/");
      if (isStoreHomepage || href === window.location.href || href.split('?')[0] === window.location.href.split('?')[0]) continue;

      if (processedUrls.has(href)) continue;
      processedUrls.add(href);

      const image = getLargestProductImage(container);
      const imageSrc = image ? image.src : '';

      let price = '';
      const priceEl = container.querySelector('[class*="price" i], [class*="Price" i]');
      if (priceEl) {
        price = priceEl.innerText?.trim() || '';
      }
      if (!price) {
        const textContent = container.innerText || '';
        const priceMatch = textContent.match(/\$\s*\d+(?:\.\d+)?/);
        if (priceMatch) {
          price = priceMatch[0];
        }
      }

      let sales = '';
      const textContent = container.innerText || '';
      const salesMatch = textContent.match(/(\d+(?:\.\d+)?k?\+?\s*sold|sold\s*\d+(?:\.\d+)?k?\+?)/i);
      if (salesMatch) {
        sales = salesMatch[0];
      }

      cards.push({
        index: cards.length + 1,
        href,
        title: title.slice(0, 180),
        price,
        sales,
        imageSrc,
        text: container.innerText?.slice(0, 500) || ""
      });
    }
    return cards;
  }

  function extractProductCardsWithMemory(selectors) {
    const cards = [];
    const cardSelector = selectors.product_card || selectors.card;
    if (!cardSelector) return [];

    const elements = Array.from(document.querySelectorAll(cardSelector));
    const processedUrls = new Set();

    for (const container of elements) {
      let title = "";
      if (selectors.product_title || selectors.title) {
        const titleEl = container.querySelector(selectors.product_title || selectors.title);
        title = titleEl?.innerText?.trim() || "";
      }
      if (!title) {
        const textContent = container.innerText || '';
        const lines = textContent.split('\n')
          .map(l => l.trim())
          .filter(l => {
            if (!l) return false;
            if (l.startsWith('$')) return false;
            if (/^\d+(\.\d+)?$/g.test(l)) return false;
            if (/sold/i.test(l)) return false;
            if (/k\+/i.test(l)) return false;
            if (l.toLowerCase() === "tiktok shop" || l.toLowerCase() === "medicube us store") return false;
            return true;
          });
        const candidates = lines.slice(0, 3).sort((a, b) => b.length - a.length);
        if (candidates.length > 0) {
          title = candidates[0];
        }
      }
      if (!title || title.toLowerCase() === "tiktok shop" || title.toLowerCase() === "medicube us store") continue;

      let href = "";
      if (selectors.product_link || selectors.link) {
        const linkEl = container.querySelector(selectors.product_link || selectors.link) || container.closest('a') || container.querySelector('a');
        href = linkEl?.href || "";
      } else {
        const linkEl = container.tagName === 'A' ? container : container.querySelector('a');
        href = linkEl?.href || "";
      }

      if (!href) continue;

      if (processedUrls.has(href)) continue;
      processedUrls.add(href);

      let price = "";
      if (selectors.product_price || selectors.price) {
        const priceEl = container.querySelector(selectors.product_price || selectors.price);
        price = priceEl?.innerText?.trim() || "";
      }
      if (!price) {
        const priceMatch = container.innerText.match(/\$\s*\d+(?:\.\d+)?/);
        if (priceMatch) price = priceMatch[0];
      }

      let sales = "";
      if (selectors.product_sales || selectors.sales) {
        const salesEl = container.querySelector(selectors.product_sales || selectors.sales);
        sales = salesEl?.innerText?.trim() || "";
      }

      const image = getLargestProductImage(container);
      const imageSrc = image ? image.src : '';

      cards.push({
        index: cards.length + 1,
        href,
        title: title.slice(0, 180),
        price,
        sales,
        imageSrc,
        text: container.innerText?.slice(0, 500) || ""
      });
    }
    return cards;
  }

  function extractTikTokDetailCreators() {
    const creators = [];
    const processedNames = new Set();
    const imgs = Array.from(document.querySelectorAll('img'));
    
    const items = imgs.map(img => {
      let parent = img.parentElement;
      for (let i = 0; i < 4; i++) {
        if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
        const text = (parent.innerText || "").trim();
        if (/.+\n\s*[0-9.]+[kKMm]?/i.test(text)) {
          const rect = img.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 60 && rect.height > 0 && rect.height < 60) {
            return { parent, img };
          }
        }
        parent = parent.parentElement;
      }
      return null;
    }).filter(x => x !== null);

    for (const item of items) {
      const text = item.parent.innerText || "";
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const name = lines[0];
        let count = lines[1];
        
        if (!/^[0-9.]+[kKMm]?\+?$/i.test(count)) {
          const found = lines.find(l => /^[0-9.]+[kKMm]?\+?$/i.test(l));
          if (found) count = found;
          else continue;
        }

        if (processedNames.has(name) || name.toLowerCase() === "creator earns commission") continue;
        processedNames.add(name);

        let profileUrl = "";
        const a = item.parent.querySelector('a[href]');
        if (a) {
          profileUrl = a.href;
        }

        creators.push({
          username: name,
          fansCount: count,
          likesCount: "0",
          avatarUrl: item.img.src || "",
          url: profileUrl || `https://www.tiktok.com/@${name.replace(/\s+/g, '')}`
        });
      }
    }

    return creators;
  }

  function extractTikTokCreatorInfo() {
    const url = window.location.href;
    const usernameMatch = url.match(/tiktok\.com\/@([a-zA-Z0-9._-]+)/);
    if (!usernameMatch) return null;

    const username = usernameMatch[1];
    let fansCount = "0";
    let likesCount = "0";
    let avatarUrl = "";
    
    const followersEl = document.querySelector('[data-e2e="followers-count"]');
    if (followersEl) {
      fansCount = followersEl.innerText?.trim() || "0";
    } else {
      const strongs = Array.from(document.querySelectorAll('strong'));
      for (const el of strongs) {
        const parentText = String(el.parentNode?.innerText || "").toLowerCase();
        if (parentText.includes("followers") || parentText.includes("粉丝")) {
          fansCount = el.innerText?.trim() || "0";
          break;
        }
      }
    }

    const likesEl = document.querySelector('[data-e2e="likes-count"]');
    if (likesEl) {
      likesCount = likesEl.innerText?.trim() || "0";
    } else {
      const strongs = Array.from(document.querySelectorAll('strong'));
      for (const el of strongs) {
        const parentText = String(el.parentNode?.innerText || "").toLowerCase();
        if (parentText.includes("likes") || parentText.includes("赞")) {
          likesCount = el.innerText?.trim() || "0";
          break;
        }
      }
    }

    const imgEl = document.querySelector('[class*="Avatar"] img, [class*="avatar"] img, img[src*="avatar"]');
    if (imgEl) {
      avatarUrl = imgEl.src;
    }

    return {
      username,
      fansCount,
      likesCount,
      avatarUrl,
      url
    };
  }

  function readCurrentPage(cachedSelectors = null) {
    closePopups();
    const title = document.title || "";
    const url = window.location.href;

    const titleSelectors = [
      '[data-e2e="product-title"]',
      '[class*="ProductTitle"]',
      '[class*="product-title"]',
      '[class*="product_title"]',
      '[class*="GoodsTitle"]',
      '[class*="goods-title"]',
      '[class*="goods_title"]',
      '[class*="pdp-title"]',
      '.product-name',
      '.goods-name',
      'h1'
    ];
    let h1 = "";
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        h1 = el.innerText?.trim() || "";
        if (h1) break;
      }
    }
    const h2s = Array.from(document.querySelectorAll("h2"))
      .map((el) => el.innerText?.trim())
      .filter(Boolean)
      .slice(0, 5);

    const priceSelectors = [
      '[data-testid="price"]',
      ".price",
      ".product-price",
      '[itemprop="price"]',
      ".a-price-whole",
      '[class*="price"]',
      '[class*="Price"]',
    ];
    let price = "";
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        price = el.innerText?.trim() || "";
        break;
      }
    }

    const descSelectors = [
      '[itemprop="description"]',
      "#productDescription",
      ".product-description",
      '[class*="description"]',
      '[class*="Description"]',
      "article",
      "main",
    ];
    let description = "";
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        description = el.innerText?.slice(0, 2000)?.trim() || "";
        break;
      }
    }

    const ratingEl =
      document.querySelector('[class*="rating"]') ||
      document.querySelector('[class*="Rating"]') ||
      document.querySelector('[class*="stars"]');
    const rating = ratingEl?.innerText?.trim() || ratingEl?.getAttribute("content") || "";

    const reviewCountEl =
      document.querySelector('[itemprop="reviewCount"]') ||
      document.querySelector('[class*="review-count"]') ||
      document.querySelector('[class*="reviewCount"]');
    const reviewCount = reviewCountEl?.innerText?.trim() || "";

    const visibleText = document.body.innerText?.slice(0, 15000) || "";
    const images = extractRankedImages(h1, title);
    const mainImage = images[0] || null;
    const searchImage = pickSearchImage(images);

    const metaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const metaKeywords =
      document.querySelector('meta[name="keywords"]')?.getAttribute("content") || "";
    const selectedText = window.getSelection()?.toString()?.trim() || "";
    const productLinks = extractProductLinks();
    let productCards = [];
    let creatorInfo = null;
    let detailCreators = [];
    if (window.location.hostname.includes("tiktok.com")) {
      creatorInfo = extractTikTokCreatorInfo();
      detailCreators = extractTikTokDetailCreators();
    }

    if (cachedSelectors && (cachedSelectors.product_card || cachedSelectors.card)) {
      productCards = extractProductCardsWithMemory(cachedSelectors);
    } else if (window.location.hostname.includes("tiktok.com")) {
      productCards = extractTikTokProductCards();
      if (productCards.length === 0) {
        productCards = extractProductCards();
      }
    } else {
      productCards = extractProductCards();
    }

    let structuredData = null;
    try {
      const ldScript = document.querySelector('script[type="application/ld+json"]');
      if (ldScript) {
        structuredData = JSON.parse(ldScript.innerText);
      }
    } catch (_) {}

    return {
      url,
      title,
      h1,
      h2s,
      price,
      rating,
      reviewCount,
      description,
      metaDescription,
      metaKeywords,
      visibleText,
      images,
      mainImage,
      searchImage,
      targetImageUrl: searchImage?.src || mainImage?.src || "",
      targetImageSelectionReason: searchImage ? `auto_selected_for_visual_search:${searchImage.roleHint}; searchScore=${Math.round(searchImage.searchScore || 0)}` : "",
      selectedText,
      structuredData,
      productLinks,
      productCards,
      creatorInfo,
      detailCreators
    };
  }

  function extractProductInfo() {
    const page = readCurrentPage();
    return {
      title: page.h1 || page.title,
      price: page.price,
      rating: page.rating,
      reviewCount: page.reviewCount,
      description: page.description || page.metaDescription,
      images: page.images.slice(0, 5).map((i) => i.src),
      targetImageUrl: page.targetImageUrl,
      url: page.url,
    };
  }

  function findSearchInput() {
    const commonInputs = [
      'input#q', 'input#alisearch-keywords', 'input#key',
      'input[name="q"]', 'input[name="keywords"]', 'input[name="keyword"]',
      'input[type="search"]', 'input[placeholder*="搜索"]', 'input[placeholder*="Search"]',
      'input.search-input', 'input.alisearch-input'
    ];
    for (const sel of commonInputs) {
      const el = document.querySelector(sel);
      if (el && isVisibleElement(el)) return el;
    }
    return null;
  }

  async function clickImageSearchSubmitButton() {
    const candidates = findImageSearchSubmitCandidates();

    candidates.sort((a, b) => b.score - a.score);
    const bestCandidate = candidates.find((candidate) => candidate.exactTextOnly);
    const best = bestCandidate?.el || null;
    if (!best) return { clicked: false, method: "not_found" };
    const clicked = simulateHumanClick(best, { exactTarget: true });
    if (clicked) await rememberInteraction("image_search_submit", best);
    return {
      clicked,
      method: "exact_search_image_text",
      text: normalizeText(best.innerText || best.title || best.getAttribute("aria-label") || "", 80),
    };
  }

  function getRectPayload(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      normalizedLeft: Number((rect.left / Math.max(window.innerWidth, 1)).toFixed(4)),
      normalizedTop: Number((rect.top / Math.max(window.innerHeight, 1)).toFixed(4)),
      normalizedRight: Number((rect.right / Math.max(window.innerWidth, 1)).toFixed(4)),
      normalizedBottom: Number((rect.bottom / Math.max(window.innerHeight, 1)).toFixed(4)),
      normalizedCenterX: Number(((rect.left + rect.width / 2) / Math.max(window.innerWidth, 1)).toFixed(4)),
      normalizedCenterY: Number(((rect.top + rect.height / 2) / Math.max(window.innerHeight, 1)).toFixed(4)),
    };
  }

  function findImageSearchContainers() {
    const containers = new Set();
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="dialog"]',
      '[class*="modal"]',
      '[class*="popup"]',
      '[class*="upload"]',
      '[class*="imgupload"]',
      '[class*="image-search"]',
      '[class*="search-img"]',
      '[class*="searchByImage"]',
      '[class*="s-search-upload"]',
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (isVisibleElement(el)) containers.add(el);
      });
    });

    document.querySelectorAll('input[type="file"]').forEach((input) => {
      let el = input.parentElement;
      for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
        if (isVisibleElement(el)) {
          containers.add(el);
          const rect = el.getBoundingClientRect();
          if (rect.width >= 180 && rect.height >= 120) break;
        }
      }
    });

    document.querySelectorAll("img").forEach((img) => {
      const src = getBestImageSrc(img);
      const rect = img.getBoundingClientRect();
      const context = `${src} ${img.className || ""} ${img.id || ""} ${img.alt || ""}`.toLowerCase();
      if (!isVisibleElement(img) || rect.width < 60 || rect.height < 60) return;
      if (!/blob:|data:|upload|image|pic|preview|crop|search/.test(context)) return;
      let el = img.parentElement;
      for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
        if (isVisibleElement(el)) {
          containers.add(el);
          const cRect = el.getBoundingClientRect();
          if (cRect.width >= 220 && cRect.height >= 160) break;
        }
      }
    });

    return Array.from(containers).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 80 && rect.top < window.innerHeight && rect.bottom > 0;
    });
  }

  function elementInsideAny(el, containers) {
    return containers.some((container) => container === el || container.contains(el));
  }

  function findImageSearchSubmitCandidates() {
    const containers = findImageSearchContainers();
    const exactTextElements = Array.from(document.querySelectorAll("button, a, span, div, input, [role='button']"))
      .filter((el) => isVisibleElement(el))
      .filter((el) => {
        const text = normalizeText(el.innerText || el.value || el.title || el.getAttribute?.("aria-label") || "", 20);
        return text === "搜索图片" && elementInsideAny(el, containers);
      });
    const elements = Array.from(document.querySelectorAll([
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      'div[role="button"]',
      'span[role="button"]',
      '[class*="submit"]',
      '[class*="confirm"]',
      '[class*="primary"]',
      '[class*="btn"]',
      '[class*="button"]',
    ].join(",")));
    const candidates = [];
    const seenTargets = new Set();

    for (const el of exactTextElements) {
      if (seenTargets.has(el) || isFileUploadLikeElement(el)) continue;
      seenTargets.add(el);
      candidates.push({
        el,
        score: 10000,
        text: "搜索图片",
        rect: getRectPayload(el),
        inImageUi: true,
        explicitImageSearch: true,
        exactTextOnly: true,
      });
    }

    for (const rawEl of elements) {
      if (!isVisibleElement(rawEl)) continue;
      const el = getClickableActionTarget(rawEl) || rawEl;
      if (seenTargets.has(el) || !isVisibleElement(el) || isFileUploadLikeElement(el)) continue;
      seenTargets.add(el);

      const label = normalizeText(getElementLabel(el), 180);
      const rawLabel = normalizeText(getElementLabel(rawEl), 180);
      const combinedLabel = `${label} ${rawLabel}`;
      const text = normalizeText(el.innerText || el.value || el.title || el.getAttribute?.("aria-label") || "", 80);
      const inImageUi = elementInsideAny(el, containers) || elementInsideAny(rawEl, containers);
      const rawExplicitImageSearch = /搜索图片|图片搜索|以图搜索|以图搜款|找同款|搜图|开始搜索|确认搜索/i.test(combinedLabel);
      const safeConfirmInImageUi = inImageUi && /确认|确定|上传|开始|搜索/i.test(combinedLabel) && !/^搜索$/i.test(text);
      const reject = /取消|关闭|返回|重置|清空|删除|delete|remove|close|cancel|reset|back/i.test(combinedLabel);
      if (reject) continue;
      if (!rawExplicitImageSearch && !safeConfirmInImageUi) continue;
      if (!inImageUi && !rawExplicitImageSearch) continue;

      let score = rawExplicitImageSearch ? 2000 : 900;
      if (inImageUi) score += 800;
      if (/搜索图片|图片搜索|以图搜款|找同款|搜图/i.test(combinedLabel)) score += 600;
      if (/确认搜索|开始搜索/i.test(combinedLabel)) score += 360;
      if (/^搜索$/i.test(text)) score -= 1200;
      const rect = el.getBoundingClientRect();
      if (rect.top < 100) score -= 800;
      if (looksLikeVisualPrimaryButton(el)) score += 180;

      candidates.push({ el, score, text, rect: getRectPayload(el), inImageUi, explicitImageSearch: rawExplicitImageSearch });
    }

    return candidates;
  }

  function getImageSearchUiState() {
    const containers = findImageSearchContainers().map((el) => ({
      rect: getRectPayload(el),
      text: normalizeText(el.innerText || "", 180),
      className: String(el.className || "").slice(0, 120),
    }));
    const candidates = findImageSearchSubmitCandidates()
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((candidate) => ({
        score: candidate.score,
        text: candidate.text,
        rect: candidate.rect,
        inImageUi: candidate.inImageUi,
        explicitImageSearch: candidate.explicitImageSearch,
        exactTextOnly: !!candidate.exactTextOnly,
      }));
    return { containers, candidates };
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((el) => {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  function getSafeImagePasteTargets(fileInput) {
    const containers = findImageSearchContainers();
    const active = document.activeElement;
    const activeInImageUi = active && containers.some((container) => container === active || container.contains(active));
    const fileInputParents = [];
    let el = fileInput?.parentElement || null;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (isVisibleElement(el)) fileInputParents.push(el);
    }

    return uniqueElements([
      fileInput,
      ...fileInputParents,
      ...containers,
      activeInImageUi ? active : null,
    ]).filter((target) => target && !isFileUploadLikeElement(target));
  }

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.type === "READ_CURRENT_PAGE") {
        sendResponse({ ok: true, data: readCurrentPage(message.cachedSelectors) });
      } else if (message.type === "SCROLL_PAGE") {
        const amount = message.amount || 800;
        const dir = message.direction === "up" ? -1 : 1;
        window.scrollBy({
          top: amount * dir,
          behavior: "smooth"
        });
        sendResponse({ ok: true });
      } else if (message.type === "EXTRACT_PRODUCT_INFO") {
        sendResponse({ ok: true, data: extractProductInfo() });
      } else if (message.type === "GET_SELECTED_TEXT") {
        sendResponse({
          ok: true,
          data: { selectedText: window.getSelection()?.toString()?.trim() || "" },
        });
      } else if (message.type === "GET_IMAGE_SEARCH_UI_STATE") {
        sendResponse({ ok: true, data: getImageSearchUiState() });
      } else if (message.type === "CLICK_BY_TEXT") {
        closePopups();
        const textToFind = (message.text || "").trim().toLowerCase();
        let clicked = false;
        if (textToFind) {
          const elements = Array.from(document.querySelectorAll('a, button, li, span, div[role="button"], div[role="tab"]'));
          for (const el of elements) {
            const innerText = (el.innerText || "").trim().toLowerCase();
            if (innerText === textToFind) {
              clicked = simulateHumanClick(el);
              break;
            }
          }
          if (!clicked) {
            for (const el of elements) {
              const innerText = (el.innerText || "").trim().toLowerCase();
              if (innerText.includes(textToFind) && innerText.length < textToFind.length + 5) {
                clicked = simulateHumanClick(el);
                break;
              }
            }
          }
        }
        sendResponse({ ok: clicked, message: clicked ? `Clicked text: ${message.text}` : `Text not found or not clickable: ${message.text}` });
      } else if (message.type === "INPUT_TEXT_AND_SEARCH") {
        const { keyword, inputSelector, submitSelector } = message;
        if (!keyword) {
          sendResponse({ ok: false, error: "keyword is required" });
          return;
        }

        let inputEl = inputSelector ? document.querySelector(inputSelector) : findSearchInput();
        if (!inputEl) {
          sendResponse({ ok: false, error: "Could not find search input field on the page" });
          return;
        }

        (async () => {
          inputEl.focus();
          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeSetter.call(inputEl, "");
          } catch (_) {
            inputEl.value = "";
          }
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));

          for (let i = 0; i < keyword.length; i++) {
            const char = keyword[i];
            const currentText = keyword.slice(0, i + 1);
            inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: char, charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0), bubbles: true }));
            try {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              nativeSetter.call(inputEl, currentText);
            } catch (_) {
              inputEl.value = currentText;
            }
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, charCode: char.charCodeAt(0), keyCode: char.charCodeAt(0), bubbles: true }));
            await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
          }

          let submitEl = submitSelector ? document.querySelector(submitSelector) : null;
          if (!submitEl) {
            const commonSubmits = [
              '.alisearch-action', '.btn-search', 'button[type="submit"]',
              'button.search-btn', 'input[type="submit"]', '.search-button',
              'div[class*="search"] button', 'span[class*="search"] button'
            ];
            for (const sel of commonSubmits) {
              const el = document.querySelector(sel);
              if (el && isVisibleElement(el)) {
                submitEl = el;
                break;
              }
            }
          }
          if (!submitEl) {
            const buttons = Array.from(document.querySelectorAll('button, a, div, span'));
            for (const btn of buttons) {
              const txt = (btn.innerText || "").trim();
              if ((txt === '搜索' || txt === 'Search' || txt === '🔍') && isVisibleElement(btn)) {
                submitEl = btn;
                break;
              }
            }
          }

          if (submitEl) {
            simulateHumanClick(submitEl);
            sendResponse({ ok: true, clickedButton: true });
          } else if (inputEl.form) {
            inputEl.form.submit();
            sendResponse({ ok: true, submittedForm: true });
          } else {
            const eventOptions = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            inputEl.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
            inputEl.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
            inputEl.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
            sendResponse({ ok: true, pressedEnter: true });
          }
        })();

        return true;
      } else if (message.type === "IMAGE_SEARCH_IN_BROWSER") {
        const { base64 } = message;
        if (!base64) {
          sendResponse({ ok: false, error: "base64 is required" });
          return;
        }

        (async () => {
          try {
            let fileInput = null;
            const commonFileInputs = [
              'input[type="file"].upload-pic',
              'input[type="file"].s-search-upload',
              'input[accept*="image"]',
              'input[type="file"]'
            ];

            for (const sel of commonFileInputs) {
              const el = document.querySelector(sel);
              if (el) {
                fileInput = el;
                break;
              }
            }

            if (!fileInput) {
              const cameraSelectors = [
                '.camera-icon', '.s-search-upload', '.search-imgupload',
                '[class*="camera"]', '[class*="imgupload"]', '.search-imgupload-input'
              ];
              let cameraBtn = null;
              for (const sel of cameraSelectors) {
                const el = document.querySelector(sel);
                if (el && isVisibleElement(el)) {
                  cameraBtn = el;
                  break;
                }
              }
              if (cameraBtn) {
                try {
                  simulateHumanClick(cameraBtn);
                } catch (e) {
                  console.warn("Clicking cameraBtn failed due to browser security policy:", e.message);
                }
                await new Promise(r => setTimeout(r, 800));
                for (const sel of commonFileInputs) {
                  const el = document.querySelector(sel);
                  if (el) {
                    fileInput = el;
                    break;
                  }
                }
              }
            }

            const response = await fetch(`data:image/jpeg;base64,${base64}`);
            const blob = await response.blob();
            const file = new File([blob], "image_search.jpg", { type: "image/jpeg" });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            let dispatchedFallbackEvents = 0;

            if (!fileInput) {
              const fallbackTargets = getSafeImagePasteTargets(null);
              if (fallbackTargets.length === 0) {
                sendResponse({ ok: false, error: "Could not find image search upload input or safe image-search paste/drop target on the page" });
                return;
              }

              for (const target of fallbackTargets) {
                try {
                  target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
                  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
                  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
                  const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
                  target.dispatchEvent(pasteEvent);
                  dispatchedFallbackEvents++;
                } catch (e) {
                  console.warn("Safe image-search paste/drop fallback failed:", e.message);
                }
              }

              await new Promise(r => setTimeout(r, 900));
              const submitResult = await clickImageSearchSubmitButton();
              sendResponse({
                ok: dispatchedFallbackEvents > 0,
                message: dispatchedFallbackEvents > 0
                  ? "Dispatched safe image-search paste/drop fallback events"
                  : "Could not dispatch image-search fallback events",
                fallbackOnly: true,
                fallbackTargets: fallbackTargets.length,
                submitClicked: !!submitResult.clicked,
                submitMethod: submitResult.method,
                submitText: submitResult.text || "",
              });
              return;
            }

            try {
              fileInput.files = dataTransfer.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              if (typeof fileInput.onchange === 'function') fileInput.onchange();
            } catch (e) {
              console.warn("File input assignment failed or was ignored:", e.message);
            }

            try {
              const dropTargets = getSafeImagePasteTargets(fileInput);
              for (const target of dropTargets) {
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
              }
            } catch (e) {
              console.warn("Drop event upload fallback failed:", e.message);
            }

            try {
              const pasteTargets = getSafeImagePasteTargets(fileInput);
              for (const target of pasteTargets) {
                const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
                target.dispatchEvent(pasteEvent);
              }
            } catch (e) {
              console.warn("Clipboard paste upload fallback failed:", e.message);
            }

            await new Promise(r => setTimeout(r, 900));
            const submitResult = await clickImageSearchSubmitButton();
            sendResponse({
              ok: true,
              message: "Successfully dispatched image search upload events",
              submitClicked: !!submitResult.clicked,
              submitMethod: submitResult.method,
              submitText: submitResult.text || "",
            });
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
          }
        })();
        return true;
      } else if (message.type === "CLICK_BY_COORDINATE") {
        const { x, y, learnKind } = message;
        if (x === undefined || y === undefined) {
          sendResponse({ ok: false, error: "x and y coordinates are required" });
          return;
        }

        const clientX = x <= 1.0 ? x * window.innerWidth : x;
        const clientY = y <= 1.0 ? y * window.innerHeight : y;

        try {
          const element = document.elementFromPoint(clientX, clientY);
          if (!element) {
            sendResponse({ ok: false, error: `No element found at coordinate (${clientX}, ${clientY})` });
            return;
          }

          let isFileInput = false;
          if (element.tagName === 'INPUT' && element.type === 'file') {
            isFileInput = true;
          } else if (element.tagName === 'LABEL' && element.htmlFor) {
            const target = document.getElementById(element.htmlFor);
            if (target && target.tagName === 'INPUT' && target.type === 'file') isFileInput = true;
          } else if (element.querySelector?.('input[type="file"]') || element.closest?.('input[type="file"]')) {
            isFileInput = true;
          } else {
            const iden = `${element.className || ""} ${element.id || ""} ${element.tagName || ""}`.toLowerCase();
            if (iden.includes('upload') || iden.includes('camera') || iden.includes('imgupload') || iden.includes('pic')) {
              const fileInputs = document.querySelectorAll('input[type="file"]');
              for (const fi of fileInputs) {
                if (element.contains(fi) || fi.contains(element) || (element.parentElement && element.parentElement.contains(fi))) {
                  isFileInput = true;
                  break;
                }
              }
            }
          }

          if (isFileInput) {
            sendResponse({
              ok: false,
              error: "Proactively blocked click_by_coordinate on file upload/camera elements to avoid Chrome security exceptions. Please use the dedicated 'image_search_in_browser' tool instead."
            });
            return;
          }

          const clicked = simulateHumanClick(element, { exactTarget: learnKind === "image_search_submit" });
          const learnedInteraction = learnKind || (isImageSearchSubmitLike(element) ? "image_search_submit" : "");
          if (clicked && learnedInteraction) {
            rememberInteraction(learnedInteraction, element).catch((err) => {
              console.warn("Failed to remember interaction:", err.message);
            });
          }

          sendResponse({
            ok: clicked,
            message: `Clicked element at (${Math.round(clientX)}, ${Math.round(clientY)})`,
            tag: element.tagName,
            text: (element.innerText || element.value || element.title || "").slice(0, 100),
            learnedInteraction,
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return true;
  });

  // ── Ozon Assistant Shadow DOM Floating UI and Overlay Chat ──
  function injectFloatingUI() {
    const hostname = window.location.hostname;
    const isOzon = hostname.includes("ozon.ru") || hostname.includes("ozon.com");
    const is1688 = hostname.includes("1688.com");
    if (!isOzon && !is1688) return;

    // Check if on a product detail page
    const isProductPage = isOzon && (window.location.pathname.includes("/product/") || /\/\d{8,15}\/?/i.test(window.location.pathname));
    const isSellerPage = isOzon && window.location.pathname.includes("/seller/");
    const isSearchOrCatalogPage = isOzon && (/\/search|\/category|\/brand|\/seller\//i.test(window.location.pathname) || document.querySelectorAll('a[href*="/product/"]').length > 6);

    const GROWTH_ACTIONS = {
      diagnose_store_growth: {
        label: "店铺感知",
        short: "店铺",
        instruction: "一键感知当前 Ozon 店铺经营状态。不能只凭当前截图下结论：请先判断当前页面是店铺页、商品页还是搜索/类目页，并读取平台属性、主营类目、价格带、目标客群、使用场景、店铺定位和视觉调性/格调；若是店铺页，必须结合 Ozon 站内搜索/热卖榜与 2-3 个同类高排名店铺或头部竞品页面截屏学习，再分析商品结构、转化漏斗、履约风险、评分信任、竞品对标，并输出今日必须处理的增长动作。",
      },
      diagnose_sku_funnel: {
        label: "商品分析/追踪",
        short: "商品",
        instruction: "分析并追踪当前 Ozon 商品。请读取页面标题、价格、评分、评论、主图、详情页和可见竞品信息，判断曝光、点击、加购、付款、利润、履约和评价风险，并给出是否加入 7 天增长实验。",
      },
      scan_competitor_changes: {
        label: "竞品跟踪",
        short: "竞品",
        instruction: "把当前 Ozon 页面作为竞品或竞品集合进行跟踪感知。请分析价格、促销、主图、标题关键词、评分评论、库存/履约线索和可反打机会，并输出监控建议。",
      },
      find_expansion_opportunities: {
        label: "机会扫描",
        short: "机会",
        instruction: "基于当前 Ozon 搜索、类目、店铺或商品页面扫描增长机会。请识别价格带空位、关键词入口、可扩展 SKU、俄区需求线索和第一批低风险实验方向。",
      },
      filter_supplier_sources: {
        label: "货源筛选",
        short: "货源",
        instruction: "基于当前 Ozon 商品、候选扩品方向或平台趋势机会筛选国内供应商货源。请重点验证同款/相似款图片匹配、规格一致、起批量、采购价、跨境物流、Ozon 佣金、关税和 RUB 净利润率；未获得真实供应商详情页时不得输出采购直达链接。",
      },
      explore_platform_trends: {
        label: "平台趋势",
        short: "趋势",
        instruction: "基于当前 Ozon 搜索、类目、品牌或热卖页面扫描平台商品机会和趋势窗口。请识别热卖共性、价格带、评价门槛、俄语关键词、季节性需求、Yandex/Google RU/Google Trends 证据或待验证假设，并明确这不是本店扩品执行清单。",
      },
      rewrite_listing: {
        label: "Listing 改版",
        short: "改版",
        instruction: "基于当前 Ozon 商品页生成俄语 SEO Listing 改版方案，包括标题、主图俄语卖点、详情页描述、规格参数和风险词提醒。",
      },
      analyze_review_defects: {
        label: "评论缺陷",
        short: "评论",
        instruction: "基于当前 Ozon 商品页或可见评论信息分析俄罗斯买家原声痛点。请归纳质量、包装、物流、尺寸、预期落差和退换货风险，并输出可落地的商品/页面改良动作。",
      },
      review_experiment_result: {
        label: "实验复盘",
        short: "复盘",
        instruction: "复盘当前商品或店铺的增长实验。如果没有实验日期窗口，请先输出需要补齐的基线数据、观察窗口和干扰项，而不是编造结论。",
      },
    };

    const getPageGrowthActions = () => {
      if (isSellerPage) {
        return ["diagnose_store_growth", "diagnose_sku_funnel", "scan_competitor_changes", "explore_platform_trends"];
      }
      if (isProductPage) {
        return ["diagnose_sku_funnel", "rewrite_listing", "filter_supplier_sources", "scan_competitor_changes"];
      }
      if (isSearchOrCatalogPage) {
        return ["explore_platform_trends", "scan_competitor_changes", "filter_supplier_sources"];
      }
      return ["diagnose_store_growth", "explore_platform_trends"];
    };

    // Create Shadow DOM Container
    const container = document.createElement("div");
    container.id = "ozon-assistant-root";
    const shadow = container.attachShadow({ mode: "open" });
    document.body.appendChild(container);

    // Initial theme loading
    chrome.storage.local.get(["settingsTheme"], (data) => {
      const themeVal = data.settingsTheme || "system";
      container.className = `theme-${themeVal}`;
    });

    // Add Styles inside Shadow DOM
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        --bg-main: rgba(18, 18, 24, 0.95);
        --bg-dock: rgba(248, 250, 252, 0.88);
        --border-main: rgba(255, 255, 255, 0.08);
        --text-color: #ffffff;
        --text-secondary: #9ca3af;
        --dock-icon: #111827;
        --dock-muted: rgba(17, 24, 39, 0.08);
        --dock-muted-hover: rgba(17, 24, 39, 0.13);
        --dock-selected: linear-gradient(135deg, #2563eb, #4f46e5);
        --dock-selected-shadow: rgba(37, 99, 235, 0.26);
        --input-bg: rgba(255, 255, 255, 0.04);
        --btn-bg: rgba(255, 255, 255, 0.05);
        --header-bg: rgba(255, 255, 255, 0.02);
        --shadow-color: rgba(0, 0, 0, 0.5);
        --tooltip-bg: #09090b;
        --scrollbar-thumb: rgba(255, 255, 255, 0.15);
        --bubble-assistant-bg: rgba(255, 255, 255, 0.05);
        --bubble-assistant-text: #e2e8f0;
      }
      :host(.theme-light) {
        --bg-main: rgba(255, 255, 255, 0.98);
        --bg-dock: rgba(245, 245, 247, 0.9);
        --border-main: rgba(0, 0, 0, 0.1);
        --text-color: #000000;
        --text-secondary: #515154;
        --dock-icon: #111827;
        --dock-muted: rgba(17, 24, 39, 0.08);
        --dock-muted-hover: rgba(17, 24, 39, 0.13);
        --dock-selected: linear-gradient(135deg, #2563eb, #4f46e5);
        --dock-selected-shadow: rgba(37, 99, 235, 0.26);
        --input-bg: rgba(0, 0, 0, 0.04);
        --btn-bg: rgba(0, 0, 0, 0.06);
        --header-bg: rgba(0, 0, 0, 0.02);
        --shadow-color: rgba(0, 0, 0, 0.1);
        --tooltip-bg: #f5f5f7;
        --scrollbar-thumb: rgba(0, 0, 0, 0.2);
        --bubble-assistant-bg: rgba(0, 0, 0, 0.05);
        --bubble-assistant-text: #000000;
      }
      @media (prefers-color-scheme: light) {
        :host(.theme-system) {
          --bg-main: rgba(255, 255, 255, 0.98);
          --bg-dock: rgba(245, 245, 247, 0.9);
          --border-main: rgba(0, 0, 0, 0.1);
          --text-color: #000000;
          --text-secondary: #515154;
          --dock-icon: #111827;
          --dock-muted: rgba(17, 24, 39, 0.08);
          --dock-muted-hover: rgba(17, 24, 39, 0.13);
          --dock-selected: linear-gradient(135deg, #2563eb, #4f46e5);
          --dock-selected-shadow: rgba(37, 99, 235, 0.26);
          --input-bg: rgba(0, 0, 0, 0.04);
          --btn-bg: rgba(0, 0, 0, 0.06);
          --header-bg: rgba(0, 0, 0, 0.02);
          --shadow-color: rgba(0, 0, 0, 0.1);
          --tooltip-bg: #f5f5f7;
          --scrollbar-thumb: rgba(0, 0, 0, 0.2);
          --bubble-assistant-bg: rgba(0, 0, 0, 0.05);
          --bubble-assistant-text: #000000;
        }
      }
      * {
        box-sizing: border-box;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      
      /* Floating Dock Pill */
      .floating-dock {
        position: fixed;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--bg-dock);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid var(--border-main);
        border-radius: 34px;
        padding: 10px 7px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        z-index: 2147483640;
        box-shadow: 0 18px 46px rgba(37, 99, 235, 0.16), 0 10px 28px rgba(15, 23, 42, 0.12);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--text-color);
      }
      .floating-dock:hover {
        border-color: rgba(37, 99, 235, 0.18);
        box-shadow: 0 20px 54px rgba(37, 99, 235, 0.2), 0 12px 30px rgba(15, 23, 42, 0.13);
      }
      
      /* Dock Icons */
      .dock-btn {
        width: 54px;
        height: 54px;
        border-radius: 50%;
        border: none;
        background: var(--dock-muted);
        color: var(--dock-icon);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: all 0.2s ease;
      }
      .dock-btn .dock-label {
        position: absolute;
        bottom: 7px;
        left: 0;
        right: 0;
        text-align: center;
        font-size: 9px;
        font-weight: 800;
        line-height: 1;
        color: currentColor;
      }
      .dock-btn .dock-symbol {
        transform: translateY(-5px);
        display: inline-flex;
      }
      .dock-btn:hover {
        background: var(--dock-muted-hover);
        transform: translateY(-1px);
      }
	      .dock-btn.busy,
	      .dock-btn:disabled {
	        cursor: not-allowed;
	        opacity: 0.45;
	        transform: none;
	      }
      .dock-btn.activate-btn {
        background: var(--dock-selected);
        color: #ffffff;
        box-shadow: 0 8px 18px var(--dock-selected-shadow);
      }
      .dock-btn.activate-btn:hover {
        box-shadow: 0 10px 24px var(--dock-selected-shadow);
      }
      .dock-btn svg {
        width: 21px;
        height: 21px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .dock-btn.store-btn {
        background: var(--dock-selected);
        color: #ffffff;
        box-shadow: 0 8px 18px var(--dock-selected-shadow);
      }
      .dock-btn.product-btn {
        background: var(--dock-muted);
        color: var(--dock-icon);
      }
      .dock-btn.competitor-btn {
        background: var(--dock-muted);
      }
      .dock-btn.opportunity-btn {
        background: var(--dock-muted);
        color: var(--dock-icon);
      }
      .dock-btn.listing-btn {
        background: var(--dock-muted);
        color: var(--dock-icon);
      }
      .dock-btn.review-btn {
        background: var(--dock-muted);
        color: var(--dock-icon);
      }
      .dock-btn.growth-btn {
        background: var(--dock-muted);
        color: var(--dock-icon);
      }
      .dock-btn.settings-mini-btn {
        width: 42px;
        height: 42px;
        align-self: center;
        opacity: 0.88;
        background: rgba(17, 24, 39, 0.06);
        color: #374151;
      }
      .dock-pulse {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: #10b981;
        border: 2px solid var(--bg-dock);
        box-shadow: 0 0 0 4px rgba(16,185,129,0.16);
      }
      .dock-btn[title]::after {
        content: attr(title);
        position: absolute;
        right: 56px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--tooltip-bg);
        color: var(--text-color);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        border: 1px solid var(--border-main);
      }
      .dock-btn:hover::after {
        opacity: 1;
      }

      .chat-session-control {
        padding: 10px 14px;
        border-bottom: 1px solid var(--border-main);
        background: var(--header-bg);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .chat-session-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .chat-session-label {
        font-size: 10px;
        color: var(--text-secondary);
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .chat-session-mode-text {
        font-size: 11px;
        color: var(--text-secondary);
        line-height: 1.35;
        margin-top: 2px;
      }
      .chat-session-mode-text.resume {
        color: #005bff;
        font-weight: 700;
      }
      .chat-session-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .chat-session-btn {
        border: 1px solid var(--border-main);
        background: var(--input-bg);
        color: var(--text-color);
        border-radius: 8px;
        padding: 6px 9px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .chat-session-btn:hover {
        border-color: #005bff;
        color: #005bff;
      }
      .chat-session-history-panel.hidden {
        display: none !important;
      }
      .chat-session-history-panel {
        max-height: 190px;
        overflow-y: auto;
        border: 1px solid var(--border-main);
        border-radius: 10px;
        background: var(--input-bg);
        padding: 8px;
      }
      .chat-session-history-item {
        border-bottom: 1px solid var(--border-main);
        padding: 8px 0;
      }
      .chat-session-history-item:last-child {
        border-bottom: none;
      }
      .chat-session-history-title {
        font-size: 11px;
        font-weight: 800;
        color: var(--text-color);
        line-height: 1.35;
      }
      .chat-session-history-meta,
      .chat-session-empty {
        font-size: 10px;
        color: var(--text-secondary);
        line-height: 1.45;
        margin-top: 3px;
      }
      .chat-session-resume-btn {
        margin-top: 6px;
        border: 1px solid rgba(0,91,255,0.32);
        background: rgba(0,91,255,0.08);
        color: #005bff;
        border-radius: 7px;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 800;
        cursor: pointer;
      }

      /* Chat Overlay Window */
      .chat-overlay {
        position: fixed;
        right: 80px;
        bottom: 30px;
        width: 430px;
        height: 600px;
        background: var(--bg-main);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border-main);
        border-radius: 20px;
        box-shadow: 0 20px 60px var(--shadow-color);
        display: flex;
        flex-direction: column;
        z-index: 2147483642;
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        color: var(--text-color);
      }
      .chat-overlay.hidden {
        display: none !important;
      }
      
      .chat-header {
        padding: 14px 18px;
        background: var(--header-bg);
        border-bottom: 1px solid var(--border-main);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
      }
      .chat-title-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
      }
      .status-dot.active {
        background: #3b82f6;
        box-shadow: 0 0 8px #3b82f6;
        animation: pulse 1.5s infinite;
      }
      .chat-title {
        color: var(--text-color);
        font-weight: 700;
        font-size: 14px;
        background: linear-gradient(135deg, #005bff, #ff005b);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .header-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
      }
      .header-btn:hover {
        background: var(--btn-bg);
        color: var(--text-color);
      }
      .header-btn svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
      }

      /* Chat Skill Selector */
      .skill-selector-bar {
        padding: 8px 18px;
        background: rgba(0, 91, 255, 0.04);
        border-bottom: 1px solid var(--border-main);
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .skill-label {
        font-size: 11px;
        color: var(--text-secondary);
        font-weight: 600;
      }
      .skill-select {
        flex: 1;
        background: var(--input-bg);
        border: 1px solid var(--border-main);
        border-radius: 6px;
        color: var(--text-color);
        font-size: 12px;
        padding: 4px 8px;
        outline: none;
        cursor: pointer;
      }

      .growth-sense-panel {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-main);
        background: linear-gradient(180deg, rgba(0,91,255,0.10), rgba(16,185,129,0.05));
      }
      .sense-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .sense-title {
        font-size: 13px;
        font-weight: 800;
        color: var(--text-color);
      }
      .sense-subtitle {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 2px;
        line-height: 1.35;
      }
      .sense-badge {
        font-size: 10px;
        font-weight: 800;
        border: 1px solid rgba(16,185,129,0.28);
        color: #10b981;
        background: rgba(16,185,129,0.10);
        padding: 3px 7px;
        border-radius: 999px;
        white-space: nowrap;
      }
      .sense-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .sense-action-btn {
        min-height: 42px;
        border: 1px solid var(--border-main);
        border-radius: 10px;
        background: var(--input-bg);
        color: var(--text-color);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        padding: 7px 9px;
        transition: all 0.2s ease;
      }
      .sense-action-btn:hover {
        border-color: #005bff;
        background: rgba(0,91,255,0.12);
        transform: translateY(-1px);
      }
      .sense-action-btn strong {
        font-size: 12px;
        line-height: 1.2;
      }
      .sense-action-btn span {
        font-size: 10px;
        color: var(--text-secondary);
        line-height: 1.25;
        margin-top: 3px;
      }

      /* Chat Message Area */
      .chat-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .msg {
        max-width: 85%;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .msg.user {
        align-self: flex-end;
      }
      .msg.assistant {
        align-self: flex-start;
      }
      .bubble {
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }
      .msg.user .bubble {
        background: #005bff;
        color: #ffffff;
        border-bottom-right-radius: 2px;
      }
      .msg.assistant .bubble {
        background: var(--bubble-assistant-bg);
        color: var(--bubble-assistant-text);
        border-bottom-left-radius: 2px;
        border: 1px solid var(--border-main);
      }
	      .msg-meta {
	        font-size: 10px;
	        color: var(--text-secondary);
	      }
	      .msg-tools {
	        display: flex;
	        gap: 6px;
	        align-items: center;
	      }
	      .msg.assistant .msg-meta {
	        display: flex;
	        align-items: center;
	        justify-content: space-between;
	        gap: 8px;
	      }
	      .copy-msg-btn {
	        border: 1px solid var(--border-main);
	        background: var(--input-bg);
	        color: var(--text-secondary);
	        border-radius: 6px;
	        padding: 2px 7px;
	        font-size: 10px;
	        cursor: pointer;
	      }
	      .copy-msg-btn:hover {
	        color: var(--text-color);
	        border-color: #005bff;
	      }
      .msg.user .msg-meta {
        text-align: right;
      }

      /* Terminal Logs Style */
      .terminal-log {
        background: var(--input-bg);
        border: 1px solid var(--border-main);
        border-radius: 8px;
        padding: 10px 14px;
        font-family: inherit;
        font-size: 11px;
        color: var(--text-secondary);
        max-height: 150px;
        overflow-y: auto;
        white-space: pre-wrap;
        margin: 4px 0;
      }
      .log-line {
        line-height: 1.4;
        margin-bottom: 2px;
      }

      /* Chat Footer input */
      .chat-footer {
        padding: 12px 16px;
        border-top: 1px solid var(--border-main);
        display: flex;
        gap: 8px;
      }
      .chat-input {
        flex: 1;
        background: var(--input-bg);
        border: 1px solid var(--border-main);
        border-radius: 10px;
        color: var(--text-color);
        padding: 10px 14px;
        font-size: 13px;
        outline: none;
        transition: border-color 0.2s ease;
      }
      .chat-input:focus {
        border-color: #005bff;
      }
      .send-btn {
        background: #005bff;
        border: none;
        color: #ffffff;
        padding: 0 16px;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s ease;
      }
      .send-btn:hover {
        opacity: 0.9;
      }

      /* Settings Flyout Drawer */
      .settings-drawer {
        position: fixed;
        right: 80px;
        bottom: 30px;
        width: 380px;
        height: 580px;
        background: var(--bg-main);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--border-main);
        border-radius: 20px;
        box-shadow: 0 20px 60px var(--shadow-color);
        display: flex;
        flex-direction: column;
        z-index: 2147483643;
        overflow: hidden;
      }
      .settings-drawer.hidden {
        display: none !important;
      }
      .settings-body {
        padding: 20px;
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .form-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .form-input {
        background: var(--input-bg);
        border: 1px solid var(--border-main);
        border-radius: 8px;
        color: var(--text-color);
        padding: 8px 12px;
        font-size: 13px;
        outline: none;
      }
      .form-input:focus {
        border-color: #005bff;
      }
      .settings-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--border-main);
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .settings-btn {
        padding: 8px 16px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .settings-btn.save {
        background: #005bff;
        color: #ffffff;
        border: none;
      }
      .settings-btn.cancel {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border-main);
      }

      /* New Settings Panel Styling */
      .settings-section-title {
        font-size: 11px;
        font-weight: 800;
        color: #005bff;
        text-transform: uppercase;
        border-bottom: 1px solid var(--border-main);
        padding-bottom: 4px;
        margin-top: 8px;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
      }
      .form-row {
        display: flex;
        gap: 12px;
      }
      .flex-1 {
        flex: 1;
      }
      .password-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }
      .password-input-wrapper .form-input {
        width: 100%;
        padding-right: 36px;
      }
      .password-input-wrapper .eye-btn {
        position: absolute;
        right: 8px;
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 14px;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        outline: none;
      }
      .password-input-wrapper .eye-btn:hover {
        color: var(--text-color);
      }
      .quick-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .quick-chips .chip {
        font-size: 10px;
        background: var(--btn-bg);
        border: 1px solid var(--border-main);
        padding: 3px 8px;
        border-radius: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .quick-chips .chip:hover {
        background: var(--border-main);
        color: var(--text-color);
      }
      .quick-chips .chip.active {
        background: rgba(0, 91, 255, 0.15);
        border-color: #005bff;
        color: #005bff;
      }
      .form-range {
        width: 100%;
        accent-color: #005bff;
        cursor: pointer;
        margin: 4px 0;
      }

      /* Renders for Markdown final reports */
      .md-report {
        color: var(--text-color) !important;
      }
      .md-report h1, .md-report h2, .md-report h3, .md-report p, .md-report li, .md-report ul, .md-report ol, .md-report td, .md-report th, .md-report tr {
        color: var(--text-color) !important;
      }
      .md-report h1 { font-size: 15px; }
      .md-report h2 { font-size: 14px; border-bottom: 1px solid var(--border-main); padding-bottom: 2px; }
      .md-report h3 { font-size: 13px; }
      .md-report p { margin: 4px 0 8px 0; }
      .md-report ul, .md-report ol { margin: 4px 0; padding-left: 18px; }
      .md-report li { margin-bottom: 2px; }
      .md-report code { background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 11px; }

      /* Toast Notification */
      .toast {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #09090b;
        border: 1px solid #10b981;
        border-radius: 8px;
        padding: 10px 20px;
        color: #ffffff;
        font-size: 13px;
        font-weight: 500;
        z-index: 2147483645;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        gap: 8px;
        animation: fadeInOut 3s forwards;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -10px); }
        10% { opacity: 1; transform: translate(-50%, 0); }
        90% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, -10px); }
      }
    `;
    shadow.appendChild(style);

    // Create Floating Dock (Pill Widget)
    const dock = document.createElement("div");
    dock.className = "floating-dock";

    const actionIconMap = {
      diagnose_store_growth: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
      diagnose_sku_funnel: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>',
      scan_competitor_changes: '<svg viewBox="0 0 24 24"><path d="M10.5 20.5 4 14l6.5-6.5"/><path d="M4 14h16"/><path d="M13.5 3.5 20 10l-6.5 6.5"/></svg>',
      find_expansion_opportunities: '<svg viewBox="0 0 24 24"><path d="M12 2v5"/><path d="M12 17v5"/><path d="m4.93 4.93 3.54 3.54"/><path d="m15.53 15.53 3.54 3.54"/><path d="M2 12h5"/><path d="M17 12h5"/><path d="m4.93 19.07 3.54-3.54"/><path d="m15.53 8.47 3.54-3.54"/></svg>',
      filter_supplier_sources: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 7l2 14h8l2-14"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9 12h6"/><path d="M10 16h4"/></svg>',
      explore_platform_trends: '<svg viewBox="0 0 24 24"><path d="M3 17 9 11l4 4 8-8"/><path d="M14 7h7v7"/><path d="M4 21h16"/></svg>',
      rewrite_listing: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      analyze_review_defects: '<svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>',
    };
    const actionClassMap = {
      diagnose_store_growth: "store-btn",
      diagnose_sku_funnel: "product-btn",
      scan_competitor_changes: "competitor-btn",
      find_expansion_opportunities: "opportunity-btn",
      filter_supplier_sources: "opportunity-btn",
      explore_platform_trends: "opportunity-btn",
      rewrite_listing: "listing-btn",
      analyze_review_defects: "review-btn",
    };
    const dockActionButtons = [];
    const createDockActionButton = (actionId) => {
      const action = GROWTH_ACTIONS[actionId] || GROWTH_ACTIONS.diagnose_store_growth;
      const btn = document.createElement("button");
      btn.className = `dock-btn ${actionClassMap[actionId] || ""}`;
      btn.dataset.action = actionId;
      btn.title = action.label;
      btn.innerHTML = `
        ${actionId === "diagnose_store_growth" ? '<span class="dock-pulse"></span>' : ""}
        <span class="dock-symbol">${actionIconMap[actionId] || actionIconMap.diagnose_store_growth}</span>
        <span class="dock-label">${action.short}</span>
      `;
      dockActionButtons.push(btn);
      return btn;
    };
    const pageActionButtons = getPageGrowthActions().map(createDockActionButton);
    
    // Add Bind/Status button to Pill Dock if on seller page
    let bindShopBtn = null;
    if (isSellerPage) {
      bindShopBtn = document.createElement("button");
      bindShopBtn.className = "dock-btn settings-mini-btn";
      bindShopBtn.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      `;
    }

    const dashBtn = document.createElement("button");
    dashBtn.className = "dock-btn growth-btn";
    dashBtn.title = "打开增长后台";
    dashBtn.innerHTML = `
      <span class="dock-symbol"><svg viewBox="0 0 24 24"><path d="M3 17h4v4H3z"/><path d="M10 11h4v10h-4z"/><path d="M17 3h4v18h-4z"/></svg></span>
      <span class="dock-label">后台</span>
    `;

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "dock-btn settings-mini-btn";
    settingsBtn.title = "配置参数";
    settingsBtn.innerHTML = `
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    `;

    pageActionButtons.forEach((btn) => dock.appendChild(btn));
    if (bindShopBtn) dock.appendChild(bindShopBtn);
    dock.appendChild(dashBtn);
    dock.appendChild(settingsBtn);
    shadow.appendChild(dock);

    // Create Settings Flyout Drawer
    const settingsDrawer = document.createElement("div");
    settingsDrawer.className = "settings-drawer hidden";
    settingsDrawer.innerHTML = `
      <div class="chat-header">
        <div class="chat-title-group">
          <span class="chat-title">助手与大模型参数配置</span>
        </div>
      </div>
      <div class="settings-body">
        <div class="settings-section-title">Ozon 店铺配置 (Seller API)</div>
        <div class="form-group">
          <label class="form-label">活动店铺切换</label>
          <select class="form-input" id="ozon-active-shop-select">
            <option value="">-- 未绑定店铺 --</option>
          </select>
        </div>
        
        <div class="form-group" style="margin-top: -5px; margin-bottom: 15px;">
          <div id="ozon-drawer-shops-list" style="display:flex; flex-direction:column; gap:4px; margin-bottom:10px;">
            <!-- list of bound shops -->
          </div>
          <button class="eye-btn" id="ozon-drawer-toggle-add-btn" type="button" style="display:block; width:100%; border:1px dashed var(--border-main); padding:6px; font-size:11px; border-radius:4px; text-align:center; cursor:pointer; background:none; color:var(--text-color);">➕ 绑定新 Ozon 店铺</button>
        </div>

        <div id="ozon-drawer-add-shop-form" class="hidden" style="border:1px solid var(--border-main); border-radius:6px; padding:10px; background:rgba(255,255,255,0.02); margin-bottom:15px; display:flex; flex-direction:column; gap:8px;">
          <div style="font-size:11px; font-weight:600; margin-bottom:4px; color:var(--text-color)">➕ 新增自营店铺 API</div>
          <input type="text" class="form-input" id="ozon-new-name" placeholder="店铺备注名，如: Надёжный 1号">
          <div class="form-row" style="display:flex; gap:8px;">
            <input type="text" class="form-input" id="ozon-new-client-id" placeholder="Client-Id" style="flex:1;">
            <input type="password" class="form-input" id="ozon-new-api-key" placeholder="API Key" style="flex:1;">
          </div>
          <div class="form-row" style="display:flex; gap:8px;">
            <select class="form-input" id="ozon-new-wh-type" style="flex:1;">
              <option value="FBS">FBS (跨境自集运)</option>
              <option value="FBO">FBO (俄罗斯本土仓)</option>
            </select>
            <button class="eye-btn" id="ozon-drawer-save-shop-btn" type="button" style="flex:1; background:#005bff; color:#fff; border:none; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer; height:32px;">确认保存店铺</button>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:15px;">
          <label class="form-label">目标毛利率 (%)</label>
          <input type="number" class="form-input" id="ozon-target-margin" value="20" min="5" max="90">
        </div>

        <div class="settings-section-title">大模型参数配置 (LLM Config)</div>
        <div class="form-group">
          <label class="form-label">LLM Provider</label>
          <select class="form-input" id="llm-provider">
            <option value="qwen">Qwen (通义千问)</option>
            <option value="anthropic">Anthropic</option>
            <option value="openrouter">OpenRouter</option>
            <option value="thinktv">ThinkTV</option>
            <option value="custom">Custom (自定义 OpenAI 端点)</option>
          </select>
        </div>

        <div class="form-group hidden" id="custom-url-container">
          <label class="form-label">自定义 API Endpoint</label>
          <input type="text" class="form-input" id="llm-base-url" placeholder="https://www.thinktv.ai/v1">
        </div>

        <div class="form-group">
          <label class="form-label">LLM API Key</label>
          <div class="password-input-wrapper">
            <input type="password" class="form-input" id="llm-api-key" placeholder="输入接口 API Key">
            <button class="eye-btn" id="llm-api-key-toggle" type="button" title="显示密钥">👁️</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">推理模型 (Model)</label>
          <input type="text" class="form-input" id="llm-model" value="qwen3.5-plus">
          <div class="quick-chips" id="llm-model-chips">
            <span class="chip" data-val="qwen3.7-max">qwen3.7-max</span>
            <span class="chip" data-val="qwen3.6-plus">qwen3.6-plus</span>
            <span class="chip" data-val="qwen3.5-plus">qwen3.5-plus</span>
            <span class="chip" data-val="qwen-vl-max">qwen-vl-max</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">生图模型 (Image Gen Model)</label>
          <input type="text" class="form-input" id="image-gen-model" value="qwen-image-2.0">
          <div class="quick-chips" id="image-gen-model-chips">
            <span class="chip" data-val="qwen-image-2.0">qwen-image-2.0</span>
            <span class="chip" data-val="wanx2.1-t2i-turbo">wanx2.1-t2i-turbo</span>
            <span class="chip" data-val="wanx2.1-i2i-turbo">wanx2.1-i2i-turbo</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" style="display:flex; justify-content:space-between;">
            <span>采样温度 (Temperature)</span>
            <span id="temp-val-display" style="color:#005bff; font-weight:700;">0.2</span>
          </label>
          <input type="range" class="form-range" id="llm-temperature" min="0" max="1.5" step="0.05" value="0.2">
        </div>

        <div class="form-group">
          <label class="form-label">最大循环步数 (Max Steps)</label>
          <input type="number" class="form-input" id="llm-max-steps" value="25" min="1" max="100">
        </div>

        <div class="settings-section-title">界面配置 (UI Options)</div>
        <div class="form-group">
          <label class="form-label">界面主题 (Theme)</label>
          <select class="form-input" id="settings-theme">
            <option value="system">跟随系统 (System)</option>
            <option value="dark">深色模式 (Dark)</option>
            <option value="light">浅色模式 (Light)</option>
          </select>
        </div>
      </div>
      <div class="settings-footer">
        <button class="settings-btn cancel" id="settings-cancel">取消</button>
        <button class="settings-btn save" id="settings-save">保存</button>
      </div>
    `;
    shadow.appendChild(settingsDrawer);

    // Setup interactive handlers for new Settings parameters
    const toggleCustomUrlContainer = (provider) => {
      const containerEl = shadow.getElementById("custom-url-container");
      if (containerEl) {
        if (provider === "custom") {
          containerEl.classList.remove("hidden");
        } else {
          containerEl.classList.add("hidden");
        }
      }
    };

    const providerSelect = shadow.getElementById("llm-provider");
    if (providerSelect) {
      providerSelect.addEventListener("change", (e) => {
        toggleCustomUrlContainer(e.target.value);
      });
    }

    // Toggle password visibility
    const llmApiKeyToggle = shadow.getElementById("llm-api-key-toggle");
    const llmApiKeyInput = shadow.getElementById("llm-api-key");
    if (llmApiKeyToggle && llmApiKeyInput) {
      llmApiKeyToggle.addEventListener("click", () => {
        if (llmApiKeyInput.type === "password") {
          llmApiKeyInput.type = "text";
          llmApiKeyToggle.innerText = "🔒";
        } else {
          llmApiKeyInput.type = "password";
          llmApiKeyToggle.innerText = "👁️";
        }
      });
    }

    // Temperature slider display value
    const tempSlider = shadow.getElementById("llm-temperature");
    const tempValDisplay = shadow.getElementById("temp-val-display");
    if (tempSlider && tempValDisplay) {
      tempSlider.addEventListener("input", (e) => {
        tempValDisplay.innerText = e.target.value;
      });
    }

    // Quick selection chips
    const initChips = (containerId, inputId) => {
      const containerEl = shadow.getElementById(containerId);
      const inputEl = shadow.getElementById(inputId);
      if (containerEl && inputEl) {
        const chips = containerEl.querySelectorAll(".chip");
        chips.forEach(chip => {
          chip.addEventListener("click", () => {
            chips.forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            inputEl.value = chip.getAttribute("data-val");
          });
        });
      }
    };
    initChips("llm-model-chips", "llm-model");
    initChips("image-gen-model-chips", "image-gen-model");

    // Create Chat Dialog Overlay Window
    const chatOverlay = document.createElement("div");
    chatOverlay.className = "chat-overlay hidden";
    chatOverlay.innerHTML = `
      <div class="chat-header" id="chat-drag-handle">
        <div class="chat-title-group">
          <div class="status-dot" id="chat-status-dot"></div>
          <span class="chat-title">Ozon AI 运营智脑舱</span>
        </div>
        <div class="header-actions">
          <button class="header-btn" id="chat-dashboard-btn" title="打开数据看板" style="margin-right: 8px; font-size: 14px; background: transparent; border: none; cursor: pointer; color: var(--text-secondary); padding: 4px; display: inline-flex; align-items: center; justify-content: center; outline: none; transition: color 0.2s ease;">
            📊
          </button>
          <button class="header-btn" id="chat-close" title="关闭">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-body" id="chat-messages-container">
        <div class="msg assistant">
          <div class="bubble">
            我已感知当前 Ozon 页面。右侧悬浮栏会根据页面场景提供可运行动作；这里主要用于查看结果、复制内容、继续反馈和推进改进。
          </div>
          <div class="msg-meta">Ozon 智脑舱 • ${new Date().toLocaleTimeString()}</div>
        </div>
      </div>
      <div class="chat-session-control">
        <div class="chat-session-row">
          <div>
            <div class="chat-session-label">会话模式</div>
            <div class="chat-session-mode-text" id="chat-session-mode-text">新会话：不会沿用旧断点</div>
          </div>
          <div class="chat-session-actions">
            <button type="button" class="chat-session-btn" id="chat-new-session-btn">+ 新会话</button>
            <button type="button" class="chat-session-btn" id="chat-session-history-btn">历史会话</button>
          </div>
        </div>
        <div class="chat-session-history-panel hidden" id="chat-session-history-panel">
          <div id="chat-session-history-list" class="chat-session-empty">暂无可恢复会话。</div>
        </div>
      </div>
      <div class="chat-footer">
        <input type="text" class="chat-input" id="chat-input-el" placeholder="在此输入指令...">
        <button class="send-btn" id="chat-send-btn">发送</button>
      </div>
    `;
    shadow.appendChild(chatOverlay);

    const describePageContext = () => {
      if (isSellerPage) {
        return {
          title: "已识别为 Ozon 店铺页",
          subtitle: "适合发起店铺体检、商品结构诊断、竞品店铺对标和全店监控。",
          badge: "店铺场景",
        };
      }
      if (isProductPage) {
        return {
          title: "已识别为 Ozon 商品详情页",
          subtitle: "适合发起商品漏斗诊断、Listing 改版、评论缺陷分析和商品追踪实验。",
          badge: "商品场景",
        };
      }
      if (isSearchOrCatalogPage) {
        return {
          title: "已识别为 Ozon 搜索/类目页",
          subtitle: "适合发起竞品跟踪、机会扫描、价格带观察和类目扩品判断。",
          badge: "竞品/类目",
        };
      }
      return {
        title: "已进入 Ozon 运营感知模式",
        subtitle: "当前页面信息有限，建议先打开店铺、商品或搜索结果页再执行增长动作。",
        badge: "页面感知",
      };
    };

    const contextSummary = describePageContext();
    dock.title = `${contextSummary.title}：${contextSummary.subtitle}`;

    let activeGrowthRun = null;
    let overlaySessionMode = "new";
    let overlaySelectedResumeSessionKey = "";
    let overlaySelectedResumeSessionMeta = null;
    let overlayPendingGrowthAction = null;
    let overlayNewSessionConfirmed = false;
    const WORKFLOW_CHECKPOINTS_KEY = "agentWorkflowCheckpoints";

    const escapeHtmlText = (value = "") => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const createOverlayWorkflowSessionId = () => `workflow_session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const getOverlaySessionTitle = (checkpoint = {}) => {
      const skillName = String(checkpoint.skillPath || checkpoint.skillId || "").split("/").pop()?.replace(".skill.md", "") || "Ozon workflow";
      const stage = checkpoint.lastStage || checkpoint.lastNode || checkpoint.status || "checkpoint";
      return `${skillName} · ${stage}`;
    };

    const updateOverlaySessionModeUI = () => {
      const modeText = shadow.getElementById("chat-session-mode-text");
      if (!modeText) return;
      if (overlaySessionMode === "resume" && overlaySelectedResumeSessionKey) {
        modeText.innerText = `恢复历史会话：${getOverlaySessionTitle(overlaySelectedResumeSessionMeta || {})}`;
        modeText.classList.add("resume");
      } else {
        modeText.innerText = "新会话：不会沿用旧断点";
        modeText.classList.remove("resume");
      }
    };

    const startOverlayNewSessionMode = () => {
      overlaySessionMode = "new";
      overlaySelectedResumeSessionKey = "";
      overlaySelectedResumeSessionMeta = null;
      overlayNewSessionConfirmed = true;
      updateOverlaySessionModeUI();
    };

    const getOverlayCheckpointEntries = async () => {
      const data = await new Promise((resolve) => chrome.storage.local.get([WORKFLOW_CHECKPOINTS_KEY], resolve));
      return Object.entries(data[WORKFLOW_CHECKPOINTS_KEY] || {})
        .map(([key, checkpoint]) => ({ key, checkpoint: checkpoint || {} }))
        .filter(({ checkpoint }) => !["completed", "cancelled"].includes(String(checkpoint.status || "")))
        .sort((a, b) => new Date(b.checkpoint.updatedAt || 0) - new Date(a.checkpoint.updatedAt || 0));
    };

    const getOverlayCheckpointEntriesForAction = async (growthActionId = "") => {
      const entries = await getOverlayCheckpointEntries();
      if (!growthActionId) return entries;
      const matched = entries.filter(({ checkpoint }) => String(checkpoint.growthActionId || "") === String(growthActionId));
      return matched.length ? matched : entries;
    };

    const runOverlayGrowthActionNow = async ({ actionId, instruction, resume = false } = {}) => {
      if (!actionId || activeGrowthRun) return;
      const action = GROWTH_ACTIONS[actionId] || GROWTH_ACTIONS.diagnose_store_growth;
      const runInstruction = resume ? "继续" : instruction;
      addMessage("user", resume ? `恢复「${action.label}」` : `运行「${action.label}」`);
      const run = await persistGrowthActionRun(actionId, runInstruction || instruction || action.instruction);
      await setActiveGrowthRun(run);
      overlayPendingGrowthAction = null;
      overlayNewSessionConfirmed = false;
      if (!resume && actionId === "scan_competitor_changes") {
        try {
          await processCompetitorBaseline();
        } catch (err) {
          showToast(`竞品基线预处理失败，AI 诊断继续运行：${err.message}`);
        }
      }
      runSelectedSkill(runInstruction || instruction, actionId);
    };

    const renderOverlaySessionHistory = async (entriesOverride = null) => {
      const list = shadow.getElementById("chat-session-history-list");
      if (!list) return;
      const entries = Array.isArray(entriesOverride) ? entriesOverride : await getOverlayCheckpointEntries();
      if (!entries.length) {
        list.className = "chat-session-empty";
        list.innerHTML = "暂无可恢复会话。";
        return;
      }
      list.className = "";
      list.innerHTML = entries.slice(0, 12).map(({ key, checkpoint }) => {
        const updatedAt = checkpoint.updatedAt ? new Date(checkpoint.updatedAt).toLocaleString() : "未知时间";
        const status = checkpoint.status || "checkpoint";
        const step = checkpoint.step !== undefined ? ` · step ${checkpoint.step}` : "";
        return `
          <div class="chat-session-history-item" data-session-key="${escapeHtmlText(key)}">
            <div class="chat-session-history-title">${escapeHtmlText(getOverlaySessionTitle(checkpoint))}</div>
            <div class="chat-session-history-meta">${escapeHtmlText(status)}${escapeHtmlText(step)} · ${escapeHtmlText(updatedAt)}</div>
            <button type="button" class="chat-session-resume-btn" data-session-key="${escapeHtmlText(key)}">恢复这个会话</button>
          </div>
        `;
      }).join("");
      list.querySelectorAll(".chat-session-resume-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.dataset.sessionKey || "";
          const match = entries.find((entry) => entry.key === key);
          if (!match) return;
          overlaySessionMode = "resume";
          overlaySelectedResumeSessionKey = key;
          overlaySelectedResumeSessionMeta = match.checkpoint;
          updateOverlaySessionModeUI();
          shadow.getElementById("chat-session-history-panel")?.classList.add("hidden");
          showToast(`已选择历史会话：${getOverlaySessionTitle(match.checkpoint)}`);
          if (overlayPendingGrowthAction) {
            runOverlayGrowthActionNow({
              actionId: overlayPendingGrowthAction.actionId,
              instruction: overlayPendingGrowthAction.instruction,
              resume: true,
            }).catch((err) => showToast(`恢复会话失败：${err.message}`));
          }
        });
      });
    };

    const getOverlayActiveResumeSessionKey = () => (
      overlaySessionMode === "resume" && overlaySelectedResumeSessionKey ? overlaySelectedResumeSessionKey : ""
    );

    const pickLatestOverlayResumableSessionForContinue = async ({ growthActionId = "" } = {}) => {
      const entries = await getOverlayCheckpointEntries();
      const matched = entries.find(({ checkpoint }) => {
        const checkpointAction = String(checkpoint.growthActionId || "");
        if (growthActionId && checkpointAction === growthActionId) return true;
        return false;
      }) || entries[0];
      if (!matched) return "";
      overlaySessionMode = "resume";
      overlaySelectedResumeSessionKey = matched.key;
      overlaySelectedResumeSessionMeta = matched.checkpoint;
      updateOverlaySessionModeUI();
      return matched.key;
    };

    const setDockBusy = (busy, actionId = "") => {
      dockActionButtons.forEach((btn) => {
        const isActive = btn.dataset.action === actionId;
        btn.disabled = busy;
        btn.classList.toggle("busy", busy && !isActive);
        btn.classList.toggle("activate-btn", busy && isActive);
        if (busy && isActive) {
          btn.title = `正在运行：${GROWTH_ACTIONS[actionId]?.label || "Ozon 任务"}`;
        } else {
          btn.title = GROWTH_ACTIONS[btn.dataset.action]?.label || btn.title;
        }
      });
    };

    const setActiveGrowthRun = async (run) => {
      activeGrowthRun = run;
      setDockBusy(Boolean(run), run?.actionId || "");
      await new Promise((r) => chrome.storage.local.set({ activeOzonGrowthRun: run || null }, r));
    };

    const persistGrowthActionRun = async (actionId, instruction) => {
      const action = GROWTH_ACTIONS[actionId] || GROWTH_ACTIONS.diagnose_store_growth;
      const storage = await new Promise((r) => chrome.storage.local.get(["growthActionRuns", "activeShopId"], r));
      const runs = storage.growthActionRuns || [];
      const run = {
        id: `page_action_${Date.now()}`,
        shopId: storage.activeShopId || "",
        actionId,
        title: action.label,
        sku: isProductPage ? document.title.slice(0, 80) : (isSellerPage ? "店铺级" : "类目/竞品页"),
        instruction,
        status: "running_from_floating_dock",
        pageUrl: window.location.href,
        createdAt: new Date().toISOString(),
      };
      runs.unshift(run);
      await new Promise((r) => chrome.storage.local.set({ growthActionRuns: runs.slice(0, 80) }, r));
      return run;
    };

    const ensureMonitorTask = async (targetType = "item", shopNature = "competitor") => {
      const storage = await new Promise((r) => chrome.storage.local.get(["monitorTasks", "activeShopId"], r));
      const tasks = storage.monitorTasks || [];
      const exists = tasks.some((task) => task.platform === "ozon" && task.target_url === window.location.href);
      if (exists) return false;
      tasks.unshift({
        id: `task_${Date.now()}`,
        shopId: storage.activeShopId || "",
        task_type: "shop_check",
        platform: "ozon",
        target_type: targetType,
        shop_nature: shopNature,
        target_url: window.location.href,
        target_entity_key: `ozon:${targetType}:${generateHash(window.location.href).slice(0, 8)}`,
        frequency: "6h",
        last_run_at: new Date().toLocaleString(),
        status: "active",
        created_from: "floating_dock",
      });
      await new Promise((r) => chrome.storage.local.set({ monitorTasks: tasks.slice(0, 200) }, r));
      return true;
    };

    const processCompetitorBaseline = async () => {
      const pageData = readCurrentPage();
      const items = isProductPage
        ? [{
          id: pageData.url,
          title: pageData.h1 || pageData.title || "Ozon Product",
          price: pageData.price || 0,
          sales: 0,
          rating: pageData.rating || 0,
          reviewCount: pageData.reviewCount || 0,
          imageUrl: pageData.targetImageUrl || pageData.mainImage?.src || "",
          url: pageData.url,
        }]
        : (pageData.productCards || []).map((card) => ({
          id: card.href || card.url || card.title,
          title: card.title || card.name || "Ozon Product",
          price: card.price || 0,
          sales: card.sales || 0,
          rating: card.rating || 0,
          reviewCount: card.reviews || card.reviewCount || 0,
          imageUrl: card.imageSrc || card.imageUrl || card.candidate_image_url || "",
          url: card.href || card.url || "",
        }));
      const shopInfo = isSellerPage || !isProductPage
        ? {
          id: pageData.url,
          name: pageData.h1 || pageData.title || "Ozon Competitor Surface",
          url: pageData.url,
          productCount: items.length,
        }
        : null;
      const response = await chrome.runtime.sendMessage({
        type: "PROCESS_OZON_MONITOR_BASELINE",
        args: {
          items,
          shopInfo,
          shopId: "",
        }
      });
      await ensureMonitorTask(isProductPage ? "item" : "shop", "competitor");
      showToast(response?.ok
        ? `📡 已建立竞品基线：${response.data?.processedCount || items.length} 个对象，生成 ${response.data?.eventsGeneratedCount || 0} 条变化事件`
        : `⚠️ 竞品基线保存失败：${response?.error || "未知错误"}`);
    };

    const openGrowthAction = async (actionId) => {
      if (activeGrowthRun) {
        showToast(`当前「${activeGrowthRun.title || "Ozon 任务"}」仍在运行，请等待完成后再发起新任务。`);
        chatOverlay.classList.remove("hidden");
        return;
      }
      const action = GROWTH_ACTIONS[actionId] || GROWTH_ACTIONS.diagnose_store_growth;
      const contextPrefix = `【页面感知】${contextSummary.title}；当前URL：${window.location.href}；页面标题：${document.title}`;
      const instruction = `${contextPrefix}\n\n${action.instruction}`;
      chatOverlay.classList.remove("hidden");
      settingsDrawer.classList.add("hidden");

      const selectedResumeSessionKey = getOverlayActiveResumeSessionKey();
      const resumableEntries = selectedResumeSessionKey ? [] : await getOverlayCheckpointEntriesForAction(actionId);
      if (!selectedResumeSessionKey && !overlayNewSessionConfirmed && resumableEntries.length > 0) {
        overlayPendingGrowthAction = { actionId, instruction };
        await renderOverlaySessionHistory(resumableEntries);
        shadow.getElementById("chat-session-history-panel")?.classList.remove("hidden");
        addMessage("assistant", `已找到「${action.label}」相关历史会话。请选择“恢复这个会话”，或点击“+ 新会话”后重新开始。`);
        showToast("已暂停自动运行，请先选择历史会话或新会话。");
        return;
      }

      await runOverlayGrowthActionNow({
        actionId,
        instruction,
        resume: Boolean(selectedResumeSessionKey),
      });
    };

    // Draggable Functionality
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let chatLeft = 0;
    let chatTop = 0;

    const dragHandle = shadow.getElementById("chat-drag-handle");
    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = chatOverlay.getBoundingClientRect();
      chatLeft = rect.left;
      chatTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      chatOverlay.style.bottom = "auto";
      chatOverlay.style.right = "auto";
      chatOverlay.style.left = `${chatLeft + deltaX}px`;
      chatOverlay.style.top = `${chatTop + deltaY}px`;
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    const isSourcingSkillId = (skillId = "") => {
      return String(skillId).includes("ozon_sourcing_finder") || String(skillId).includes("sourcing_finder");
    };

    const isRealPurchaseLink = (url = "") => {
      return /^https?:\/\/[^#\s]+/i.test(String(url || "")) && !String(url).includes("s.1688.com/search");
    };

    const itemLooksLikeSourcing = (item = {}) => {
      const ledger = item.financial_ledger || {};
      const link = item.product_link || item.link || "";
      return Boolean(
        isRealPurchaseLink(link) ||
        ledger.sourcing_cost ||
        ledger.sourcing_cost_cny ||
        ledger.sourcing_cost_rub ||
        item.supplier_name ||
        item.spec_audit
      );
    };

    const shouldRenderSourcingData = (skillId, data) => {
      return isSourcingSkillId(skillId) && Array.isArray(data) && data.some(itemLooksLikeSourcing);
    };

    const unwrapFinalOutput = (value) => {
      let current = value;
      for (let i = 0; i < 4; i += 1) {
        if (typeof current === "string") {
          const trimmed = current.trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) break;
          try {
            current = JSON.parse(trimmed);
            continue;
          } catch (_) {
            break;
          }
        }
        if (current && typeof current === "object" && current.type === "final" && current.output && typeof current.output === "object") {
          current = current.output;
          continue;
        }
        if (current && typeof current === "object" && current.result && typeof current.result === "object") {
          current = current.result;
          continue;
        }
        break;
      }
      return current;
    };

    const valueToBusinessText = (value) => {
      if (value === undefined || value === null || value === "") return "";
      if (Array.isArray(value)) {
        return value.map((item) => valueToBusinessText(item)).filter(Boolean).join("；");
      }
      if (typeof value === "object") {
        return Object.entries(value)
          .map(([key, val]) => `${key}: ${valueToBusinessText(val)}`)
          .filter(Boolean)
          .join("；");
      }
      return String(value);
    };

    const renderStructuredDataMarkdown = (data = [], skillId = "") => {
      if (!Array.isArray(data) || data.length === 0) return "";
      if (shouldRenderSourcingData(skillId, data)) return "";
      const rows = data
        .filter((item) => item && typeof item === "object")
        .slice(0, 12)
        .map((item, idx) => {
          const title = item.plan_id || item.scheme_id || item.title || item.name || item.direction || item.keyword || `诊断项 ${idx + 1}`;
          const fields = [
            ["诊断级别", item.diagnosis_level || item.priority || item.severity],
            ["方向", item.direction || item.strategy || item.recommendation || item.description],
            ["证据", item.evidence || item.diagnosis_basis || item.selection_rationale || item.trend_evidence],
            ["预期影响", item.expected_impact || item.expected_result || item.kpi_target],
            ["首批动作", item.first_actions || item.next_steps || item.actionable_tasks || item.actions],
            ["风险护栏", item.risk_guard || item.risk_notes || item.guardrail],
          ];
          const body = fields
            .map(([label, value]) => {
              const text = valueToBusinessText(value);
              return text ? `- ${label}: ${text}` : "";
            })
            .filter(Boolean)
            .join("\n");
          return `#### ${idx + 1}. ${title}\n${body}`;
        })
        .filter(Boolean)
        .join("\n\n");
      return rows ? `\n\n### 结构化行动项\n\n${rows}` : "";
    };

    const renderFinalOutputMarkdown = (rawResult, skillId = "") => {
      const res = unwrapFinalOutput(rawResult);
      if (typeof res === "string") return res;
      if (!res || typeof res !== "object") return "";

      const parts = [];
      if (res.overview) parts.push(`### 分析概述\n\n${res.overview}`);
      if (res.analysis) parts.push(`### 深度商业诊断\n\n${res.analysis}`);
      if (res.summary) parts.push(`### 核心运营建议\n\n${res.summary}`);

      if (shouldRenderSourcingData(skillId, res.data)) {
        let sourcingMd = `### 推荐对齐货源与套利清单\n`;
        res.data.filter(itemLooksLikeSourcing).forEach((item, idx) => {
          const spec = item.spec_audit || {};
          const ledger = item.financial_ledger || {};
          const purchaseLink = item.product_link || item.link || "";
          const title = item.product_title || item.title || item.name || item.supplier_name || "对标品";
          sourcingMd += `\n#### 货源 ${idx + 1}: ${title}\n`;
          if (item.candidate_image_url) sourcingMd += `![商品图片](${item.candidate_image_url})\n`;
          sourcingMd += isRealPurchaseLink(purchaseLink)
            ? `- 采购直达: [1688 采购直达链接](${purchaseLink})\n`
            : `- 采购直达: 未获得真实采购详情页，本轮不生成链接\n`;
          sourcingMd += `- 采购价: ${ledger.sourcing_cost || ledger.sourcing_cost_cny || item.price_rmb || "待核实"}\n`;
          sourcingMd += `- 跨境物流: ${ledger.shipping_cost_rub || ledger.shipping_cost || "待核实"}\n`;
          sourcingMd += `- Ozon 售价: ${ledger.target_price || "待核实"}\n`;
          sourcingMd += `- 预估净利润率: **${ledger.margin_rate || ledger.margin || "待核实"}**\n`;
          sourcingMd += `- 规格对齐状态: \`${spec.status || "待核实"}\`\n`;
          const visualEvidence = item.visual_match_evidence || item.trend_evidence || item.selection_rationale || item.audit_comment;
          if (visualEvidence) sourcingMd += `- 对标说明: ${visualEvidence}\n`;
        });
        parts.push(sourcingMd);
      } else {
        parts.push(renderStructuredDataMarkdown(res.data, skillId));
      }

      if (!parts.filter(Boolean).length) {
        return `### 结构化结果\n\n${valueToBusinessText(res) || "执行成功，但报告结构为空。"}`;
      }
      return parts.filter(Boolean).join("\n\n");
    };

    // Helper functions for Chat messages
    const copyTextToClipboard = async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      }
    };

    const addMessage = (sender, content, isMarkdown = false, extraData = null, skillId = "") => {
      const container = shadow.getElementById("chat-messages-container");
      const msgDiv = document.createElement("div");
      msgDiv.className = `msg ${sender}`;

      const bubbleDiv = document.createElement("div");
      bubbleDiv.className = "bubble";

      if (isMarkdown && sender === "assistant") {
        bubbleDiv.className = "bubble md-report";
        bubbleDiv.innerHTML = parseMarkdownToHTML(content);
        
        // Add interactive sourcing cards only for the dedicated sourcing workflow.
        if (shouldRenderSourcingData(skillId, extraData)) {
          const cardsWrapper = document.createElement("div");
          cardsWrapper.className = "sourcing-cards-wrapper";
          cardsWrapper.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 10px; width: 100%;";
          
          extraData.filter(itemLooksLikeSourcing).forEach((item, idx) => {
            const ledger = item.financial_ledger || {};
            const purchaseLink = item.product_link || item.link || "";
            const card = document.createElement("div");
            card.className = "sourcing-card";
            card.style.cssText = "display: flex; gap: 10px; padding: 8px; border: 1px solid var(--border-main); border-radius: 8px; background: var(--input-bg); align-items: center; position: relative;";
            
            const imgUrl = item.candidate_image_url || "icons/icon128.png";
            const linkHtml = isRealPurchaseLink(purchaseLink)
              ? `<a href="${purchaseLink}" target="_blank" style="font-size: 9px; color: #005bff; text-decoration: none; font-weight: 600;">采购直达</a>`
              : `<span style="font-size: 9px; color: var(--text-secondary);">未获得真实采购详情页</span>`;
            card.innerHTML = `
              <img src="${imgUrl}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
              <div style="flex: 1; min-width: 0; text-align: left;">
                <div style="font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-color);">${item.title || '对标货源 #' + (idx + 1)}</div>
                <div style="font-size: 10px; margin-top: 3px; color: var(--text-secondary);">
                  单价: ¥${ledger.sourcing_cost || ledger.sourcing_cost_cny || '0'} | 利润率: <span style="font-weight: bold; color: ${parseFloat(ledger.margin_rate || ledger.margin) >= 20 ? '#10b981' : '#ef4444'};">${ledger.margin_rate || ledger.margin || '0'}%</span>
                </div>
                <div style="margin-top: 3px;">
                  ${linkHtml}
                </div>
              </div>
            `;
            
            const saveBtn = document.createElement("button");
            saveBtn.innerText = "💾 保存";
            saveBtn.style.cssText = "background: #005bff; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; transition: all 0.2s; outline: none; flex-shrink: 0;";
            
            saveBtn.addEventListener("click", async () => {
              saveBtn.disabled = true;
              saveBtn.innerText = "⏳ 写入中";
              try {
                const existing = await new Promise(r => chrome.storage.local.get(["savedResults"], r));
                const savedResults = existing.savedResults || [];
                
                const singleEntry = {
                  id: Date.now(),
                  createdAt: new Date().toISOString(),
                  skillId: "sourcing_finder",
                  skillName: "手动保存货源",
                  pageUrl: window.location.href,
                  pageTitle: document.title,
                  result: {
                    overview: "自对话框手动保存的对标货源",
                    data: [item]
                  }
                };
                
                savedResults.unshift(singleEntry);
                await new Promise(r => chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, r));
                
                saveBtn.style.background = "#10b981";
                saveBtn.innerText = "已保存 ✓";
              } catch (err) {
                console.error("Save failed:", err);
                saveBtn.disabled = false;
                saveBtn.innerText = "❌ 失败";
                saveBtn.style.background = "#ef4444";
              }
            });
            
            card.appendChild(saveBtn);
            cardsWrapper.appendChild(card);
          });
          
          bubbleDiv.appendChild(cardsWrapper);
        }
      } else {
        bubbleDiv.innerText = content;
      }

      const metaDiv = document.createElement("div");
      metaDiv.className = "msg-meta";
      const metaText = document.createElement("span");
      metaText.innerText = `${sender === "user" ? "您" : "系统"} • ${new Date().toLocaleTimeString()}`;
      metaDiv.appendChild(metaText);
      if (sender === "assistant" && String(content || "").trim()) {
        const toolsDiv = document.createElement("div");
        toolsDiv.className = "msg-tools";
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copy-msg-btn";
        copyBtn.innerText = "复制";
        copyBtn.addEventListener("click", async () => {
          const ok = await copyTextToClipboard(String(content || ""));
          copyBtn.innerText = ok ? "已复制" : "复制失败";
          setTimeout(() => { copyBtn.innerText = "复制"; }, 1400);
        });
        toolsDiv.appendChild(copyBtn);
        metaDiv.appendChild(toolsDiv);
      }

      msgDiv.appendChild(bubbleDiv);
      msgDiv.appendChild(metaDiv);
      container.appendChild(msgDiv);
      container.scrollTop = container.scrollHeight;
      return msgDiv;
    };

    // Helper function to parse markdown to simple HTML
    function parseMarkdownToHTML(text) {
      if (typeof text !== "string") return text;
      
      // Escape HTML
      let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // Parse Markdown Tables
      const lines = html.split("\n");
      let inTable = false;
      let tableHtml = "";
      const parsedLines = [];
      
      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
          const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
          const isSeparator = cells.every(c => /^-+$/.test(c) || c === "");
          if (isSeparator) {
            continue;
          }
          if (!inTable) {
            inTable = true;
            tableHtml = '<div style="overflow-x:auto; margin:10px 0; border:1px solid var(--border-main); border-radius:8px;"><table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left; background:var(--input-bg); color:var(--text-color);">';
            tableHtml += '<thead><tr style="border-bottom:1px solid var(--border-main);">';
            cells.forEach(c => {
              tableHtml += `<th style="padding:8px; font-weight:600; background:var(--header-bg); border-right:1px solid var(--border-main);">${c}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';
          } else {
            tableHtml += '<tr style="border-bottom:1px solid var(--border-main);">';
            cells.forEach(c => {
              tableHtml += `<td style="padding:8px; border-right:1px solid var(--border-main);">${c}</td>`;
            });
            tableHtml += '</tr>';
          }
        } else {
          if (inTable) {
            inTable = false;
            tableHtml += '</tbody></table></div>';
            parsedLines.push(tableHtml);
            tableHtml = "";
          }
          parsedLines.push(line);
        }
      }
      if (inTable) {
        tableHtml += '</tbody></table></div>';
        parsedLines.push(tableHtml);
      }
      html = parsedLines.join("\n");

      // Parse Block Code (like triple backticks JSON/XML)
      html = html.replace(/```(json)?\s*([\s\S]*?)```/g, (_match, lang, code) => {
        const rawCode = code.trim();
        let formattedCode = rawCode;
        let summary = lang ? "查看结构化 JSON" : "查看原始代码";
        if (lang) {
          try {
            const parsed = JSON.parse(rawCode.replace(/&quot;/g, '"'));
            formattedCode = JSON.stringify(parsed, null, 2)
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            summary = "查看原始结构化数据";
          } catch (_) {}
        }
        return `<details class="json-fold" style="margin:8px 0; border:1px solid var(--border-main); border-radius:8px; background:var(--input-bg);"><summary style="cursor:pointer; padding:8px 10px; font-size:11px; font-weight:600; color:var(--text-color);">${summary}</summary><pre style="padding:10px; margin:0; border-top:1px solid var(--border-main); overflow-x:auto; font-family:monospace; font-size:11px; color:var(--text-color); white-space:pre-wrap; word-break:break-word;">${formattedCode}</pre></details>`;
      });

      // Parse Images
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="display:block; max-width:120px; max-height:120px; object-fit:cover; border-radius:6px; margin: 8px 0; border: 1px solid var(--border-main);">');

      // Parse Links
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#005bff; font-weight:600; text-decoration:none;">$1 ➔</a>');

      // Parse Inline Code
      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

      // Parse Bold/Italic
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

      // Parse Headings
      html = html.replace(/^\s*# (.*)$/gm, "<h1>$1</h1>");
      html = html.replace(/^\s*## (.*)$/gm, "<h2>$1</h2>");
      html = html.replace(/^\s*### (.*)$/gm, "<h3>$1</h3>");

      // Parse Lists
      html = html.replace(/^\s*-\s+(.*)$/gm, "<li>$1</li>");
      html = html.replace(/^\s*\*\s+(.*)$/gm, "<li>$1</li>");

      // Parse Newlines
      html = html.replace(/\n/g, "<br>");
      
      // Wrap isolated lists
      html = html.replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");
      return html;
    }

    // Trigger AI Skill Running Loop via Background Connection
    const runSelectedSkill = async (instruction, growthActionId = "") => {
      if (activeGrowthRun && (!growthActionId || activeGrowthRun.actionId !== growthActionId)) {
        showToast(`当前「${activeGrowthRun.title || "Ozon 任务"}」仍在运行，请等待完成后再发起新任务。`);
        return;
      }
      const skillPath = "";
      const statusDot = shadow.getElementById("chat-status-dot");
      const sendBtn = shadow.getElementById("chat-send-btn");
      const inputEl = shadow.getElementById("chat-input-el");

      statusDot.className = "status-dot active";
      sendBtn.disabled = true;
      inputEl.disabled = true;

      const legacyContinueInstruction = /^(继续|继续推进|恢复|resume|continue)$/i.test(String(instruction || "").trim());
      let resumeSessionKey = getOverlayActiveResumeSessionKey();
      if (!resumeSessionKey && legacyContinueInstruction) {
        resumeSessionKey = await pickLatestOverlayResumableSessionForContinue({ growthActionId });
      }
      const shouldContinueSession = Boolean(resumeSessionKey || legacyContinueInstruction);
      const workflowSessionId = resumeSessionKey || createOverlayWorkflowSessionId();

      // Add a System Harness Log terminal bubble
      const logMsgDiv = document.createElement("div");
      logMsgDiv.className = "msg assistant";
      const termLogDiv = document.createElement("div");
      termLogDiv.className = "terminal-log";
      termLogDiv.innerHTML = `<div class="log-line">[${new Date().toLocaleTimeString()}] ⚙️ 正在建立 Ozon AI Harness 连接通道...</div>`;
      logMsgDiv.appendChild(termLogDiv);
      shadow.getElementById("chat-messages-container").appendChild(logMsgDiv);

      const log = (message) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
        termLogDiv.appendChild(line);
        termLogDiv.scrollTop = termLogDiv.scrollHeight;
      };

      const finishGrowthRun = async (status, error = "") => {
        const runId = activeGrowthRun?.id || "";
        const stored = await new Promise((r) => chrome.storage.local.get(["growthActionRuns"], r));
        const runs = stored.growthActionRuns || [];
        const match = runs.find((run) => run.id === runId);
        if (match) {
          match.status = status;
          match.finishedAt = new Date().toISOString();
          if (error) match.error = error;
          await new Promise((r) => chrome.storage.local.set({ growthActionRuns: runs }, r));
        }
        await setActiveGrowthRun(null);
      };

      try {
        const port = chrome.runtime.connect({ name: "ozon-agent-loop" });
        
        port.onMessage.addListener((message) => {
          if (message.type === "PROGRESS") {
            const data = message.data || {};
            if (data.type === "thinking" && data.message) {
              let msg = data.message;
              if (msg.includes("[阶段")) {
                log(`🤖 ${msg}`);
              } else {
                log(`🕵️ ${msg}`);
              }
            } else if (data.type === "tool_call") {
              log(`⚙️ ${data.message || `准备调用动作: ${data.actionLabel || data.toolName}`}`);
            } else if (data.type === "tool_stage") {
              log(`↪ ${data.message || `${data.actionLabel || data.toolName || "工具"} 正在执行`}`);
            } else if (data.type === "tool_result") {
              log(`📥 执行完毕，获取到相关数据。`);
            } else if (data.type === "reflection" && data.message) {
              log(`⚠️ Critic 审计反思: ${data.message}`);
            }
          } else if (message.type === "SUCCESS") {
            statusDot.className = "status-dot";
            sendBtn.disabled = false;
            inputEl.disabled = false;
            log("✅ Ozon AI 运营闭环工作流执行成功！");
            
            const result = message.result || {};
            const skillId = result.skillId || "";
            const normalizedResult = unwrapFinalOutput(result);
            const finalOutput = renderFinalOutputMarkdown(normalizedResult, skillId);
            const extraData = shouldRenderSourcingData(skillId, normalizedResult?.data) ? normalizedResult.data : null;
            addMessage("assistant", finalOutput || "执行成功，但报告结构为空。", true, extraData, skillId);
            finishGrowthRun("completed").catch((err) => console.warn("Failed to finish growth run:", err.message));
          } else if (message.type === "ERROR") {
            statusDot.className = "status-dot";
            sendBtn.disabled = false;
            inputEl.disabled = false;
            log(`❌ 执行失败: ${message.error}`);
            finishGrowthRun("failed", message.error || "unknown error").catch((err) => console.warn("Failed to finish growth run:", err.message));
          }
        });

        // Trigger Run
        port.postMessage({
          type: "RUN_SKILL",
          skillPath: skillPath,
          workflowSessionId,
          growthActionId,
          userInstruction: instruction,
          continueSession: Boolean(shouldContinueSession),
          forceNewSession: !shouldContinueSession
        });

      } catch (err) {
        statusDot.className = "status-dot";
        sendBtn.disabled = false;
        inputEl.disabled = false;
        log(`❌ 无法发起后台连接: ${err.message}`);
        await finishGrowthRun("failed", err.message);
      }
    };

    // Button Click Handlers
    dockActionButtons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const actionId = btn.dataset.action;
        if (actionId === "diagnose_sku_funnel" && isProductPage) {
          trackCurrentProduct({ silent: true });
        }
        await openGrowthAction(actionId);
      });
    });

    shadow.getElementById("chat-close").addEventListener("click", () => {
      chatOverlay.classList.add("hidden");
    });

    shadow.getElementById("chat-dashboard-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    });

    // Update active shop tooltip and status badges on floating Pill Dock
    const updateActiveShopTooltip = () => {
      chrome.storage.local.get(["ozonShops", "activeShopId"], (data) => {
        const shops = data.ozonShops || [];
        const currentUrl = window.location.href;
        
        const matchedShop = shops.find(s => {
          if (!s.sellerUrl) return false;
          try {
            const u1 = new URL(s.sellerUrl);
            const u2 = new URL(currentUrl);
            const m1 = u1.pathname.match(/\/seller\/([^\/]+)/);
            const m2 = u2.pathname.match(/\/seller\/([^\/]+)/);
            return m1 && m2 && m1[1] === m2[1];
          } catch (_) {
            return false;
          }
        });

        if (bindShopBtn) {
          if (matchedShop) {
            bindShopBtn.title = `🏢 已绑定店铺: ${matchedShop.name}`;
            bindShopBtn.style.background = "#10b981"; // success green
            bindShopBtn.innerHTML = `
              <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            `;
          } else {
            bindShopBtn.title = "🔗 绑定此店铺到 AI 大盘";
            bindShopBtn.style.background = "var(--btn-bg)";
            bindShopBtn.innerHTML = `
              <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            `;
          }
        }
      });
    };
    updateActiveShopTooltip();

    // Bind Quick Shop Binding Button to open Settings drawer and auto-populate shop name
    if (bindShopBtn) {
      bindShopBtn.addEventListener("click", () => {
        settingsDrawer.classList.remove("hidden");
        chatOverlay.classList.add("hidden");
        
        const addShopFormContainer = shadow.getElementById("ozon-drawer-add-shop-form");
        const toggleAddBtn = shadow.getElementById("ozon-drawer-toggle-add-btn");
        if (addShopFormContainer && toggleAddBtn) {
          addShopFormContainer.classList.remove("hidden");
          toggleAddBtn.innerText = "❌ 取消绑定录入";
        }

        let scrapedSellerName = "";
        const h1 = document.querySelector("h1");
        if (h1) {
          scrapedSellerName = h1.textContent.trim();
        } else {
          scrapedSellerName = document.title.split("-")[0].trim();
        }
        if (scrapedSellerName.length > 20) {
          scrapedSellerName = scrapedSellerName.slice(0, 20);
        }

        const nameInput = shadow.getElementById("ozon-new-name");
        if (nameInput) {
          nameInput.value = scrapedSellerName || "自营店铺";
          nameInput.focus();
        }
      });
    }

    // Toggle Add Shop Form inside settings drawer
    const addShopFormContainer = shadow.getElementById("ozon-drawer-add-shop-form");
    const toggleAddBtn = shadow.getElementById("ozon-drawer-toggle-add-btn");
    if (toggleAddBtn && addShopFormContainer) {
      toggleAddBtn.addEventListener("click", () => {
        addShopFormContainer.classList.toggle("hidden");
        toggleAddBtn.innerText = addShopFormContainer.classList.contains("hidden") ? "➕ 绑定新 Ozon 店铺" : "❌ 取消绑定录入";
      });
    }

    // Save shop from settings drawer form
    const saveShopBtn = shadow.getElementById("ozon-drawer-save-shop-btn");
    if (saveShopBtn) {
      saveShopBtn.addEventListener("click", async () => {
        const newNameInput = shadow.getElementById("ozon-new-name");
        const newClientIdInput = shadow.getElementById("ozon-new-client-id");
        const newApiKeyInput = shadow.getElementById("ozon-new-api-key");
        const newWhSelect = shadow.getElementById("ozon-new-wh-type");

        const name = newNameInput.value.trim();
        const clientId = newClientIdInput.value.trim();
        const apiKey = newApiKeyInput.value.trim();
        const warehouseType = newWhSelect.value;

        if (!name || !clientId || !apiKey) {
          alert("请填写完整的店铺信息！");
          return;
        }

        const storage = await new Promise(r => chrome.storage.local.get(["ozonShops"], r));
        const shops = storage.ozonShops || [];

        if (shops.some(s => s.clientId === clientId)) {
          alert("此 Client ID 已绑定过，请勿重复添加！");
          return;
        }

        const newShop = {
          id: `shop_${Date.now()}`,
          name,
          clientId,
          apiKey,
          warehouseType,
          isDefault: shops.length === 0,
          sellerUrl: window.location.href.includes("/seller/") ? window.location.href : ""
        };

        shops.push(newShop);
        await new Promise(r => chrome.storage.local.set({
          ozonShops: shops,
          activeShopId: newShop.id
        }, r));

        newNameInput.value = "";
        newClientIdInput.value = "";
        newApiKeyInput.value = "";
        addShopFormContainer.classList.add("hidden");
        toggleAddBtn.innerText = "➕ 绑定新 Ozon 店铺";

        alert(`店铺 [${name}] 绑定并启用成功！`);
        
        // Re-read storage and refresh dropdown/lists
        chrome.storage.local.get(["ozonShops", "activeShopId"], (updatedData) => {
          const shopSelect = shadow.getElementById("ozon-active-shop-select");
          shopSelect.innerHTML = updatedData.ozonShops.map(s => 
            `<option value="${s.id}" ${s.id === updatedData.activeShopId ? 'selected' : ''}>🏢 ${s.name} (${s.clientId})</option>`
          ).join('');
          
          const listDiv = shadow.getElementById("ozon-drawer-shops-list");
          listDiv.innerHTML = updatedData.ozonShops.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:var(--btn-bg); border-radius:4px; font-size:11px; border:1px solid ${s.id === updatedData.activeShopId ? '#005bff' : 'transparent'};">
              <span style="color:${s.id === updatedData.activeShopId ? '#005bff' : 'var(--text-color)'}; font-weight:${s.id === updatedData.activeShopId ? 'bold' : 'normal'};">🏢 ${s.name} (${s.clientId})</span>
              <span class="ozon-drawer-delete-shop" data-id="${s.id}" style="color:#ef4444; cursor:pointer; font-weight:bold; font-size:12px; padding:0 4px;" title="删除">×</span>
            </div>
          `).join('');
          
          listDiv.querySelectorAll(".ozon-drawer-delete-shop").forEach(delBtn => {
            delBtn.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              const shopId = delBtn.getAttribute("data-id");
              if (confirm("确定要删除此店铺的 API 绑定吗？")) {
                const innerStorage = await new Promise(res => chrome.storage.local.get(["ozonShops", "activeShopId"], res));
                let innerShops = innerStorage.ozonShops || [];
                innerShops = innerShops.filter(s => s.id !== shopId);
                let nextActive = innerStorage.activeShopId;
                if (innerStorage.activeShopId === shopId) {
                  nextActive = innerShops.length > 0 ? innerShops[0].id : "";
                }
                if (innerShops.length > 0 && !innerShops.some(s => s.isDefault)) {
                  innerShops[0].isDefault = true;
                }
                await new Promise(res => chrome.storage.local.set({ ozonShops: innerShops, activeShopId: nextActive }, res));
                alert("店铺删除成功！");
                settingsDrawer.classList.add("hidden");
              }
            });
          });
          updateActiveShopTooltip();
        });
      });
    }

    settingsBtn.addEventListener("click", () => {
      settingsDrawer.classList.toggle("hidden");
      chatOverlay.classList.add("hidden");
      
      // Load current settings
      chrome.storage.local.get([
        'ozonShops',
        'activeShopId',
        'ozonTargetMargin', 
        'settingsTheme', 
        'apiKey',
        'llmProvider',
        'llmModel',
        'imageGenerationModel',
        'llmBaseUrl',
        'maxLoopSteps',
        'temperature'
      ], (data) => {
        const shops = data.ozonShops || [];
        const activeId = data.activeShopId;
        const shopSelect = shadow.getElementById("ozon-active-shop-select");
        const listDiv = shadow.getElementById("ozon-drawer-shops-list");

        if (shops.length === 0) {
          shopSelect.innerHTML = `<option value="">-- 未绑定店铺 --</option>`;
        } else {
          shopSelect.innerHTML = shops.map(s => 
            `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>🏢 ${s.name} (${s.clientId})</option>`
          ).join('');
        }

        const renderDrawerShops = () => {
          const currentShops = data.ozonShops || [];
          const currentActive = data.activeShopId;
          if (currentShops.length === 0) {
            listDiv.innerHTML = `<div style="font-size:10px; color:var(--text-secondary); padding:4px 0; text-align:center;">暂无绑定店铺</div>`;
          } else {
            listDiv.innerHTML = currentShops.map(s => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:var(--btn-bg); border-radius:4px; font-size:11px; border:1px solid ${s.id === currentActive ? '#005bff' : 'transparent'};">
                <span style="color:${s.id === currentActive ? '#005bff' : 'var(--text-color)'}; font-weight:${s.id === currentActive ? 'bold' : 'normal'};">🏢 ${s.name} (${s.clientId})</span>
                <span class="ozon-drawer-delete-shop" data-id="${s.id}" style="color:#ef4444; cursor:pointer; font-weight:bold; font-size:12px; padding:0 4px;" title="删除">×</span>
              </div>
            `).join('');

            listDiv.querySelectorAll(".ozon-drawer-delete-shop").forEach(delBtn => {
              delBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const shopId = delBtn.getAttribute("data-id");
                if (confirm("确定要删除此店铺的 API 绑定吗？")) {
                  data.ozonShops = data.ozonShops.filter(s => s.id !== shopId);
                  if (data.activeShopId === shopId) {
                    data.activeShopId = data.ozonShops.length > 0 ? data.ozonShops[0].id : "";
                  }
                  if (data.ozonShops.length > 0 && !data.ozonShops.some(s => s.isDefault)) {
                    data.ozonShops[0].isDefault = true;
                  }
                  await new Promise(r => chrome.storage.local.set({
                    ozonShops: data.ozonShops,
                    activeShopId: data.activeShopId
                  }, r));
                  renderDrawerShops();
                  if (data.ozonShops.length === 0) {
                    shopSelect.innerHTML = `<option value="">-- 未绑定店铺 --</option>`;
                  } else {
                    shopSelect.innerHTML = data.ozonShops.map(s => 
                      `<option value="${s.id}" ${s.id === data.activeShopId ? 'selected' : ''}>🏢 ${s.name} (${s.clientId})</option>`
                    ).join('');
                  }
                  updateActiveShopTooltip();
                }
              });
            });
          }
        };
        renderDrawerShops();

        shadow.getElementById("ozon-target-margin").value = data.ozonTargetMargin || '20';
        shadow.getElementById("settings-theme").value = data.settingsTheme || 'system';
        
        shadow.getElementById("llm-provider").value = data.llmProvider || 'qwen';
        shadow.getElementById("llm-base-url").value = data.llmBaseUrl || '';
        shadow.getElementById("llm-api-key").value = data.apiKey || '';
        shadow.getElementById("llm-model").value = data.llmModel || 'qwen3.5-plus';
        shadow.getElementById("image-gen-model").value = data.imageGenerationModel || 'qwen-image-2.0';
        shadow.getElementById("llm-temperature").value = data.temperature !== undefined ? data.temperature : 0.2;
        shadow.getElementById("temp-val-display").innerText = data.temperature !== undefined ? data.temperature : 0.2;
        shadow.getElementById("llm-max-steps").value = data.maxLoopSteps || 25;

        toggleCustomUrlContainer(data.llmProvider);

        const highlightActiveChip = (containerId, val) => {
          const container = shadow.getElementById(containerId);
          if (container) {
            const chips = container.querySelectorAll(".chip");
            chips.forEach(c => {
              if (c.getAttribute("data-val") === val) {
                c.classList.add("active");
              } else {
                c.classList.remove("active");
              }
            });
          }
        };
        highlightActiveChip("llm-model-chips", data.llmModel || 'qwen3.5-plus');
        highlightActiveChip("image-gen-model-chips", data.imageGenerationModel || 'qwen-image-2.0');
      });
    });

    shadow.getElementById("settings-cancel").addEventListener("click", () => {
      settingsDrawer.classList.add("hidden");
    });

    shadow.getElementById("settings-save").addEventListener("click", () => {
      const activeShopId = shadow.getElementById("ozon-active-shop-select").value;
      const margin = shadow.getElementById("ozon-target-margin").value;
      const themeVal = shadow.getElementById("settings-theme").value;

      const llmProvider = shadow.getElementById("llm-provider").value;
      const llmBaseUrl = shadow.getElementById("llm-base-url").value.trim();
      const apiKey = shadow.getElementById("llm-api-key").value.trim();
      const llmModel = shadow.getElementById("llm-model").value.trim();
      const imageGenerationModel = shadow.getElementById("image-gen-model").value.trim();
      const temperature = parseFloat(shadow.getElementById("llm-temperature").value);
      const maxLoopSteps = parseInt(shadow.getElementById("llm-max-steps").value, 10) || 25;

      const settingsObj = {
        apiKey,
        llmProvider,
        llmModel,
        imageGenerationModel,
        llmBaseUrl,
        maxLoopSteps,
        temperature
      };

      chrome.storage.local.set({
        activeShopId,
        ozonTargetMargin: margin,
        settingsTheme: themeVal,
        llmProvider,
        llmBaseUrl,
        apiKey,
        llmModel,
        imageGenerationModel,
        llmMaxSteps: maxLoopSteps,
        temperature,
        settings: settingsObj
      }, () => {
        container.className = `theme-${themeVal}`;
        showToast("✅ 参数配置保存成功！");
        settingsDrawer.classList.add("hidden");
        updateActiveShopTooltip();
      });
    });

    dashBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    });

    shadow.getElementById("chat-new-session-btn")?.addEventListener("click", () => {
      startOverlayNewSessionMode();
      shadow.getElementById("chat-session-history-panel")?.classList.add("hidden");
      showToast("已切换为新会话，下一次运行不会沿用旧断点。");
      if (overlayPendingGrowthAction && !activeGrowthRun) {
        runOverlayGrowthActionNow({
          actionId: overlayPendingGrowthAction.actionId,
          instruction: overlayPendingGrowthAction.instruction,
          resume: false,
        }).catch((err) => showToast(`启动新会话失败：${err.message}`));
      }
    });

    shadow.getElementById("chat-session-history-btn")?.addEventListener("click", async () => {
      const panel = shadow.getElementById("chat-session-history-panel");
      if (!panel) return;
      const willShow = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !willShow);
      if (willShow) await renderOverlaySessionHistory();
    });

    // Track Current Product
    function trackCurrentProduct(options = {}) {
      const productUrl = window.location.href;
      const title = document.title.replace(/\s*-\s*купить.*$/i, '').trim(); // Strip Russian buying text
      
      chrome.storage.local.get(['trackedProducts'], (data) => {
        const list = data.trackedProducts || [];
        const exists = list.some(p => p.url === productUrl);
        if (exists) {
          if (!options.silent) showToast("ℹ️ 该商品已经在您的追踪列表中。");
          return;
        }

        list.push({
          id: `prod_${Date.now()}`,
          url: productUrl,
          title: title,
          registeredAt: new Date().toLocaleDateString(),
          phases: [
            {
              name: "阶段一：基线观测期",
              date: new Date().toLocaleDateString(),
              note: "商品注册追踪的初始阶段。"
            }
          ]
        });

        chrome.storage.local.set({ trackedProducts: list }, () => {
          showToast("🚀 商品已加入运营追踪与实验观察队列！");
        });
      });
    }

    // Chat sending message
    const sendMessage = () => {
      const inputEl = shadow.getElementById("chat-input-el");
      const text = inputEl.value.trim();
      if (!text) return;
      if (activeGrowthRun) {
        showToast(`当前「${activeGrowthRun.title || "Ozon 任务"}」仍在运行，请等待完成后再继续反馈。`);
        return;
      }

      addMessage("user", text);
      inputEl.value = '';
      
      runSelectedSkill(text);
    };

    shadow.getElementById("chat-send-btn").addEventListener("click", sendMessage);
    shadow.getElementById("chat-input-el").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    // Toast Notification helper
    function showToast(message) {
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.innerText = message;
      shadow.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    injectFloatingUI();
  } else {
    window.addEventListener("DOMContentLoaded", injectFloatingUI);
  }
})();
