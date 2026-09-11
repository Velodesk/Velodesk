/**
 * WorkflowConfigContext v1.2.0 — deskLog diagnóstico
 * VERSION: v1.2.0 | DATE: 2026-07-24
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { workflowApi } from '../api/client';
import { isRateLimitError, RATE_LIMIT_USER_MESSAGE } from '../utils/apiErrors';
import deskLog from '../utils/deskDebugLog';
import { useAuth } from './AuthContext';
import { setWorkflowRuntimeConfig, clearWorkflowRuntimeConfig } from '../services/desk/workflowRuntimeStore';

const EMPTY_CONFIG = { workflows: [] };
const WorkflowConfigContext = createContext(null);

export function WorkflowConfigProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!isAuthenticated) {
      setConfig(EMPTY_CONFIG);
      clearWorkflowRuntimeConfig();
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    deskLog.workflow('WorkflowConfig.reload → início');
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const data = await workflowApi.getActive();
        const next = {
          workflows: data?.workflows || [],
        };
        setConfig(next);
        setWorkflowRuntimeConfig(next);
        deskLog.workflow('WorkflowConfig.reload → ok', {
          workflows: next.workflows.length,
        });
        setLoading(false);
        return;
      } catch (err) {
        const status = err?.response?.status;
        deskLog.error('WORKFLOW', 'WorkflowConfig.reload → falha tentativa', {
          attempt,
          status,
          message: err?.response?.data?.message || err?.message,
        });
        if (isRateLimitError(err)) {
          setError(RATE_LIMIT_USER_MESSAGE);
          setConfig(EMPTY_CONFIG);
          clearWorkflowRuntimeConfig();
          setLoading(false);
          return;
        }
        const isTransient = status === 503 && attempt < maxAttempts;
        if (isTransient) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          continue;
        }
        setError(err?.response?.data?.message || err?.message || 'Falha ao carregar workflows');
        setConfig(EMPTY_CONFIG);
        clearWorkflowRuntimeConfig();
        setLoading(false);
        return;
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({
    workflows: config.workflows,
    loading,
    error,
    reload,
  }), [config, loading, error, reload]);

  return (
    <WorkflowConfigContext.Provider value={value}>
      {children}
    </WorkflowConfigContext.Provider>
  );
}

export function useWorkflowConfig() {
  const ctx = useContext(WorkflowConfigContext);
  if (!ctx) throw new Error('useWorkflowConfig deve ser usado dentro de WorkflowConfigProvider');
  return ctx;
}
