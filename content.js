// content.js — Page context reader for Skill Runner

(function () {
  "use strict";

  function closePopups() {
    const popupSelectors = [
      'button[id*="accept"]', 'button[class*="accept"]', // Accept cookies
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      'button[class*="close"]', '.close-btn', '.modal-close',
      'a[class*="close"]', 'div[class*="close-icon"]',
      '.tb-ie-updater-close', // taobao specific
    ];
    let closed = 0;
    for (const sel of popupSelectors) {
      document.querySelectorAll(sel).forEach(el => {
        // Only click if it's visible
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          try { el.click(); closed++; } catch (e) {}
        }
      });
    }
    return closed;
  }

  function readCurrentPage() {
    closePopups(); // Auto-close intrusive popups before reading/screenshotting
    const title = document.title || "";
    const url = window.location.href;

    const h1 = document.querySelector("h1")?.innerText?.trim() || "";
    const h2s = Array.from(document.querySelectorAll("h2"))
      .map((el) => el.innerText?.trim())
      .filter(Boolean)
      .slice(0, 5);

    // Price extraction — works for Etsy, Amazon, Temu etc.
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

    // Description extraction
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

    // Review / rating
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

    // Visible body text (truncated)
    const visibleText = document.body.innerText?.slice(0, 15000) || "";

    // Images (top 20 http images)
    const images = Array.from(document.querySelectorAll("img"))
      .map((img) => ({
        src: img.src,
        alt: img.alt || "",
      }))
      .filter((img) => img.src && img.src.startsWith("http"))
      .slice(0, 20);

    // Meta tags
    const metaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const metaKeywords =
      document.querySelector('meta[name="keywords"]')?.getAttribute("content") || "";

    // Selected text (if any)
    const selectedText = window.getSelection()?.toString()?.trim() || "";

    // Structured data (JSON-LD)
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
      selectedText,
      structuredData,
    };
  }

  function extractProductInfo() {
    const page = readCurrentPage();

    // Try to build a focused product object
    const product = {
      title: page.h1 || page.title,
      price: page.price,
      rating: page.rating,
      reviewCount: page.reviewCount,
      description: page.description || page.metaDescription,
      images: page.images.slice(0, 5).map((i) => i.src),
      url: page.url,
    };

    return product;
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
      } else if (message.type === "CLICK_BY_TEXT") {
        closePopups(); // clear popups before clicking
        const textToFind = (message.text || "").trim().toLowerCase();
        let clicked = false;
        if (textToFind) {
          const elements = Array.from(document.querySelectorAll('a, button, li, span, div[role="button"], div[role="tab"]'));
          for (const el of elements) {
             const innerText = (el.innerText || "").trim().toLowerCase();
             if (innerText === textToFind) {
                // strict match first
                el.click();
                clicked = true;
                break;
             }
          }
          if (!clicked) {
             for (const el of elements) {
               const innerText = (el.innerText || "").trim().toLowerCase();
               if (innerText.includes(textToFind) && innerText.length < textToFind.length + 5) {
                  el.click();
                  clicked = true;
                  break;
               }
             }
          }
        }
        sendResponse({ ok: clicked, message: clicked ? `Clicked text: ${message.text}` : `Text not found or not clickable: ${message.text}` });
      } else if (message.type === "SCROLL_TO_TOP") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        sendResponse({ ok: true });
      } else if (message.type === "RENDER_GUIDE_OVERLAYS") {
        // 1. Clean up existing bubbles and highlights
        document.querySelectorAll(".agent-guide-bubble").forEach(el => el.remove());
        document.querySelectorAll(".agent-highlighted").forEach(el => {
          el.style.outline = "";
          el.style.outlineOffset = "";
          el.classList.remove("agent-highlighted");
        });
        
        const guides = message.guides || [];
        let renderedCount = 0;
        
        guides.forEach(guide => {
          if (!guide.selector || !guide.text) return;
          const target = document.querySelector(guide.selector);
          if (target) {
            target.classList.add("agent-highlighted");
            target.style.outline = "3px solid #6366f1"; // Indigo accent color
            target.style.outlineOffset = "3px";
            
            const rect = target.getBoundingClientRect();
            
            // Create tooltip bubble
            const bubble = document.createElement("div");
            bubble.className = "agent-guide-bubble";
            bubble.style.cssText = `
              position: absolute;
              top: ${rect.bottom + window.scrollY + 8}px;
              left: ${rect.left + window.scrollX}px;
              background: #0f172a;
              color: #f8fafc;
              padding: 10px 14px;
              border-radius: 8px;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
              font-size: 12px;
              z-index: 2147483647;
              max-width: 260px;
              line-height: 1.5;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              border: 1px solid #334155;
            `;
            
            bubble.innerHTML = `
              <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
                <span style="font-weight:700; color:#818cf8; font-size:11px;">💡 AI 投流引导</span>
                <span class="close-guide-bubble" style="cursor:pointer; font-size:14px; color:#94a3b8; line-height:1; font-weight:bold;">&times;</span>
              </div>
              <div style="margin-top:6px; color:#cbd5e1; font-size:11px;">${guide.text}</div>
            `;
            
            bubble.querySelector(".close-guide-bubble").addEventListener("click", () => {
              bubble.remove();
              target.style.outline = "";
              target.style.outlineOffset = "";
            });
            
            document.body.appendChild(bubble);
            renderedCount++;
          }
        });
        
        sendResponse({ ok: true, count: renderedCount });
      } else {
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }

    // Return true to keep async response channel open
    return true;
  });
})();
