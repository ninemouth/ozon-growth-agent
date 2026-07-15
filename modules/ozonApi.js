/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// modules/ozonApi.js — Ozon Seller API client implementation

const OZON_API_BASE = 'https://api-seller.ozon.ru';
const OZON_MIN_REQUEST_INTERVAL_MS = 1100;
const OZON_RATE_LIMIT_RETRY_MS = 1600;
let lastOzonRequestAt = 0;
let ozonRequestQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOzonSettings(explicitShopId = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ozonShops', 'activeShopId', 'ozonClientId', 'ozonApiKey', 'ozonWarehouseType'], (data) => {
      const shops = data.ozonShops || [];
      
      // Credentials Migration for backward compatibility
      if (shops.length === 0 && data.ozonClientId && data.ozonApiKey) {
        const migrated = {
          id: 'shop_migrated',
          name: '默认自营店铺',
          clientId: data.ozonClientId,
          apiKey: data.ozonApiKey,
          warehouseType: data.ozonWarehouseType || 'FBS',
          isDefault: true
        };
        chrome.storage.local.set({
          ozonShops: [migrated],
          activeShopId: 'shop_migrated'
        });
        resolve({
          clientId: migrated.clientId,
          apiKey: migrated.apiKey,
          warehouseType: migrated.warehouseType,
          shopId: migrated.id
        });
        return;
      }

      const activeId = explicitShopId || data.activeShopId;
      let activeShop = shops.find(s => s.id === activeId);
      if (!activeShop && shops.length > 0) {
        activeShop = shops.find(s => s.isDefault) || shops[0];
      }

      if (activeShop) {
        resolve({
          clientId: activeShop.clientId,
          apiKey: activeShop.apiKey,
          warehouseType: activeShop.warehouseType || 'FBS',
          shopId: activeShop.id
        });
      } else {
        resolve({
          clientId: '',
          apiKey: '',
          warehouseType: 'FBS',
          shopId: ''
        });
      }
    });
  });
}

export async function saveOzonSettings(clientId, apiKey, warehouseType = 'FBS') {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ozonShops'], (data) => {
      const shops = data.ozonShops || [];
      const newShop = {
        id: `shop_${Date.now()}`,
        name: '手动添加店铺',
        clientId,
        apiKey,
        warehouseType,
        isDefault: shops.length === 0
      };
      shops.push(newShop);
      chrome.storage.local.set({
        ozonShops: shops,
        activeShopId: newShop.id
      }, () => resolve(true));
    });
  });
}

