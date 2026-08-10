import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Edit3,
  HardDrive,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../utils/api';

const inputClassName = 'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

const membershipPlans = [
  { value: 'free', label: '免费', quotaLabel: '免费初始额度' },
  { value: 'plus', label: 'Plus', quotaLabel: 'Plus 额度' },
  { value: 'pro', label: 'Pro', quotaLabel: 'Pro 额度' },
];

const defaultUsageSettings = {
  enabled: true,
  planQuotasMb: {
    free: 50,
    plus: 100,
    pro: 500,
  },
};

function hasPlanAgentApiAccess(membershipPlan) {
  return ['plus', 'pro'].includes(String(membershipPlan || 'free').toLowerCase());
}

const emptyAgentApiProfileForm = {
  name: '',
  authType: 'api_key',
  apiKey: '',
  baseUrl: '',
  runtimeModel: '',
  modelPlan: 'all',
  isActive: true,
  isDefault: false,
  priority: 0,
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatUsageBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

function formatUsagePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(parsed >= 10 ? 0 : 1)}%` : '-';
}

function StatusPill({ ok, children }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { logout: logoutUser } = useAuth();
  const [status, setStatus] = useState(null);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('admin-token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requests, setRequests] = useState([]);
  const [membershipRequests, setMembershipRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [systemApiProfiles, setSystemApiProfiles] = useState([]);
  const [systemApiStrategy, setSystemApiStrategy] = useState('default');
  const [systemApiForm, setSystemApiForm] = useState(emptyAgentApiProfileForm);
  const [editingSystemApiProfile, setEditingSystemApiProfile] = useState(null);
  const [mailSettings, setMailSettings] = useState({
    adminEmail: '',
    senderEmail: '',
    resendApiKey: '',
  });
  const [usageSettings, setUsageSettings] = useState(defaultUsageSettings);
  const [usageQuotaDrafts, setUsageQuotaDrafts] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(null);

  const isLoggedIn = Boolean(adminToken);

  const loadStatus = async () => {
    const response = await api.auth.adminStatus();
    const data = await response.json();
    setStatus(data);
    setMailSettings((previous) => ({
      ...previous,
      adminEmail: data.mailSettings?.adminEmail || '',
      senderEmail: data.mailSettings?.senderEmail || '',
      resendApiKey: '',
    }));
    setUsageSettings(data.usageQuotaSettings || defaultUsageSettings);
  };

  const handleAdminAuthFailure = () => {
    localStorage.removeItem('admin-token');
    setAdminToken('');
    setRequests([]);
    setMembershipRequests([]);
    setUsers([]);
    setSystemApiProfiles([]);
    setUsageQuotaDrafts({});
  };

  const loadRequests = async (token = adminToken) => {
    if (!token) return;
    const response = await api.auth.adminRegistrationRequests(token, 'pending');
    const data = await response.json();
    if (!response.ok) {
      handleAdminAuthFailure();
      throw new Error(data.error || 'Failed to load requests');
    }
    setRequests(data.requests || []);
  };

  const loadUsers = async (token = adminToken) => {
    if (!token) return;
    const response = await api.auth.adminUsers(token);
    const data = await response.json();
    if (!response.ok) {
      handleAdminAuthFailure();
      throw new Error(data.error || 'Failed to load users');
    }
    setUsers(data.users || []);
    setUsageQuotaDrafts((previous) => {
      const next = { ...previous };
      (data.users || []).forEach((user) => {
        if (!Object.prototype.hasOwnProperty.call(next, user.id)) {
          next[user.id] = user.usageQuotaOverrideMb == null ? '' : String(user.usageQuotaOverrideMb);
        }
      });
      return next;
    });
  };

  const loadMembershipRequests = async (token = adminToken) => {
    if (!token) return;
    const response = await api.auth.adminMembershipUpgradeRequests(token, 'pending');
    const data = await response.json();
    if (!response.ok) {
      handleAdminAuthFailure();
      throw new Error(data.error || 'Failed to load membership requests');
    }
    setMembershipRequests(data.requests || []);
  };

  const loadSystemApiProfiles = async (token = adminToken) => {
    if (!token) return;
    const response = await api.auth.adminAgentApiProfiles(token);
    const data = await response.json();
    if (!response.ok) {
      handleAdminAuthFailure();
      throw new Error(data.error || 'Failed to load system API profiles');
    }
    setSystemApiProfiles(data.profiles || []);
    setSystemApiStrategy(data.strategy || 'default');
  };

  const loadAdminData = async (token = adminToken) => {
    if (!token) return;
    await Promise.all([
      loadRequests(token),
      loadMembershipRequests(token),
      loadUsers(token),
      loadSystemApiProfiles(token),
    ]);
  };

  useEffect(() => {
    loadStatus().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (adminToken) {
      loadAdminData(adminToken).catch((err) => setError(err.message));
    }
  }, [adminToken]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.adminLogin(username.trim(), password);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Admin login failed');
      }
      localStorage.setItem('admin-token', data.token);
      setAdminToken(data.token);
      setPassword('');
      setMessage('管理员已登录。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reviewRequest = async (id, action) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = action === 'approve'
        ? await api.auth.approveRegistrationRequest(adminToken, id)
        : await api.auth.rejectRegistrationRequest(adminToken, id, 'Rejected in admin panel');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} request`);
      }
      setMessage(action === 'approve' ? '已通过注册申请。' : '已拒绝注册申请。');
      await loadStatus();
      await loadAdminData();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('admin-token');
    setAdminToken('');
    setRequests([]);
    setMembershipRequests([]);
    setUsers([]);
    setSystemApiProfiles([]);
    setUsageQuotaDrafts({});
    setDeleteDialog(null);
    setMessage('');
    setError('');
  };

  const goToInitialLogin = () => {
    logout();
    logoutUser();
    navigate('/', { replace: true });
  };

  const saveMailSettings = async (event) => {
    event.preventDefault();
    if (!adminToken) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminMailSettings(adminToken, mailSettings);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save mail settings');
      }
      setMessage('邮件系统设置已保存。');
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveUsageSettings = async (event) => {
    event.preventDefault();
    if (!adminToken) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminUsageSettings(adminToken, usageSettings);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save usage settings');
      }
      setUsageSettings(data.settings || usageSettings);
      await loadUsers();
      setMessage('用量额度设置已保存。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetSystemApiForm = () => {
    setSystemApiForm(emptyAgentApiProfileForm);
    setEditingSystemApiProfile(null);
  };

  const startEditSystemApiProfile = (profile) => {
    setEditingSystemApiProfile(profile);
    setSystemApiForm({
      name: profile.name || '',
      authType: profile.authType || 'api_key',
      apiKey: '',
      baseUrl: profile.baseUrl || '',
      runtimeModel: profile.runtimeModel || '',
      modelPlan: profile.modelPlan || 'all',
      isActive: profile.isActive !== false,
      isDefault: profile.isDefault === true,
      priority: profile.priority || 0,
    });
  };

  const saveSystemApiProfile = async (event) => {
    event.preventDefault();
    if (!adminToken) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        ...systemApiForm,
        provider: 'anthropic',
        priority: Number(systemApiForm.priority) || 0,
      };
      if (!payload.apiKey) {
        delete payload.apiKey;
      }
      const response = editingSystemApiProfile
        ? await api.auth.updateAdminAgentApiProfile(adminToken, editingSystemApiProfile.id, payload)
        : await api.auth.createAdminAgentApiProfile(adminToken, payload);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save system API profile');
      }
      resetSystemApiForm();
      await loadSystemApiProfiles();
      setMessage('系统 API Profile 已保存。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSystemApiProfile = async (profile, patch) => {
    if (!adminToken || !profile) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminAgentApiProfile(adminToken, profile.id, patch);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update system API profile');
      }
      await loadSystemApiProfiles();
      setMessage('系统 API Profile 已更新。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteSystemApiProfile = async (profile) => {
    if (!adminToken || !profile) return;
    if (!window.confirm(`确定删除系统 API Profile「${profile.name}」吗？`)) {
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.deleteAdminAgentApiProfile(adminToken, profile.id);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete system API profile');
      }
      await loadSystemApiProfiles();
      setMessage('系统 API Profile 已删除。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateSystemApiStrategy = async (strategy) => {
    if (!adminToken || strategy === systemApiStrategy) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminAgentApiStrategy(adminToken, strategy);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update API strategy');
      }
      setSystemApiStrategy(data.strategy || strategy);
      setMessage('系统 API 自动切换策略已保存。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateMembership = async (user, membershipPlan) => {
    if (!adminToken || !user || membershipPlan === user.membershipPlan) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminUserMembership(adminToken, user.id, membershipPlan);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update membership');
      }
      setUsers((previous) => previous.map((entry) => (
        entry.id === user.id ? data.user : entry
      )));
      await loadMembershipRequests();
      setMessage(`已将 ${user.username} 调整为 ${membershipPlan.toUpperCase()}。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateUserUsageQuota = async (user) => {
    if (!adminToken || !user) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const rawDraft = usageQuotaDrafts[user.id] ?? '';
      const usageQuotaMb = String(rawDraft).trim() === '' ? null : Number(rawDraft);
      const response = await api.auth.updateAdminUserUsageQuota(adminToken, user.id, usageQuotaMb);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update usage quota');
      }
      setUsers((previous) => previous.map((entry) => (
        entry.id === user.id ? data.user : entry
      )));
      setUsageQuotaDrafts((previous) => ({
        ...previous,
        [user.id]: data.user?.usageQuotaOverrideMb == null ? '' : String(data.user.usageQuotaOverrideMb),
      }));
      setMessage(`已更新 ${user.username} 的用量额度。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetUserUsage = async (user) => {
    if (!adminToken || !user) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.resetAdminUserUsage(adminToken, user.id);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset usage');
      }
      setUsers((previous) => previous.map((entry) => (
        entry.id === user.id ? data.user : entry
      )));
      setMessage(`已将 ${user.username} 当前用量清零；现有文件作为基线，不会删除。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateAgentApiAccess = async (user, enabled) => {
    if (!adminToken || !user || enabled === Boolean(user.agentApiOverrideEnabled)) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.updateAdminUserAgentApiAccess(adminToken, user.id, enabled);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update API access');
      }
      setUsers((previous) => previous.map((entry) => (
        entry.id === user.id ? data.user : entry
      )));
      setMessage(enabled
        ? `已为 ${user.username} 开通个人 API 覆盖。`
        : `已关闭 ${user.username} 的个人 API 覆盖。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const reviewMembershipRequest = async (request, action) => {
    if (!adminToken || !request) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = action === 'approve'
        ? await api.auth.approveMembershipUpgradeRequest(adminToken, request.id)
        : await api.auth.rejectMembershipUpgradeRequest(adminToken, request.id, 'Rejected in admin panel');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Failed to ${action} membership request`);
      }
      setMembershipRequests((previous) => previous.filter((entry) => entry.id !== request.id));
      if (data.user) {
        setUsers((previous) => previous.map((entry) => (
          entry.id === data.user.id ? data.user : entry
        )));
      } else {
        await loadUsers();
      }
      setMessage(action === 'approve'
        ? `已将 ${request.username} 升级为 ${String(request.requested_plan || '').toUpperCase()}。`
        : '已拒绝会员升级申请。');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!adminToken || !deleteDialog?.user) return;

    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await api.auth.deleteAdminUser(adminToken, deleteDialog.user.id, {
        confirmUsername: deleteDialog.confirmUsername,
        deleteFiles: deleteDialog.deleteFiles,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }
      const skippedCount = data.fileDeletion?.skipped?.length || 0;
      setMessage(
        deleteDialog.deleteFiles
          ? `已删除账号 ${deleteDialog.user.username}。项目文件已删除 ${data.fileDeletion?.deleted?.length || 0} 个，跳过 ${skippedCount} 个。`
          : `已删除账号 ${deleteDialog.user.username}，项目文件已保留。`,
      );
      setDeleteDialog(null);
      await loadStatus();
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderAgentApiAccessCell = (user) => {
    if (hasPlanAgentApiAccess(user.membershipPlan)) {
      return (
        <span className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          会员自动
        </span>
      );
    }

    return (
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(user.agentApiOverrideEnabled)}
          disabled={loading}
          onChange={(event) => updateAgentApiAccess(user, event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-60"
        />
        <span className="whitespace-nowrap">
          {user.agentApiOverrideEnabled ? '已授权' : '未授权'}
        </span>
      </label>
    );
  };

  const renderUsageCell = (user) => {
    const usage = user.usage || {};
    const percent = Math.min(100, Math.max(0, Number(usage.usagePercent ?? user.usagePercent ?? 0) || 0));
    const isExceeded = Boolean(usage.isUsageExceeded ?? user.isUsageExceeded);

    return (
      <div className="min-w-[180px] space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-700">
            {formatUsageBytes(usage.usedBytes ?? user.usageUsedBytes)}
          </span>
          <span className={isExceeded ? 'font-semibold text-red-600' : 'text-slate-500'}>
            {formatUsagePercent(percent)}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className={`h-2 rounded-full ${isExceeded ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-slate-500">
          <span>额度 {formatUsageBytes(usage.quotaBytes ?? user.usageQuotaBytes)}</span>
          <span>余量 {formatUsageBytes(usage.remainingBytes ?? user.usageRemainingBytes)}</span>
          {(usage.baselineBytes ?? user.usageBaselineBytes) > 0 && (
            <span title={usage.baselineUpdatedAt || user.usageBaselineUpdatedAt || ''}>
              基线 {formatUsageBytes(usage.baselineBytes ?? user.usageBaselineBytes)}
            </span>
          )}
          {usage.quotaOverrideBytes != null && <span className="font-medium text-emerald-700">单独设置</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">MedHelp 管理后台</h1>
              <p className="text-sm text-slate-500">注册审核、会员、用量额度与邮件系统</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={goToInitialLogin}
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              返回登录页
            </button>
            {isLoggedIn && (
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" />
                退出管理员
              </button>
            )}
          </div>
        </div>
      </header>

      {!isLoggedIn ? (
        <main className="mx-auto flex max-w-[1500px] justify-center px-6 py-10">
          <form onSubmit={handleLogin} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-600 text-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">管理员登录</h2>
                <p className="mt-1 text-sm text-slate-500">请输入管理员凭据。</p>
              </div>
            </div>

            {(message || error) && (
              <div className="mt-4 space-y-2">
                {message && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div>}
                {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
              </div>
            )}

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">管理员账号</label>
                <input
                  className={inputClassName}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="请输入管理员账号"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">密码</label>
                <input
                  className={inputClassName}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="h-10 w-full rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                登录管理后台
              </button>
            </div>
          </form>
        </main>
      ) : (
        <main className="mx-auto grid max-w-[1500px] gap-6 px-6 py-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <section className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold">后台状态</h2>
              <div className="mt-4 space-y-3">
                <div className="rounded-md bg-emerald-50 p-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-100">
                  当前管理员已登录
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-600">注册审核</span>
                  <StatusPill ok={Boolean(status?.registrationReviewEnabled)}>
                    {status?.registrationReviewEnabled ? '已开启' : '未开启'}
                  </StatusPill>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-600">邮件提醒</span>
                  <StatusPill ok={Boolean(status?.mailConfigured)}>
                    {status?.mailConfigured ? '已配置' : '未配置'}
                  </StatusPill>
                </div>
                <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  当前用户数：{status?.activeUsers ?? '-'} / {status?.maxUsers || '不限'}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-600">用量计费</span>
                  <StatusPill ok={usageSettings.enabled !== false}>
                    {usageSettings.enabled !== false ? '已开启' : '已关闭'}
                  </StatusPill>
                </div>
              </div>
            </div>

            <form onSubmit={saveUsageSettings} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-emerald-600" />
                <h2 className="text-base font-semibold">用量额度</h2>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                按用户项目存储占用计算用量。会员档位使用默认额度，单个用户可在右侧覆盖。
              </p>
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={usageSettings.enabled !== false}
                    onChange={(event) => setUsageSettings((previous) => ({ ...previous, enabled: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  启用用量限制
                </label>
                {membershipPlans.map((plan) => (
                  <div key={plan.value}>
                    <label className="mb-1 block text-sm font-medium text-slate-700">{plan.quotaLabel}（MB）</label>
                    <input
                      className={inputClassName}
                      type="number"
                      min="0"
                      step="1"
                      value={usageSettings.planQuotasMb?.[plan.value] ?? defaultUsageSettings.planQuotasMb[plan.value]}
                      onChange={(event) => setUsageSettings((previous) => ({
                        ...previous,
                        planQuotasMb: {
                          ...(previous.planQuotasMb || defaultUsageSettings.planQuotasMb),
                          [plan.value]: event.target.value,
                        },
                      }))}
                    />
                  </div>
                ))}
                <button
                  type="submit"
                  disabled={loading}
                  className="h-10 w-full rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  保存用量额度
                </button>
              </div>
            </form>

            <form onSubmit={saveMailSettings} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Mail className="h-4 w-4 text-emerald-600" />
                <h2 className="text-base font-semibold">邮件系统</h2>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                邮件提醒使用 Resend。未配置邮件时，申请仍会进入右侧待审核列表。
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">审核通知邮箱</label>
                  <input
                    className={inputClassName}
                    type="email"
                    value={mailSettings.adminEmail}
                    onChange={(event) => setMailSettings((previous) => ({ ...previous, adminEmail: event.target.value }))}
                    disabled={status?.mailSettings?.adminEmailLockedByEnv}
                    placeholder="admin@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">发件邮箱</label>
                  <input
                    className={inputClassName}
                    value={mailSettings.senderEmail}
                    onChange={(event) => setMailSettings((previous) => ({ ...previous, senderEmail: event.target.value }))}
                    disabled={status?.mailSettings?.senderEmailLockedByEnv}
                    placeholder="MedHelp <noreply@example.com>"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Resend API Key</label>
                  <input
                    className={inputClassName}
                    type="password"
                    value={mailSettings.resendApiKey}
                    onChange={(event) => setMailSettings((previous) => ({ ...previous, resendApiKey: event.target.value }))}
                    disabled={status?.mailSettings?.resendApiKeyLockedByEnv}
                    placeholder={status?.mailSettings?.hasResendApiKey ? '已保存，留空不修改' : 're_xxxxxxxxxxxxxxxxxxxxx'}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-10 w-full rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  保存邮件设置
                </button>
              </div>
            </form>

            <form onSubmit={saveSystemApiProfile} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-base font-semibold">系统 API Profile</h2>
                </div>
                {editingSystemApiProfile && (
                  <button
                    type="button"
                    onClick={resetSystemApiForm}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    取消编辑
                  </button>
                )}
              </div>
              <p className="text-sm leading-6 text-slate-600">
                这里配置平台自有 API 池。用户未选择个人 API 时，会按下方自动策略使用系统 API。
              </p>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">名称</label>
                  <input
                    className={inputClassName}
                    value={systemApiForm.name}
                    onChange={(event) => setSystemApiForm((previous) => ({ ...previous, name: event.target.value }))}
                    placeholder="Pro 主 Key"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">认证类型</label>
                  <select
                    className={inputClassName}
                    value={systemApiForm.authType}
                    onChange={(event) => setSystemApiForm((previous) => ({ ...previous, authType: event.target.value }))}
                  >
                    <option value="api_key">ANTHROPIC_API_KEY</option>
                    <option value="auth_token">ANTHROPIC_AUTH_TOKEN</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">密钥</label>
                  <input
                    className={inputClassName}
                    type="password"
                    value={systemApiForm.apiKey}
                    onChange={(event) => setSystemApiForm((previous) => ({ ...previous, apiKey: event.target.value }))}
                    placeholder={editingSystemApiProfile?.hasSecret ? '已保存，留空不修改' : 'sk-ant-...'}
                    required={!editingSystemApiProfile}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Base URL</label>
                  <input
                    className={inputClassName}
                    value={systemApiForm.baseUrl}
                    onChange={(event) => setSystemApiForm((previous) => ({ ...previous, baseUrl: event.target.value }))}
                    placeholder="https://api.anthropic.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">运行模型</label>
                    <input
                      className={inputClassName}
                      value={systemApiForm.runtimeModel}
                      onChange={(event) => setSystemApiForm((previous) => ({ ...previous, runtimeModel: event.target.value }))}
                      placeholder="claude-sonnet-4-5"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">适用等级</label>
                    <select
                      className={inputClassName}
                      value={systemApiForm.modelPlan}
                      onChange={(event) => setSystemApiForm((previous) => ({ ...previous, modelPlan: event.target.value }))}
                    >
                      <option value="all">全部</option>
                      <option value="free">Free</option>
                      <option value="plus">Plus</option>
                      <option value="pro">Pro</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={systemApiForm.isActive}
                      onChange={(event) => setSystemApiForm((previous) => ({ ...previous, isActive: event.target.checked }))}
                    />
                    启用
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={systemApiForm.isDefault}
                      onChange={(event) => setSystemApiForm((previous) => ({ ...previous, isDefault: event.target.checked }))}
                    />
                    默认
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-10 w-full rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {editingSystemApiProfile ? '更新系统 API' : '新增系统 API'}
                </button>
              </div>
            </form>
          </section>

          <section className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold">待审核注册申请</h2>
                  <p className="mt-1 text-sm text-slate-500">通过后会立即创建普通用户账号。</p>
                </div>
                <button
                  type="button"
                  onClick={() => loadAdminData().catch((err) => setError(err.message))}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>

              {(message || error) && (
                <div className="space-y-2 border-b border-slate-200 px-5 py-3">
                  {message && <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div>}
                  {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                </div>
              )}

              {requests.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">暂无待审核注册申请。</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {requests.map((request) => (
                    <div key={request.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-950">{request.username}</h3>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{request.notification_email}</span>
                        </div>
                        <div className="mt-2 grid gap-1 text-sm text-slate-500">
                          <span>申请时间：{formatDate(request.requested_at)}</span>
                          {request.request_ip && <span>IP：{request.request_ip}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => reviewRequest(request.id, 'approve')}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <UserCheck className="h-4 w-4" />
                          通过
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => reviewRequest(request.id, 'reject')}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                        >
                          <UserX className="h-4 w-4" />
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold">会员升级申请</h2>
                  <p className="mt-1 text-sm text-slate-500">用户点击 Plus 或 Pro 后会出现在这里，管理员通过后立即生效。</p>
                </div>
                <button
                  type="button"
                  onClick={() => loadMembershipRequests().catch((err) => setError(err.message))}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>

              {membershipRequests.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">暂无会员升级申请。</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {membershipRequests.map((request) => (
                    <div key={request.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-950">{request.username}</h3>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            当前 {String(request.current_membership_plan || request.current_plan || 'free').toUpperCase()}
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            申请 {String(request.requested_plan || '').toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1 text-sm text-slate-500">
                          <span>申请时间：{formatDate(request.requested_at)}</span>
                          {request.notification_email && <span>邮箱：{request.notification_email}</span>}
                          {request.request_ip && <span>IP：{request.request_ip}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => reviewMembershipRequest(request, 'approve')}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <UserCheck className="h-4 w-4" />
                          通过
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => reviewMembershipRequest(request, 'reject')}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                        >
                          <UserX className="h-4 w-4" />
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <ServerCog className="h-4 w-4 text-emerald-600" />
                  <div>
                    <h2 className="text-base font-semibold">系统 API 池</h2>
                    <p className="mt-1 text-sm text-slate-500">供未选择个人 API 的用户使用，可设置默认或轮询自动切换。</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-slate-500" />
                  <select
                    value={systemApiStrategy}
                    disabled={loading}
                    onChange={(event) => updateSystemApiStrategy(event.target.value)}
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="default">默认优先</option>
                    <option value="round_robin">轮询切换</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => loadSystemApiProfiles().catch((err) => setError(err.message))}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                    刷新
                  </button>
                </div>
              </div>

              {systemApiProfiles.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">还没有系统 API Profile。</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[980px] divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                      <tr>
                        <th className="w-[190px] px-3 py-3">名称</th>
                        <th className="w-[110px] px-3 py-3">等级</th>
                        <th className="w-[180px] px-3 py-3">密钥</th>
                        <th className="px-3 py-3">Base URL / 模型</th>
                        <th className="w-[90px] px-3 py-3">状态</th>
                        <th className="w-[220px] px-3 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {systemApiProfiles.map((profile) => (
                        <tr key={profile.id} className="align-top">
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-950">{profile.name}</div>
                            {profile.isDefault && (
                              <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                                默认
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 font-medium uppercase text-slate-700">{profile.modelPlan || 'all'}</td>
                          <td className="px-3 py-3 font-mono text-xs text-slate-600">
                            {profile.hasSecret ? `•••• ${profile.secretLast4 || 'set'}` : '未设置'}
                          </td>
                          <td className="px-3 py-3">
                            <div className="max-w-[360px] truncate text-slate-700" title={profile.baseUrl || '官方默认'}>
                              {profile.baseUrl || '官方默认'}
                            </div>
                            <div className="mt-1 max-w-[360px] truncate text-xs text-slate-500" title={profile.runtimeModel || '跟随等级映射'}>
                              {profile.runtimeModel || '跟随等级映射'}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <StatusPill ok={profile.isActive}>
                              {profile.isActive ? '启用' : '停用'}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => startEditSystemApiProfile(profile)}
                                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                              >
                                <Edit3 className="h-3 w-3" />
                                编辑
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => toggleSystemApiProfile(profile, { isActive: !profile.isActive })}
                                className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                              >
                                {profile.isActive ? '停用' : '启用'}
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => toggleSystemApiProfile(profile, { isDefault: !profile.isDefault })}
                                className="inline-flex h-7 items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {profile.isDefault ? '取消默认' : '设默认'}
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => deleteSystemApiProfile(profile)}
                                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                              >
                                <Trash2 className="h-3 w-3" />
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
                  <Users className="h-4 w-4 text-emerald-600" />
                  <div>
                    <h2 className="text-base font-semibold">用户与会员</h2>
                    <p className="mt-1 text-sm text-slate-500">管理账号、会员等级、用量额度和账号删除。</p>
                  </div>
                </div>

              {users.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">暂无用户。</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1220px] divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                      <tr>
                        <th className="w-[190px] px-3 py-3">用户</th>
                        <th className="w-[96px] px-3 py-3">会员</th>
                        <th className="w-[220px] px-3 py-3">用量</th>
                        <th className="w-[110px] px-3 py-3">API 覆盖</th>
                        <th className="w-[56px] px-3 py-3 text-center">项目</th>
                        <th className="w-[76px] px-3 py-3">状态</th>
                        <th className="w-[150px] px-3 py-3">最近登录</th>
                        <th className="w-[280px] px-3 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {users.map((user) => (
                        <tr key={user.id} className="align-top">
                          <td className="px-3 py-3">
                            <div className="max-w-[170px] truncate font-semibold leading-5 text-slate-950" title={user.username}>
                              {user.username}
                            </div>
                            <div className="mt-1 max-w-[170px] truncate text-xs leading-5 text-slate-500" title={user.notificationEmail || '未填写邮箱'}>
                              {user.notificationEmail || '未填写邮箱'}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <select
                              value={user.membershipPlan || 'free'}
                              disabled={loading}
                              onChange={(event) => updateMembership(user, event.target.value)}
                              className="h-8 w-20 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                            >
                              {membershipPlans.map((plan) => (
                                <option key={plan.value} value={plan.value}>{plan.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            {renderUsageCell(user)}
                          </td>
                          <td className="px-3 py-3">
                            {renderAgentApiAccessCell(user)}
                          </td>
                          <td className="px-3 py-3 text-center font-medium tabular-nums text-slate-700">{user.projectCount || 0}</td>
                          <td className="px-3 py-3">
                            <StatusPill ok={user.isActive}>
                              {user.isActive ? '启用' : '停用'}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-slate-500">{formatDate(user.lastLogin)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col items-start gap-1 text-sm">
                              <div className="flex flex-wrap items-center justify-start gap-1.5">
                                <input
                                  className="h-7 w-24 rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={usageQuotaDrafts[user.id] ?? ''}
                                  onChange={(event) => setUsageQuotaDrafts((previous) => ({
                                    ...previous,
                                    [user.id]: event.target.value,
                                  }))}
                                  placeholder={String(user.usage?.planQuotaMb ?? user.usageQuotaMb ?? '')}
                                  title="留空则跟随会员档位"
                                />
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => updateUserUsageQuota(user)}
                                  className="inline-flex h-7 items-center whitespace-nowrap rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  设置 MB
                                </button>
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => resetUserUsage(user)}
                                  className="inline-flex h-7 items-center whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                                >
                                  清零用量
                                </button>
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => setDeleteDialog({ user, confirmUsername: '', deleteFiles: false })}
                                  className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  删除
                                </button>
                              </div>
                              <div className="max-w-[270px] text-[10px] leading-4 text-slate-500">
                                留空使用会员档位额度；填写数字可覆盖为个人 MB 额度。
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">删除用户账号</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  这会删除用户账号和数据库中的项目记录。项目文件默认保留；只有勾选下方选项时才会尝试删除该用户项目文件。
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              用户：<span className="font-semibold text-slate-950">{deleteDialog.user.username}</span>
              <span className="ml-3 text-slate-500">项目数：{deleteDialog.user.projectCount || 0}</span>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  输入用户名确认删除
                </label>
                <input
                  className={inputClassName}
                  value={deleteDialog.confirmUsername}
                  onChange={(event) => setDeleteDialog((previous) => ({ ...previous, confirmUsername: event.target.value }))}
                  placeholder={deleteDialog.user.username}
                />
              </div>

              <label className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                  checked={deleteDialog.deleteFiles}
                  onChange={(event) => setDeleteDialog((previous) => ({ ...previous, deleteFiles: event.target.checked }))}
                />
                <span>同时删除该用户项目文件。此操作只会删除系统确认属于该用户且带有工作区标记的目录。</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={loading || deleteDialog.confirmUsername !== deleteDialog.user.username}
                onClick={confirmDeleteUser}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
