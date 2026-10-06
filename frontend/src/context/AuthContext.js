/**
 * AuthContext v1.8.4 — aquece índice de exibição do responsável na sessão
 * VERSION: v1.8.4 | DATE: 2026-08-20
 */
import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { isGoogleDeskAuthMode, isGoogleDeskSession } from '../config/deskAuthMode';
import { isLocalDevBypass } from '../config/devAuth';
import { isHubSessionActive, readHubSession } from '../config/hubSession';
import { setApiMode } from '../services/ticketsCache';
import { getDeskDisplayName, resolveAgentDisplayName, isLegacyDeskUser } from '../utils/userDisplayName';
import { clearDeskAuthSession, isBackendJwtUsable } from '../utils/backendJwt';
import { clearCachedPermissions } from '../services/permissions/permissionService';
import { notifyAgentOfflineAndStop } from '../services/agentPresence';
import { authApi } from '../api/client';
import { setResponsavelDisplayColaboradores } from '../services/desk/responsavelDisplay';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem('velodesk_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readStoredColaborador() {
  try {
    const raw = localStorage.getItem('velodesk_colaborador');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearStoredAuthSession() {
  clearDeskAuthSession();
  clearCachedPermissions();
}

function colaboradorHasDeskAccess(colaborador) {
  if (!colaborador || typeof colaborador !== 'object') return false;
  if (colaborador.desligado === true || colaborador.afastado === true) return false;
  return colaborador.acessos?.Desk === true || colaborador.acessos?.desk === true;
}

function readInitialAuth() {
  const gateOk = localStorage.getItem('velodesk_gate_authorized') === '1';
  const user = readStoredUser();
  const token = localStorage.getItem('velodesk_token');
  const session = readHubSession();
  const colaborador = readStoredColaborador();

  if (gateOk && user) {
    if (isLegacyDeskUser(user)) {
      clearStoredAuthSession();
      return { authStatus: 'pending', user: null, colaborador: null, token: null };
    }

    if (isGoogleDeskSession(user) || user.source === 'cadastro-desk') {
      if (!isBackendJwtUsable(token) || !colaboradorHasDeskAccess(colaborador)) {
        clearStoredAuthSession();
        return { authStatus: 'pending', user: null, colaborador: null, token: null };
      }
      const displayName = getDeskDisplayName(user, colaborador);
      const normalizedUser = { ...user, name: displayName };
      return {
        authStatus: 'authorized',
        user: normalizedUser,
        colaborador,
        token,
      };
    }

    // Modo Google: não aceita sessão legada sem cadastro Desk
    if (isGoogleDeskAuthMode()) {
      clearStoredAuthSession();
      return { authStatus: 'pending', user: null, colaborador: null, token: null };
    }

    if (!isLocalDevBypass() && session && !isHubSessionActive(session)) {
      return { authStatus: 'pending', user: null, colaborador: null, token: null };
    }

    if (!isBackendJwtUsable(token)) {
      clearStoredAuthSession();
      return { authStatus: 'pending', user: null, colaborador: null, token: null };
    }

    return {
      authStatus: 'authorized',
      user,
      colaborador,
      token,
    };
  }

  return { authStatus: 'pending', user: null, colaborador: null, token: null };
}

export function AuthProvider({ children }) {
  const [initial] = useState(readInitialAuth);
  const [authStatus, setAuthStatus] = useState(initial.authStatus);
  const [user, setUser] = useState(initial.user);
  const [colaborador, setColaborador] = useState(initial.colaborador);
  const [token, setToken] = useState(initial.token);

  useEffect(() => {
    if (initial.authStatus === 'authorized') {
      setResponsavelDisplayColaboradores([]);
    }
  }, [initial.authStatus]);

  const bootstrapFromGate = useCallback(async (result) => {
    setUser(result.user);
    setColaborador(result.colaborador || null);
    localStorage.setItem('velodesk_user', JSON.stringify(result.user));
    if (result.colaborador) {
      localStorage.setItem('velodesk_colaborador', JSON.stringify(result.colaborador));
    }
    setResponsavelDisplayColaboradores([]);
    localStorage.setItem('velodesk_gate_authorized', '1');
    localStorage.setItem('velodesk_auth_mode', 'velohub');
    setApiMode(true);
    setAuthStatus('authorized');
  }, []);

  const bootstrapFromGoogleLogin = useCallback(async (result) => {
    const colaboradorPayload = result.colaborador || null;
    const displayName = resolveAgentDisplayName({
      aliasColaborador: colaboradorPayload?.aliasColaborador,
      colaboradorNome: colaboradorPayload?.colaboradorNome,
    });
    const enrichedUser = {
      ...result.user,
      name: displayName,
      aliasColaborador: colaboradorPayload?.aliasColaborador || '',
      colaboradorNome: colaboradorPayload?.colaboradorNome || '',
      source: result.user?.source || 'google-desk',
    };
    setUser(enrichedUser);
    setColaborador(colaboradorPayload);
    setToken(result.token);
    localStorage.setItem('velodesk_user', JSON.stringify(enrichedUser));
    if (colaboradorPayload) {
      localStorage.setItem('velodesk_colaborador', JSON.stringify(colaboradorPayload));
      localStorage.setItem('velodesk_colaborador_meta', JSON.stringify({
        atuacao: colaboradorPayload.atuacao || [],
        departamento: colaboradorPayload.departamento || '',
      }));
    } else {
      localStorage.removeItem('velodesk_colaborador');
    }
    localStorage.setItem('velodesk_token', result.token);
    localStorage.setItem('velodesk_gate_authorized', '1');
    localStorage.setItem(
      'velodesk_auth_mode',
      enrichedUser.source === 'cadastro-desk' ? 'cadastro-desk' : 'google',
    );
    setApiMode(true);
    setAuthStatus('authorized');
    setResponsavelDisplayColaboradores([]);
  }, []);

  const logout = useCallback((redirectQuery = '') => {
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch {
      /* noop */
    }
    void authApi.logout();
    void notifyAgentOfflineAndStop();
    clearStoredAuthSession();
    setAuthStatus('pending');
    setUser(null);
    setColaborador(null);
    setToken(null);
    window.location.href = redirectQuery ? `/login?${redirectQuery}` : '/login';
  }, []);

  // Gestor forçou o logoff desta sessão pelo painel de gestão (ver agentPresence.js →
  // POST /agents/presence/heartbeat, campo forceLogoff). Não chama authApi.logout() aqui: o
  // backend já marcou a sessão offline ao setar o pedido — só precisamos encerrar localmente.
  useEffect(() => {
    function onForceLogoff() {
      try {
        window.google?.accounts?.id?.disableAutoSelect?.();
      } catch {
        /* noop */
      }
      void notifyAgentOfflineAndStop();
      clearStoredAuthSession();
      setAuthStatus('pending');
      setUser(null);
      setColaborador(null);
      setToken(null);
      window.location.href = '/login?session=force-logoff';
    }
    window.addEventListener('velodesk:force-logoff', onForceLogoff);
    return () => window.removeEventListener('velodesk:force-logoff', onForceLogoff);
  }, []);

  const updateUser = useCallback((partial) => {
    setUser((prev) => {
      const base = prev || { id: 'local', name: '', email: '' };
      const colaborador = readStoredColaborador();
      const next = { ...base, ...partial };
      if (!partial?.name) {
        next.name = getDeskDisplayName(next, colaborador);
      }
      localStorage.setItem('velodesk_user', JSON.stringify(next));
      return next;
    });
  }, []);

  const clearGateSession = useCallback(() => {
    clearStoredAuthSession();
    setAuthStatus('pending');
    setUser(null);
    setColaborador(null);
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      colaborador,
      token,
      authStatus,
      bootstrapFromGate,
      bootstrapFromGoogleLogin,
      logout,
      updateUser,
      clearGateSession,
      isAuthenticated: authStatus === 'authorized',
    }),
    [
      user,
      colaborador,
      token,
      authStatus,
      bootstrapFromGate,
      bootstrapFromGoogleLogin,
      logout,
      updateUser,
      clearGateSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora de AuthProvider');
  return ctx;
}
