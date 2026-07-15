/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Global workflow engine for extension jobs.
// Harness builds a WorkflowSpec; this engine owns scheduling and state.

import {
  appendTaskLog,
  appendWorkflowEvent,
  requestWorkflowCancellation,
  saveWorkflowSnapshot,
} from './workflowRuntime.js';

function nowIso() {
  return new Date().toISOString();
}

function createJobId() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
  return `job:${Date.now()}:${random}`;
}

function safeClone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function publicJob(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    workflowId: job.workflowId,
    status: job.status,
    actionKind: job.actionKind,
    source: job.source,
    ownerId: job.ownerId,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    failedAt: job.failedAt || "",
    cancelledAt: job.cancelledAt || "",
    error: job.error || "",
    metadata: safeClone(job.metadata || {}),
  };
}

export class WorkflowEngine {
  constructor({ maxConcurrent = 1 } = {}) {
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 1);
    this.queue = [];
    this.running = new Map();
    this.jobs = new Map();
  }

  getState() {
    return {
      maxConcurrent: this.maxConcurrent,
      running: Array.from(this.running.values()).map(publicJob),
      queued: this.queue.map(publicJob),
      recent: Array.from(this.jobs.values())
        .map(publicJob)
        .sort((a, b) => String(b.queuedAt).localeCompare(String(a.queuedAt)))
        .slice(0, 50),
    };
  }

  getJob(workflowIdOrJobId) {
    if (!workflowIdOrJobId) return null;
    if (this.jobs.has(workflowIdOrJobId)) return publicJob(this.jobs.get(workflowIdOrJobId));
    for (const job of this.jobs.values()) {
      if (job.workflowId === workflowIdOrJobId) return publicJob(job);
    }
    return null;
  }

  hasActiveWorkflow(workflowId) {
    if (!workflowId) return false;
    return Array.from(this.running.values()).some((job) => job.workflowId === workflowId) ||
      this.queue.some((job) => job.workflowId === workflowId);
  }

  async submit(spec = {}, executor) {
    if (typeof executor !== "function") throw new Error("workflow executor is required");
    const workflowId = String(spec.workflowId || "");
    if (!workflowId) throw new Error("workflowId is required");
    if (this.hasActiveWorkflow(workflowId)) {
      throw new Error("该 workflow 已在调度器中排队或运行，请等待当前执行结束后再恢复。");
    }

    const job = {
      jobId: spec.jobId || createJobId(),
      workflowId,
      ownerId: spec.ownerId || "",
      actionKind: spec.actionKind || "manual",
      source: spec.source || "background",
      metadata: safeClone(spec.metadata || {}),
      status: "queued",
      queuedAt: nowIso(),
      executor,
      resolve: null,
      reject: null,
      result: null,
      error: "",
    };
    this.jobs.set(job.jobId, job);
    this.queue.push(job);

    await this.#mark(job, "queued", {
      event: "workflow_queued",
      message: "工作流已进入全局调度队列。",
      severity: "info",
    });

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.#drain();
    return promise;
  }

  async cancel(workflowIdOrJobId, reason = "cancelled") {
    const queuedIndex = this.queue.findIndex((job) => job.jobId === workflowIdOrJobId || job.workflowId === workflowIdOrJobId);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      job.status = "cancelled";
      job.cancelledAt = nowIso();
      await this.#mark(job, "cancelled", {
        event: "workflow_cancelled",
        message: "排队中的工作流已取消。",
        severity: "warning",
        details: { reason },
      });
      job.reject?.(new Error("workflow cancelled before start"));
      return { ok: true, status: "cancelled", workflowId: job.workflowId, jobId: job.jobId };
    }

    for (const job of this.running.values()) {
      if (job.jobId === workflowIdOrJobId || job.workflowId === workflowIdOrJobId) {
        await requestWorkflowCancellation(job.workflowId, reason);
        await this.#mark(job, "cancellation_requested", {
          event: "workflow_cancellation_requested",
          message: "运行中的工作流已收到取消/暂停请求。",
          severity: "warning",
          details: { reason },
        });
        return { ok: true, status: "cancellation_requested", workflowId: job.workflowId, jobId: job.jobId };
      }
    }

    return { ok: false, status: "not_found" };
  }

  #drain() {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || job.status === "cancelled") continue;
      this.#run(job);
    }
  }

  async #run(job) {
    this.running.set(job.jobId, job);
    job.status = "running";
    job.startedAt = nowIso();
    await this.#mark(job, "running", {
      event: "workflow_running",
      message: "工作流已由全局调度器启动。",
      severity: "info",
    });

    try {
      const result = await job.executor({
        jobId: job.jobId,
        workflowId: job.workflowId,
        actionKind: job.actionKind,
        metadata: safeClone(job.metadata || {}),
        get status() {
          return job.status;
        },
        isCancellationRequested: () => job.status === "cancellation_requested",
      });
      job.result = result;
      job.status = "completed";
      job.completedAt = nowIso();
      await this.#mark(job, "completed", {
        event: "workflow_engine_completed",
        message: "工作流已由全局调度器标记完成。",
        severity: "info",
      });
      job.resolve?.(result);
    } catch (err) {
      const paused = /workflow cancellation requested|user_paused|cancelled before start/i.test(String(err.message || ""));
      job.status = paused ? "interrupted" : "failed";
      job.error = err.message || String(err);
      job.failedAt = nowIso();
      await this.#mark(job, job.status, {
        event: paused ? "workflow_engine_interrupted" : "workflow_engine_failed",
        message: paused ? "工作流在调度器中断，断点可恢复。" : `工作流在调度器中失败：${job.error}`,
        severity: paused ? "warning" : "error",
        details: { error: job.error },
      });
      job.reject?.(err);
    } finally {
      this.running.delete(job.jobId);
      this.#drain();
    }
  }

  async #mark(job, status, { event, message, severity = "info", details = {} } = {}) {
    const patch = {
      status,
      engine: {
        jobId: job.jobId,
        actionKind: job.actionKind,
        source: job.source,
        ownerId: job.ownerId,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt || "",
        updatedAt: nowIso(),
      },
    };
    if (job.completedAt) patch.engine.completedAt = job.completedAt;
    if (job.failedAt) patch.engine.failedAt = job.failedAt;
    if (job.cancelledAt) patch.engine.cancelledAt = job.cancelledAt;
    if (job.error) patch.engine.error = job.error;
    try {
      await saveWorkflowSnapshot(job.workflowId, patch);
      await appendWorkflowEvent(job.workflowId, event || status, {
        jobId: job.jobId,
        status,
        actionKind: job.actionKind,
        ...safeClone(details || {}),
      });
      await appendTaskLog({
        workflowId: job.workflowId,
        category: "workflow_engine",
        severity,
        event: event || status,
        message: message || `工作流状态更新：${status}`,
        details: {
          jobId: job.jobId,
          actionKind: job.actionKind,
          ...safeClone(details || {}),
        },
        source: "workflow_engine",
      });
    } catch (err) {
      console.warn("Workflow engine state update failed:", err.message);
    }
  }
}

export const workflowEngine = new WorkflowEngine({ maxConcurrent: 1 });

