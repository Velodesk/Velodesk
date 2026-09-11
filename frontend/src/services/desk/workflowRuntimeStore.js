/**
 * workflowRuntimeStore v1.0.0 — cache runtime de definições persistidas
 * VERSION: v1.0.0 | DATE: 2026-07-14
 */
let workflows = [];

export function setWorkflowRuntimeConfig(next = {}) {
  workflows = next.workflows || [];
}

export function getRuntimeWorkflows() {
  return workflows;
}

export function clearWorkflowRuntimeConfig() {
  workflows = [];
}
