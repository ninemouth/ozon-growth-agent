/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
window.onload = async function() {
  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(["printHtml"], resolve);
    });
    
    if (data.printHtml) {
      // Parse the stored HTML string safely
      const parser = new DOMParser();
      const doc = parser.parseFromString(data.printHtml, "text/html");
      
      // Batch styles into a document fragment to minimize layout recalculations
      const styleFragment = document.createDocumentFragment();
      const styles = doc.querySelectorAll("style");
      styles.forEach(style => {
        styleFragment.appendChild(document.importNode(style, true));
      });
      document.head.appendChild(styleFragment);
      
      // Batch body elements into a document fragment to trigger a single layout/reflow pass
      const bodyFragment = document.createDocumentFragment();
      const bodyElements = Array.from(doc.body.childNodes);
      bodyElements.forEach(el => {
        // Skip script tags to avoid double-execution/warnings
        if (el.tagName === "SCRIPT") return;
        bodyFragment.appendChild(document.importNode(el, true));
      });
      
      document.body.innerHTML = ""; // Clear loader message
      document.body.appendChild(bodyFragment);
      
      // Wait for the browser rendering engine to finish reflow and paint using requestAnimationFrame.
      // 1000ms delay combined with double requestAnimationFrame guarantees a full paint cycle completes,
      // avoiding blank page captures in Chrome's print preview dialog.
      setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.print();
          });
        });
      }, 1000);
    } else {
      document.body.innerHTML = "<div style='padding:30px;font-family:sans-serif;color:#e53e3e;text-align:center;'>❌ 未找到打印报告数据，请在侧边栏重新点击下载。</div>";
    }
  } catch (err) {
    document.body.innerHTML = `<div style='padding:30px;font-family:sans-serif;color:#e53e3e;text-align:center;'>❌ 载入出错: ${err.message}</div>`;
  }
};