async function waitForOzonRateSlot() {
  const elapsed = Date.now() - lastOzonRequestAt;
  if (elapsed < OZON_MIN_REQUEST_INTERVAL_MS) {
    await sleep(OZON_MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastOzonRequestAt = Date.now();
}

function parseOzonError(responseText) {
  let errorText = responseText;
  try {
    const errJson = JSON.parse(responseText);
    errorText = errJson.message || errJson.error?.message || JSON.stringify(errJson);
  } catch (_) {
    // Keep original response text when the body is not JSON.
  }
  return errorText;
}

async function makeQueuedOzonRequest(endpoint, payload = {}, attempt = 0) {
  const { clientId, apiKey } = await getOzonSettings();
  if (!clientId || !apiKey) {
    throw new Error('未配置 Ozon API Client-Id 或 Api-Key，请前往设置面板配置！');
  }

  const url = `${OZON_API_BASE}${endpoint}`;
  console.log(`[Ozon API Request] Fetching: ${endpoint}`, payload);

  await waitForOzonRateSlot();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  if (!response.ok) {
    const errorText = parseOzonError(responseText);
    if (response.status === 429 && attempt < 2) {
      const retryDelay = OZON_RATE_LIMIT_RETRY_MS * (attempt + 1);
      console.warn(`[Ozon API Rate Limit] ${endpoint} hit 429, retrying in ${retryDelay}ms...`);
      await sleep(retryDelay);
      return makeQueuedOzonRequest(endpoint, payload, attempt + 1);
    }
    throw new Error(`Ozon API 请求失败 (${response.status}): ${errorText}`);
  }

  try {
    return responseText ? JSON.parse(responseText) : {};
  } catch (err) {
    throw new Error(`Ozon API 返回了无法解析的 JSON (${response.status}): ${err.message}`);
  }
}

async function makeOzonRequest(endpoint, payload = {}) {
  const run = () => makeQueuedOzonRequest(endpoint, payload);
  const queued = ozonRequestQueue.then(run, run);
  ozonRequestQueue = queued.catch(() => {});
  return queued;
}

/**
 * 获取店铺所有商品列表
 * POST /v3/product/list
 */
export async function ozonGetProductList(limit = 100, lastId = '') {
  const payload = {
    filter: {
      visibility: 'ALL'
    },
    last_id: lastId,
    limit: limit
  };
  const res = await makeOzonRequest('/v3/product/list', payload);
  return res.result || { items: [], total: 0, last_id: '' };
}

/**
 * 批量查询商品详情、体积、类目佣金和收费情况
 * POST /v3/product/info/list
 */
export async function ozonGetProductInfo(productIds = [], skus = []) {
  if (productIds.length === 0 && skus.length === 0) {
    return { items: [] };
  }
  const payload = {};
  if (productIds.length > 0) payload.product_id = productIds;
  if (skus.length > 0) payload.sku = skus;

  const res = await makeOzonRequest('/v3/product/info/list', payload);
  return res.result || { items: [] };
}

/**
 * 获取店铺流量、加购、转化分析数据
 * Dimension can be: "sku", "day"
 * Metrics can be: "hits_view", "session_view", "ordered_units", "conv_tocart"
 */
export async function ozonGetAnalyticsData(dateFrom, dateTo, dimension = ['sku'], metrics = ['hits_view', 'session_view', 'ordered_units', 'conv_tocart']) {
  // Ozon API format: YYYY-MM-DD
  const payload = {
    date_from: dateFrom,
    date_to: dateTo,
    metrics: metrics,
    dimension: dimension,
    limit: 1000
  };
  const res = await makeOzonRequest('/v1/analytics/data', payload);
  return res.result || { data: [] };
}

/**
 * 获取 FBS 待履约/已履约发货单
 * POST /v3/posting/fbs/list
 */
export async function ozonGetFbsPostingList(dateFrom, dateTo, offset = 0, limit = 50) {
  const payload = {
    filter: {
      since: `${dateFrom}T00:00:00Z`,
      to: `${dateTo}T23:59:59Z`,
    },
    dir: 'ASC',
    offset,
    limit,
    with: {
      analytics_data: true,
      barcodes: true,
      financial_data: true,
      translit: true,
    },
  };
  const res = await makeOzonRequest('/v3/posting/fbs/list', payload);
  return res.result || { postings: [], count: 0 };
}

/**
 * 获取 FBO 发货单
 * POST /v2/posting/fbo/list
 */
export async function ozonGetFboPostingList(dateFrom, dateTo, offset = 0, limit = 50) {
  const payload = {
    filter: {
      since: `${dateFrom}T00:00:00Z`,
      to: `${dateTo}T23:59:59Z`,
    },
    dir: 'ASC',
    offset,
    limit,
    translit: true,
    with: {
      analytics_data: true,
      financial_data: true,
    },
  };
  const res = await makeOzonRequest('/v2/posting/fbo/list', payload);
  return res.result || { postings: [], count: 0 };
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function getDefaultOzonDateRange(days = 14) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - Math.max(1, days));
  return {
    dateFrom: toDateString(from),
    dateTo: toDateString(to)
  };
}

function sumMetricRows(rows = [], metricNames = []) {
  const totals = Object.fromEntries(metricNames.map((name) => [name, 0]));
  rows.forEach((row) => {
    const metrics = row.metrics || [];
    metricNames.forEach((metric, idx) => {
      const value = Number(metrics[idx] ?? row[metric] ?? 0);
      if (Number.isFinite(value)) totals[metric] += value;
    });
  });
  return totals;
}

function normalizePosting(posting = {}, deliverySchema = "") {
  const products = posting.products || [];
  const firstProduct = products[0] || {};
  const qty = products.reduce((sum, product) => sum + Number(product.quantity || 0), 0) || Number(firstProduct.quantity || 1);
  const price = products.reduce((sum, product) => sum + (Number(product.price || 0) * Number(product.quantity || 1)), 0);
  const normalizedSchema =
    deliverySchema ||
    posting.delivery_method?.name ||
    posting.analytics_data?.delivery_schema ||
    posting.financial_data?.posting_services?.delivery_schema ||
    "--";
  return {
    orderId: posting.posting_number || posting.order_number || posting.id || "--",
    sku: firstProduct.offer_id || firstProduct.sku || "--",
    cat: firstProduct.name || "Ozon 订单",
    qty,
    price: Number.isFinite(price) ? price : 0,
    logisticsType: normalizedSchema,
    status: posting.status || posting.substatus || "已同步",
    countdown: posting.shipment_date ? new Date(posting.shipment_date).toLocaleString() : "--",
  };
}

export async function ozonGetStoreSnapshot(args = {}) {
  const { dateFrom, dateTo } = args.dateFrom && args.dateTo
    ? args
    : getDefaultOzonDateRange(args.days || 14);
  const metrics = args.metrics || ['hits_view', 'session_view', 'ordered_units', 'conv_tocart'];

  const runSettled = async (fn) => {
    try {
      return { status: "fulfilled", value: await fn() };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  };

  const products = await runSettled(() => ozonGetProductList(args.productLimit || 100, args.lastId || ''));
  const analytics = await runSettled(() => ozonGetAnalyticsData(dateFrom, dateTo, args.dimension || ['day'], metrics));
  const fbsPostings = await runSettled(() => ozonGetFbsPostingList(dateFrom, dateTo, args.offset || 0, args.pageSize || 20));
  const fboPostings = await runSettled(() => ozonGetFboPostingList(dateFrom, dateTo, args.offset || 0, args.pageSize || 20));

  const failures = [];
  const result = {
    ok: true,
    source: "ozon_seller_api",
    dateFrom,
    dateTo,
    products: { items: [], total: 0 },
    analytics: { data: [], totals: {}, metrics },
    postings: { fbs: [], fbo: [], count: 0 },
    orders: [],
    failures,
  };

  if (products.status === "fulfilled") {
    result.products = products.value;
  } else {
    failures.push({ endpoint: "ozonGetProductList", error: products.reason?.message || String(products.reason) });
  }

  if (analytics.status === "fulfilled") {
    result.analytics.data = analytics.value.data || [];
    result.analytics.totals = sumMetricRows(result.analytics.data, metrics);
  } else {
    failures.push({ endpoint: "ozonGetAnalyticsData", error: analytics.reason?.message || String(analytics.reason) });
  }

  if (fbsPostings.status === "fulfilled") {
    result.postings.fbs = fbsPostings.value.postings || [];
  } else {
    failures.push({ endpoint: "ozonGetFbsPostingList", error: fbsPostings.reason?.message || String(fbsPostings.reason) });
  }

  if (fboPostings.status === "fulfilled") {
    result.postings.fbo = fboPostings.value.postings || [];
  } else {
    failures.push({ endpoint: "ozonGetFboPostingList", error: fboPostings.reason?.message || String(fboPostings.reason) });
  }

  result.postings.count = result.postings.fbs.length + result.postings.fbo.length;
  result.orders = [
    ...result.postings.fbs.map((posting) => normalizePosting(posting, "Ozon Rocket FBS")),
    ...result.postings.fbo.map((posting) => normalizePosting(posting, "Ozon FBO")),
  ].slice(0, args.pageSize || 20);

  result.ok = failures.length === 0;
  return result;
}
