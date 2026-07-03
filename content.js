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

  async function clickRememberedInteraction(kind) {
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
      const rect = preferred.getBoundingClientRect();
      if (rect.width >= 90 && rect.height >= 90 && rect.width <= window.innerWidth * 0.98 && rect.height <= Math.max(window.innerHeight * 1.4, 900)) {
        return preferred;
      }
    }

    let el = anchor;
    for (let depth = 0; depth < 6 && el?.parentElement; depth++) {
      el = el.parentElement;
      const rect = el.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 120 && rect.width <= window.innerWidth * 0.95 && el.querySelector("img")) {
        return el;
      }
    }
    return anchor;
  }

  function getLargestProductImage(container) {
    const images = Array.from(container.querySelectorAll("img"))
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = getBestImageSrc(img);
        const descriptor = `${src} ${img.alt || ""} ${img.title || ""} ${img.className || ""}`.toLowerCase();
        const naturalArea = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
        const visualArea = rect.width * rect.height;
        let score = Math.max(naturalArea / 8, visualArea);
        if (rect.width >= 120 && rect.height >= 120) score += 400;
        if (/logo|icon|avatar|sprite|badge|star|rating|qr|qrcode|placeholder|blank|loading/.test(descriptor)) score -= 1200;
        if (!src || !/^https?:\/\//i.test(src)) score -= 800;
        if (!isVisibleElement(img)) score -= 400;
        return {
          img,
          src,
          alt: normalizeText(img.alt || img.title || "", 120),
          rect,
          naturalWidth: img.naturalWidth || img.width || 0,
          naturalHeight: img.naturalHeight || img.height || 0,
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

  function readCurrentPage() {
    closePopups();
    const title = document.title || "";
    const url = window.location.href;

    const h1 = document.querySelector("h1")?.innerText?.trim() || "";
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
      document.querySelector('[itemprop="ratingValue"]') ||
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
    const productCards = extractProductCards();

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
      const explicitImageSearch = /搜索图片|图片搜索|以图搜索|以图搜款|找同款|搜图|开始搜索|确认搜索/i.test(label);
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
        sendResponse({ ok: true, data: readCurrentPage() });
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

            if (!fileInput) {
              sendResponse({ ok: false, error: "Could not find image search upload input element on the page" });
              return;
            }

            const response = await fetch(`data:image/jpeg;base64,${base64}`);
            const blob = await response.blob();
            const file = new File([blob], "image_search.jpg", { type: "image/jpeg" });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

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
})();
