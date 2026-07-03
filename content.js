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
      '.identity-dialog-close', '.su-dialog-close', '.mod-close',
      '.s-dialog-close', '[class*="dialog-close"]', '[class*="modal-close"]'
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

    // Extract product links on the page (up to 50 links)
    const productLinks = [];
    try {
      const anchors = Array.from(document.querySelectorAll("a"));
      const isSearchEngine = window.location.hostname.includes("google.com") || window.location.hostname.includes("bing.com");
      const processedLinks = new Set();
      for (const a of anchors) {
        let href = a.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
        
        if (href.startsWith("//")) {
          href = window.location.protocol + href;
        } else if (href.startsWith("/")) {
          href = window.location.origin + href;
        }
        
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
          const text = (a.innerText || "").trim().replace(/\s+/g, ' ').slice(0, 100);
          if (text && !processedLinks.has(href)) {
            processedLinks.add(href);
            productLinks.push({ href, text });
            if (productLinks.length >= 50) break;
          }
          continue;
        }
        
        let isProductLink = false;
        
        if (lowerHref.includes("1688.com")) {
          if (lowerHref.includes("offer") || lowerHref.includes("item") || lowerHref.includes("click") || lowerHref.includes("jump") || /\/\d{9,15}\.html/.test(lowerHref) || /[?&](offerid|id)=\d+/i.test(lowerHref)) {
            isProductLink = true;
          }
        } else if (lowerHref.includes("taobao.com") || lowerHref.includes("tmall.com")) {
          if (lowerHref.includes("item.htm") || lowerHref.includes("/item/") || /[?&]id=\d+/i.test(lowerHref)) {
            isProductLink = true;
          }
        } else if (lowerHref.includes("amazon.com") || lowerHref.includes("amazon.co.jp") || lowerHref.includes("amazon.de") || lowerHref.includes("amazon.co.uk")) {
          if (lowerHref.includes("/dp/") || lowerHref.includes("/gp/product/")) {
            isProductLink = true;
          }
        } else if (
          lowerHref.includes("etsy.com/listing/") ||
          lowerHref.includes("temu.com/") ||
          lowerHref.includes("aliexpress.com/item/")
        ) {
          isProductLink = true;
        }
          
        if (isProductLink && !processedLinks.has(href)) {
          processedLinks.add(href);
          const linkText = (a.innerText || "").trim().replace(/\s+/g, ' ').slice(0, 100);
          productLinks.push({
            href,
            text: linkText
          });
          if (productLinks.length >= 50) break;
        }
      }
    } catch (_) {}

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
      productLinks,
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
      } else if (message.type === "INPUT_TEXT_AND_SEARCH") {
        const { keyword, inputSelector, submitSelector } = message;
        if (!keyword) {
          sendResponse({ ok: false, error: "keyword is required" });
          return;
        }
        
        let inputEl = null;
        if (inputSelector) {
          inputEl = document.querySelector(inputSelector);
        } else {
          const commonInputs = [
            'input#q', 'input#alisearch-keywords', 'input#key',
            'input[name="q"]', 'input[name="keywords"]', 'input[name="keyword"]',
            'input[type="search"]', 'input[placeholder*="搜索"]', 'input[placeholder*="Search"]',
            'input.search-input', 'input.alisearch-input'
          ];
          for (const sel of commonInputs) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
              inputEl = el;
              break;
            }
          }
        }
        
        if (!inputEl) {
          sendResponse({ ok: false, error: "Could not find search input field on the page" });
          return;
        }
        
        // Asynchronously perform human-like keyboard typing simulation
        (async () => {
          inputEl.focus();
          
          // Clear current input value in a React-safe way
          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeSetter.call(inputEl, "");
          } catch (_) {
            inputEl.value = "";
          }
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          
          // Type character-by-character with random human speed delays
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
            
            await new Promise(r => setTimeout(r, 30 + Math.random() * 70)); // 30-100ms delay per char
          }
          
          let submitEl = null;
          if (submitSelector) {
            submitEl = document.querySelector(submitSelector);
          } else {
            const commonSubmits = [
              '.alisearch-action', '.btn-search', 'button[type="submit"]',
              'button.search-btn', 'input[type="submit"]', '.search-button',
              'div[class*="search"] button', 'span[class*="search"] button'
            ];
            for (const sel of commonSubmits) {
              const el = document.querySelector(sel);
              if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                submitEl = el;
                break;
              }
            }
            
            if (!submitEl) {
              const buttons = Array.from(document.querySelectorAll('button, a, div, span'));
              for (const btn of buttons) {
                const txt = btn.innerText.trim();
                if ((txt === '搜索' || txt === 'Search' || txt === '🔍') && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                  submitEl = btn;
                  break;
                }
              }
            }
          }
          
          if (submitEl) {
            submitEl.click();
            sendResponse({ ok: true, clickedButton: true });
          } else if (inputEl.form) {
            inputEl.form.submit();
            sendResponse({ ok: true, submittedForm: true });
          } else {
            const eventOptions = {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            };
            inputEl.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
            inputEl.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
            inputEl.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
            sendResponse({ ok: true, pressedEnter: true });
          }
        })();
        
        return true; // Keep message channel open for async response
      } else if (message.type === "IMAGE_SEARCH_IN_BROWSER") {
        const { base64 } = message;
        if (!base64) {
          sendResponse({ ok: false, error: "base64 is required" });
          return;
        }

        (async () => {
          try {
            // Find input file element
            let fileInput = null;
            const commonFileInputs = [
              'input[type="file"].upload-pic',
              'input[type="file"].s-search-upload',
              'input[type="file"]',
              'input[accept*="image"]'
            ];
            
            // Try to find file input immediately
            for (const sel of commonFileInputs) {
              const el = document.querySelector(sel);
              if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                fileInput = el;
                break;
              }
            }

            // If not found, try to click the camera icon to trigger input creation
            if (!fileInput) {
              const cameraSelectors = [
                '.camera-icon', '.s-search-upload', '.search-imgupload',
                '[class*="camera"]', '[class*="imgupload"]', '.search-imgupload-input'
              ];
              let cameraBtn = null;
              for (const sel of cameraSelectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                  cameraBtn = el;
                  break;
                }
              }
              if (cameraBtn) {
                cameraBtn.click();
                await new Promise(r => setTimeout(r, 600)); // wait for dynamically loaded input
                // Look again
                for (const sel of commonFileInputs) {
                  const el = document.querySelector(sel);
                  if (el) {
                    fileInput = el;
                    break;
                  }
                }
              }
            }

            // If still not found, check if we can query any file inputs
            if (!fileInput) {
              fileInput = document.querySelector('input[type="file"]');
            }

            if (!fileInput) {
              sendResponse({ ok: false, error: "Could not find image search upload input element on the page" });
              return;
            }

            // Convert base64 to File
            const response = await fetch(`data:image/jpeg;base64,${base64}`);
            const blob = await response.blob();
            const file = new File([blob], "image_search.jpg", { type: "image/jpeg" });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            // Method 1: Populate file input and trigger change & input events
            try {
              fileInput.files = dataTransfer.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              if (typeof fileInput.onchange === 'function') {
                fileInput.onchange();
              }
            } catch (e) {
              console.warn("Method 1 (File Input Change) failed or was ignored:", e.message);
            }

            // Method 2: Simulate Ctrl+V Clipboard paste event on the main text search input box (essential backup)
            try {
              let searchInputEl = null;
              const commonInputs = [
                'input#q', 'input#alisearch-keywords', 'input#key',
                'input[name="q"]', 'input[name="keywords"]', 'input[name="keyword"]',
                'input[type="search"]', 'input[placeholder*="搜索"]', 'input[placeholder*="Search"]',
                'input.search-input', 'input.alisearch-input'
              ];
              for (const sel of commonInputs) {
                const el = document.querySelector(sel);
                if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                  searchInputEl = el;
                  break;
                }
              }
              if (searchInputEl) {
                searchInputEl.focus();
                const pasteData = new DataTransfer();
                pasteData.items.add(file);
                const pasteEvent = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: pasteData
                });
                searchInputEl.dispatchEvent(pasteEvent);
              }
            } catch (e) {
              console.warn("Method 2 (Clipboard Paste) failed:", e.message);
            }
            
            sendResponse({ ok: true, message: "Successfully dispatched image search upload events (Change & Paste)" });
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
          }
        })();
        return true; // Keep channel open
      } else if (message.type === "CLICK_BY_COORDINATE") {
        const { x, y } = message;
        if (x === undefined || y === undefined) {
          sendResponse({ ok: false, error: "x and y coordinates are required" });
          return;
        }

        // Convert percentage coordinates (e.g. 0.0 - 1.0) to absolute pixel coordinates
        const clientX = x <= 1.0 ? x * window.innerWidth : x;
        const clientY = y <= 1.0 ? y * window.innerHeight : y;

        try {
          const element = document.elementFromPoint(clientX, clientY);
          if (!element) {
            sendResponse({ ok: false, error: `No element found at coordinate (${clientX}, ${clientY})` });
            return;
          }

          // Simulate full human hover and mouse click event chain
          const mouseOptions = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: clientX,
            clientY: clientY
          };

          element.dispatchEvent(new MouseEvent('mouseover', mouseOptions));
          element.dispatchEvent(new MouseEvent('mousemove', mouseOptions));
          element.dispatchEvent(new MouseEvent('mousedown', mouseOptions));
          
          if (typeof element.focus === 'function') {
            element.focus();
          }
          
          element.dispatchEvent(new MouseEvent('mouseup', mouseOptions));
          element.dispatchEvent(new MouseEvent('click', mouseOptions));
          
          // Also invoke native HTML element click to ensure standard handlers run
          if (typeof element.click === 'function') {
            element.click();
          }

          sendResponse({ 
            ok: true, 
            message: `Successfully clicked visually at (${clientX}, ${clientY})`, 
            tagName: element.tagName,
            className: element.className,
            id: element.id
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
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
