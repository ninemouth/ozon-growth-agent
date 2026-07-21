/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */

export const MAX_GOOGLE_TRENDS_QUERY_ATTEMPTS = 3;

function normalizedText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeTrendQuery(value = "") {
  return normalizedText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/["'`«»]/g, "")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

function trendResultText(result = {}) {
  const pageData = result.pageData || {};
  return [
    result.message,
    result.error,
    result.evidenceStatus,
    result.trendsEvidenceState?.readiness,
    pageData.title,
    pageData.visibleText,
    pageData.text,
    pageData.bodyText,
  ].filter(Boolean).join(" ");
}

export function classifyGoogleTrendsEvidence(result = {}) {
  const text = trendResultText(result);
  const readiness = String(result.trendsEvidenceState?.readiness || "");
  const explicitNoData = /not enough data|doesn.?t have enough data|данных недостаточно|недостаточно данных|数据不足/i.test(text);
  const shellLoaded = /google trends|trends explore|тренды google|trend_shell/i.test(text) ||
    ["core_modules_visible", "trend_shell_with_screenshot", "trend_shell_visible"].includes(readiness);
  const validReadiness = ["core_modules_visible", "trend_shell_with_screenshot"].includes(readiness);
  const requestFailed = Boolean(result.error) || (result.ok === false && !shellLoaded && !explicitNoData);
  const insufficient = explicitNoData || requestFailed || result.evidenceOk === false || !validReadiness;
  return {
    insufficient,
    loaded: shellLoaded && !requestFailed,
    reason: explicitNoData
      ? "loaded_but_not_enough_data"
      : requestFailed
        ? "request_failed"
        : !validReadiness
          ? "trend_modules_not_ready"
          : "usable",
  };
}

export function collectGoogleTrendsAttempts(toolHistory = []) {
  return toolHistory
    .filter((entry) => entry?.tool === "search_in_browser" && String(entry.arguments?.engine || "").toLowerCase() === "google_trends")
    .map((entry, index) => {
      const requestedQuery = normalizedText(entry.arguments?.query || entry.arguments?.keyword || "");
      const queryUsed = normalizedText(entry.result?.queryUsed || requestedQuery);
      return {
        attempt: index + 1,
        requestedQuery,
        queryUsed,
        normalizedRequestedQuery: normalizeTrendQuery(requestedQuery),
        normalizedQueryUsed: normalizeTrendQuery(queryUsed),
        ...classifyGoogleTrendsEvidence(entry.result || {}),
      };
    });
}

export function getTrendQueryGuardError({ skillId = "", toolName = "", toolArgs = {}, toolHistory = [] } = {}) {
  const isPlatformTrend = String(skillId).includes("ozon_platform_trends");
  const isGoogleTrends = toolName === "search_in_browser" && String(toolArgs.engine || "").toLowerCase() === "google_trends";
  if (!isPlatformTrend || !isGoogleTrends) return null;

  const query = normalizedText(toolArgs.query || toolArgs.keyword || "");
  const normalizedQuery = normalizeTrendQuery(query);
  if (!normalizedQuery) {
    return {
      type: "trend_query_guard",
      error: "Google Trends 查询缺少俄语关键词。请从关键词漏斗的聚焦词中选择一个明确查询，不要提交空查询。",
    };
  }

  const attempts = collectGoogleTrendsAttempts(toolHistory);
  const duplicate = attempts.some((attempt) =>
    attempt.normalizedRequestedQuery === normalizedQuery || attempt.normalizedQueryUsed === normalizedQuery
  );
  if (duplicate) {
    return {
      type: "trend_query_guard",
      error: `趋势词“${query}”本轮已经查询过，不允许重复打开相同页面。请退宽一个语义层级或切换 Ozon/Yandex 已发现的俄语同义词。`,
      attemptedQueries: attempts.map((attempt) => attempt.queryUsed || attempt.requestedQuery),
    };
  }
  if (attempts.length >= MAX_GOOGLE_TRENDS_QUERY_ATTEMPTS) {
    return {
      type: "trend_query_guard",
      error: "Google Trends 关键词恢复已达到 3 次上限。停止继续搜索，把该来源标记为数据不足，并使用 Ozon/Yandex 的真实证据完成机会判断。",
      attemptedQueries: attempts.map((attempt) => attempt.queryUsed || attempt.requestedQuery),
    };
  }
  return null;
}

export function getTrendQueryRefinementState(skillId = "", toolHistory = []) {
  if (!String(skillId).includes("ozon_platform_trends")) return { required: false, exhausted: false, attempts: [] };
  const attempts = collectGoogleTrendsAttempts(toolHistory);
  if (!attempts.length) return { required: false, exhausted: false, attempts };
  if (attempts.some((attempt) => !attempt.insufficient)) return { required: false, exhausted: false, attempts };

  const last = attempts[attempts.length - 1];
  const exhausted = attempts.length >= MAX_GOOGLE_TRENDS_QUERY_ATTEMPTS;
  if (exhausted) {
    return {
      required: false,
      exhausted: true,
      attempts,
      message: "Google Trends 的 3 个不同词均缺少可用数据。停止继续搜索，趋势与季节性必须降级为待验证假设，并写入 blocking_gaps。",
    };
  }

  const firstRecovery = attempts.length === 1;
  return {
    required: true,
    exhausted: false,
    attempts,
    nextAttempt: attempts.length + 1,
    message: firstRecovery
      ? `当前趋势词“${last.queryUsed || last.requestedQuery}”页面已加载但数据不足。请立即退宽一个语义层级：删除产地、年份、用途等组合修饰，改用 1-2 个词的俄语品类头词；新词必须来自本轮 Ozon/Yandex 已发现词族，并标记为 parent_proxy，不能直接证明原始细分品类增长。`
      : `第二个趋势词“${last.queryUsed || last.requestedQuery}”仍缺少数据。请切换到另一个俄语同义词族或相邻需求表达，不要重复旧词；这是最后一次恢复查询，并必须标记 exact / parent_proxy / adjacent_proxy 的范围关系。`,
  };
}

export function hasUsableGoogleTrendsAttempt(toolHistory = []) {
  return collectGoogleTrendsAttempts(toolHistory).some((attempt) => !attempt.insufficient);
}
