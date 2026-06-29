window.onload = async function() {
  try {
    const data = await new Promise((resolve) => {
      chrome.storage.local.get(["printHtml"], resolve);
    });
    
    if (data.printHtml) {
      document.open();
      // Remove any inline scripts from the raw printHtml template to avoid double-execution
      const cleanedHtml = data.printHtml.replace(/<script>[\s\S]*?<\/script>/gi, "");
      document.write(cleanedHtml);
      document.close();
      
      // Trigger print after the DOM finishes rendering
      setTimeout(() => {
        window.print();
      }, 600);
    } else {
      document.body.innerHTML = "<div style='padding:30px;font-family:sans-serif;color:#e53e3e;text-align:center;'>❌ 未找到打印报告数据，请在侧边栏重新点击下载。</div>";
    }
  } catch (err) {
    document.body.innerHTML = `<div style='padding:30px;font-family:sans-serif;color:#e53e3e;text-align:center;'>❌ 载入出错: ${err.message}</div>`;
  }
};
