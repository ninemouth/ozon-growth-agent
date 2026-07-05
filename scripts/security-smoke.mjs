import assert from "node:assert/strict";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const SANITIZE_ALLOWED_TAGS = ["H1", "H2", "H3", "H4", "H5", "H6", "P", "SPAN", "DIV", "UL", "OL", "LI", "STRONG", "EM", "CODE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BR", "A", "HR"];
const SANITIZE_ALLOWED_ATTR = ["href", "class", "target", "rel", "title", "style"];
const SANITIZE_FORBID_TAGS = ["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "SVG", "MATH", "TEMPLATE"];

const { window } = new JSDOM("<!doctype html><html><body></body></html>");
const DOMPurify = createDOMPurify(window);

function sanitizeStyleAttr(styleValue) {
  if (!styleValue || /url\s*\(|expression\s*\(|javascript:|data:|@import|-moz-binding/i.test(styleValue)) return "";
  const allowedProps = new Set([
    "align-items", "background", "background-color", "border", "border-bottom", "border-collapse", "border-color",
    "border-left", "border-radius", "border-right", "border-top", "box-shadow", "box-sizing", "break-inside",
    "color", "display", "flex", "font-family", "font-size", "font-style", "font-weight", "gap", "height",
    "justify-content", "letter-spacing", "line-height", "list-style-type", "margin", "margin-bottom",
    "margin-left", "margin-right", "margin-top", "max-width", "min-width", "overflow", "overflow-wrap",
    "padding", "padding-bottom", "padding-left", "padding-right", "padding-top", "page-break-inside",
    "text-align", "text-decoration", "text-transform", "vertical-align", "white-space", "width",
    "word-break", "word-wrap",
  ]);

  return styleValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf(":");
      if (separatorIndex <= 0) return "";
      const prop = part.slice(0, separatorIndex).trim().toLowerCase();
      const value = part.slice(separatorIndex + 1).trim();
      if (!allowedProps.has(prop) || !value || /[<>]/.test(value)) return "";
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeHtmlFallback(htmlString) {
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(String(htmlString || ""), "text/html");
  const dropContentTags = new Set(SANITIZE_FORBID_TAGS);

  function sanitizeNode(node) {
    if (node.nodeType === window.Node.TEXT_NODE) return;
    if (node.nodeType === window.Node.ELEMENT_NODE) {
      const tagName = node.tagName.toUpperCase();
      if (!SANITIZE_ALLOWED_TAGS.includes(tagName)) {
        const parent = node.parentNode;
        if (parent && dropContentTags.has(tagName)) {
          parent.removeChild(node);
        } else if (parent) {
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
        }
        return;
      }

      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const attrName = attr.name.toLowerCase();
        if (!SANITIZE_ALLOWED_ATTR.includes(attrName)) {
          node.removeAttribute(attr.name);
        } else if (attrName === "href") {
          const val = attr.value.trim().toLowerCase();
          if (!val.startsWith("http://") && !val.startsWith("https://") && !val.startsWith("#") && !val.startsWith("/")) {
            node.removeAttribute("href");
          }
        } else if (attrName === "target" && attr.value !== "_blank") {
          node.removeAttribute("target");
        } else if (attrName === "style") {
          const safeStyle = sanitizeStyleAttr(attr.value);
          if (safeStyle) node.setAttribute("style", safeStyle);
          else node.removeAttribute("style");
        }
      }

      if (tagName === "A" && node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
      }

      Array.from(node.childNodes).forEach(sanitizeNode);
    }
  }

  Array.from(doc.body.childNodes).forEach(sanitizeNode);
  return doc.body.innerHTML;
}

function sanitizeHtml(htmlString) {
  const purifiedHtml = DOMPurify.sanitize(htmlString, {
    ALLOWED_TAGS: SANITIZE_ALLOWED_TAGS.map((tag) => tag.toLowerCase()),
    ALLOWED_ATTR: SANITIZE_ALLOWED_ATTR,
    FORBID_TAGS: SANITIZE_FORBID_TAGS.map((tag) => tag.toLowerCase()),
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    RETURN_TRUSTED_TYPE: false,
    SANITIZE_DOM: true,
  });
  return sanitizeHtmlFallback(purifiedHtml);
}

function maskApiKeys(str) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(/(Bearer\s+)[a-zA-Z0-9\-_.~]+/gi, "$1sk-...****")
    .replace(/\b(sk-[a-zA-Z0-9]{8,})[a-zA-Z0-9_-]+/g, "$1****")
    .replace(/\b(gho_[a-zA-Z0-9_]{8,})[a-zA-Z0-9_]+/g, "$1****")
    .replace(/\b(github_pat_[a-zA-Z0-9_]{8,})[a-zA-Z0-9_]+/g, "$1****")
    .replace(/((?:api[_-]?key|x-api-key|authorization|token|secret|password)["'\s:=]+)(["']?)[^"'\s,}]+/gi, "$1$2****");
}

const dirtyHtml = `
  <h2 onclick="alert(1)">Report</h2>
  <script>window.evil = true</script>
  <iframe src="https://evil.example"></iframe>
  <a href="javascript:alert(1)" target="_self">bad</a>
  <a href="https://example.com" target="_blank">good</a>
  <div style="padding: 10px; text-align: left">safe layout</div>
  <span style="color:red; background-image:url(javascript:alert(1)); width:100%">styled</span>
  <table><tr><td style="padding: 10px; behavior: url(#bad)">cell</td></tr></table>
`;

const clean = sanitizeHtml(dirtyHtml);
assert.equal(clean.includes("<script"), false, "script tags must be removed");
assert.equal(clean.includes("<iframe"), false, "iframe tags must be removed");
assert.equal(clean.includes("onclick"), false, "event handler attributes must be removed");
assert.equal(clean.includes("javascript:"), false, "javascript URLs must be removed");
assert.equal(clean.includes("background-image"), false, "unsafe CSS properties must be removed");
assert.equal(clean.includes("behavior:"), false, "unsafe CSS values must be removed");
assert.match(clean, /rel="noopener noreferrer"/, "blank target links must get safe rel attributes");
assert.match(clean, /padding: 10px/, "safe report layout CSS should be preserved");
assert.match(clean, /text-align: left/, "safe report alignment CSS should be preserved");

const masked = maskApiKeys('Bearer sk-live1234567890abcdef token="github_pat_1234567890abcdef" apiKey: secret-value');
assert.equal(masked.includes("secret-value"), false, "plain apiKey value must be masked");
assert.equal(masked.includes("github_pat_1234567890abcdef"), false, "GitHub token must be masked");
assert.equal(masked.includes("sk-live1234567890abcdef"), false, "Bearer token must be masked");

console.log("security smoke passed");
