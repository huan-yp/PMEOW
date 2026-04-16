import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AutoAddUnassignedPersonsReport, AutoAddUnassignedPersonsReportItem, PersonBindingCandidate } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';

type WizardMode = 'seed-user' | 'manual';
type WizardStep = 'entry' | 'seed' | 'profile' | 'bindings' | 'review' | 'auto-result';

type ProfileFormState = {
  displayName: string;
  email: string;
  qq: string;
  note: string;
};

const EMPTY_FORM: ProfileFormState = {
  displayName: '',
  email: '',
  qq: '',
  note: '',
};

const SEED_PAGE_SIZE = 8;
const AUTO_RESULT_PAGE_SIZE = 8;

function getCandidateKey(candidate: Pick<PersonBindingCandidate, 'serverId' | 'systemUser'>): string {
  return `${candidate.serverId}::${candidate.systemUser}`;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      dp[leftIndex][rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? dp[leftIndex - 1][rightIndex - 1] + 1
        : Math.max(dp[leftIndex - 1][rightIndex], dp[leftIndex][rightIndex - 1]);
    }
  }

  return dp[left.length][right.length];
}

function getSuggestionScore(seedUser: string, candidateUser: string): number {
  const normalizedSeed = normalizeUsername(seedUser);
  const normalizedCandidate = normalizeUsername(candidateUser);

  if (!normalizedSeed || !normalizedCandidate) {
    return 0;
  }

  if (normalizedSeed === normalizedCandidate) {
    return 100;
  }

  if (normalizedSeed.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedSeed)) {
    return 80;
  }

  const subsequenceLength = longestCommonSubsequenceLength(normalizedSeed, normalizedCandidate);
  const threshold = Math.max(3, Math.floor(Math.min(normalizedSeed.length, normalizedCandidate.length) * 0.6));
  return subsequenceLength >= threshold ? 60 : 0;
}

function formatCandidateLabel(candidate: Pick<PersonBindingCandidate, 'serverName' | 'systemUser'>): string {
  return `${candidate.serverName} · ${candidate.systemUser}`;
}

function formatAutoAddResultLabel(result: AutoAddUnassignedPersonsReportItem['result']): string {
  switch (result) {
    case 'created-person':
      return '已创建人员';
    case 'reused-person':
      return '复用已有人员';
    case 'skipped-root':
      return '已跳过 root';
    case 'skipped-ambiguous':
      return '同名冲突';
    case 'skipped-already-bound':
      return '已被绑定';
    case 'failed':
      return '处理失败';
    default:
      return result;
  }
}

function getAutoAddResultBadgeClass(result: AutoAddUnassignedPersonsReportItem['result']): string {
  switch (result) {
    case 'created-person':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'reused-person':
      return 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue';
    case 'skipped-root':
      return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
    case 'skipped-ambiguous':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'skipped-already-bound':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-200';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  }
}

function isStepAccessible(step: WizardStep, mode: WizardMode | null, seed: PersonBindingCandidate | null): boolean {
  if (step === 'entry') {
    return true;
  }

  if (step === 'seed') {
    return mode === 'seed-user';
  }

  if (step === 'profile') {
    return mode === 'manual' || (mode === 'seed-user' && Boolean(seed));
  }

  return Boolean(mode) && (mode === 'manual' || Boolean(seed));
}

export function PeopleManage() {
  const navigate = useNavigate();
  const transport = useTransport();

  const [mode, setMode] = useState<WizardMode | null>(null);
  const [step, setStep] = useState<WizardStep>('entry');
  const [candidates, setCandidates] = useState<PersonBindingCandidate[]>([]);
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [seedPage, setSeedPage] = useState(0);
  const [autoAddLoading, setAutoAddLoading] = useState(false);
  const [autoAddError, setAutoAddError] = useState('');
  const [autoAddReport, setAutoAddReport] = useState<AutoAddUnassignedPersonsReport | null>(null);
  const [autoAddPage, setAutoAddPage] = useState(0);

  useEffect(() => {
    void transport.getPersonBindingCandidates().then(setCandidates).catch(() => setCandidates([]));
  }, [transport]);

  useEffect(() => {
    setSeedPage(0);
  }, [candidates.length]);

  useEffect(() => {
    setAutoAddPage(0);
  }, [autoAddReport]);

  const seed = useMemo(
    () => candidates.find((candidate) => getCandidateKey(candidate) === seedKey) ?? null,
    [candidates, seedKey]
  );

  const availableBindingCandidates = useMemo(() => {
    const nextCandidates = candidates.filter((candidate) => getCandidateKey(candidate) !== seedKey);

    if (!seed) {
      return nextCandidates;
    }

    return [...nextCandidates].sort((left, right) => {
      const scoreDifference = getSuggestionScore(seed.systemUser, right.systemUser) - getSuggestionScore(seed.systemUser, left.systemUser);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return right.lastSeenAt - left.lastSeenAt;
    });
  }, [candidates, seed, seedKey]);

  const selectedCandidates = useMemo(() => {
    const keys = new Set(selectedKeys);
    if (seedKey) {
      keys.add(seedKey);
    }

    const orderedCandidates: PersonBindingCandidate[] = [];
    if (seed) {
      orderedCandidates.push(seed);
    }

    for (const candidate of availableBindingCandidates) {
      if (keys.has(getCandidateKey(candidate))) {
        orderedCandidates.push(candidate);
      }
    }

    return orderedCandidates;
  }, [availableBindingCandidates, seed, seedKey, selectedKeys]);

  const hasTransferSelections = selectedCandidates.some((candidate) => candidate.activeBinding !== null);
  const canSubmit = Boolean(form.displayName.trim()) && !submitting && (!hasTransferSelections || confirmTransfer);
  const seedPageCount = Math.max(1, Math.ceil(candidates.length / SEED_PAGE_SIZE));
  const pagedSeedCandidates = candidates.slice(seedPage * SEED_PAGE_SIZE, (seedPage + 1) * SEED_PAGE_SIZE);
  const autoAddItems = autoAddReport?.items ?? [];
  const autoAddPageCount = Math.max(1, Math.ceil(autoAddItems.length / AUTO_RESULT_PAGE_SIZE));
  const pagedAutoAddItems = autoAddItems.slice(autoAddPage * AUTO_RESULT_PAGE_SIZE, (autoAddPage + 1) * AUTO_RESULT_PAGE_SIZE);

  function resetWizard(nextMode: WizardMode, nextStep: WizardStep) {
    setMode(nextMode);
    setStep(nextStep);
    setSeedKey(null);
    setSelectedKeys(new Set());
    setForm(EMPTY_FORM);
    setConfirmTransfer(false);
    setSubmitting(false);
    setSubmitError('');
    setSeedPage(0);
    setAutoAddLoading(false);
    setAutoAddError('');
    setAutoAddReport(null);
    setAutoAddPage(0);
  }

  function resetToEntry() {
    setMode(null);
    setStep('entry');
    setSeedKey(null);
    setSelectedKeys(new Set());
    setForm(EMPTY_FORM);
    setConfirmTransfer(false);
    setSubmitting(false);
    setSubmitError('');
    setSeedPage(0);
    setAutoAddLoading(false);
    setAutoAddError('');
    setAutoAddReport(null);
    setAutoAddPage(0);
  }

  function toggleCandidate(candidate: PersonBindingCandidate) {
    const key = getCandidateKey(candidate);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setConfirmTransfer(false);
  }

  function handleSeedSelection(candidate: PersonBindingCandidate) {
    const nextSeedKey = getCandidateKey(candidate);
    setSeedKey(nextSeedKey);
    setSelectedKeys((current) => {
      const next = new Set(current);
      next.delete(nextSeedKey);
      return next;
    });
    setConfirmTransfer(false);
    setSubmitError('');
  }

  function goToPreviousStep() {
    setSubmitError('');

    if (step === 'review') {
      setStep('bindings');
      return;
    }

    if (step === 'bindings') {
      setStep('profile');
      return;
    }

    if (step === 'profile') {
      setStep(mode === 'seed-user' ? 'seed' : 'entry');
      return;
    }

    if (step === 'seed') {
      setStep('entry');
    }
  }

  function goToNextStep() {
    setSubmitError('');

    if (step === 'seed' && seed) {
      setStep('profile');
      return;
    }

    if (step === 'profile' && form.displayName.trim()) {
      setStep('bindings');
      return;
    }

    if (step === 'bindings') {
      setStep('review');
    }
  }

  async function handleAutoAdd() {
    if (!transport.autoAddUnassignedPersons || autoAddLoading) {
      return;
    }

    setMode(null);
    setStep('auto-result');
    setSeedKey(null);
    setSelectedKeys(new Set());
    setForm(EMPTY_FORM);
    setConfirmTransfer(false);
    setSubmitting(false);
    setSubmitError('');
    setAutoAddLoading(true);
    setAutoAddError('');
    setAutoAddReport(null);
    setAutoAddPage(0);

    try {
      const report = await transport.autoAddUnassignedPersons();
      setAutoAddReport(report);
    } catch {
      setAutoAddError('一键添加失败，请稍后重试。');
    } finally {
      setAutoAddLoading(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    try {
      const person = await transport.createPerson({
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        qq: form.qq.trim(),
        note: form.note.trim(),
        customFields: {},
      });

      if (selectedCandidates.length > 0) {
        const effectiveAt = Date.now();

        for (const candidate of selectedCandidates) {
          if (candidate.activeBinding) {
            await transport.updatePersonBinding(candidate.activeBinding.bindingId, {
              enabled: false,
              effectiveTo: effectiveAt,
            });
          }
        }

        for (const candidate of selectedCandidates) {
          await transport.createPersonBinding({
            personId: person.id,
            serverId: candidate.serverId,
            systemUser: candidate.systemUser,
            source: 'manual',
            effectiveFrom: effectiveAt,
          });
        }
      }

      navigate(`/people/${person.id}`);
    } catch {
      setSubmitError('创建失败，请稍后重试。');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-dark-bg px-6 py-8 text-slate-200">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-[28px] border border-dark-border bg-dark-card/70 p-6 shadow-2xl shadow-black/20 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="brand-kicker">PEOPLE</p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-100">添加人员</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              先确认这是哪一个人，再决定要把哪些服务器账号归并到这个人名下。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-400">
              {step}
            </div>
            <Link to="/people" className="rounded-full border border-dark-border px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5">
              返回人员列表
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-dark-border bg-dark-card p-6 shadow-xl shadow-black/10">
            {step === 'entry' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">选择创建入口</h2>
                  <p className="mt-2 text-sm text-slate-400">推荐先从观察到的服务器用户开始，也可以完全手动创建一个空白人员，或者自动把同名未归属账号批量归到人员档案中。</p>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => resetWizard('seed-user', 'seed')}
                    aria-label="从服务器用户开始"
                    className="rounded-[24px] border border-dark-border bg-gradient-to-br from-accent-blue/15 via-dark-card to-dark-card p-5 text-left transition-colors hover:border-accent-blue/40"
                  >
                    <p className="text-sm font-medium text-slate-100">从服务器用户开始</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">先选一个 observed server user 作为 seed，再补 profile，最后决定还要归并哪些账号。</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => resetWizard('manual', 'profile')}
                    aria-label="手动创建空白人员"
                    className="rounded-[24px] border border-dark-border bg-dark-bg/60 p-5 text-left transition-colors hover:border-white/20"
                  >
                    <p className="text-sm font-medium text-slate-100">手动创建空白人员</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">只创建 profile。账号绑定完全可选，跳过后只会创建 person。</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleAutoAdd()}
                    disabled={autoAddLoading || !transport.autoAddUnassignedPersons}
                    aria-label="一键添加未归属用户"
                    className="rounded-[24px] border border-emerald-500/20 bg-gradient-to-br from-emerald-500/15 via-dark-card to-dark-card p-5 text-left transition-colors hover:border-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <p className="text-sm font-medium text-slate-100">一键添加未归属用户</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">同名非 root 用户自动复用或创建人员，并把所有未归属账号一次性绑定到人名下。</p>
                  </button>
                </div>
              </div>
            )}

            {step === 'seed' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                  <h2 className="text-xl font-semibold text-slate-100">选择 seed 账号</h2>
                  <p className="mt-2 text-sm text-slate-400">这里展示所有 observed system user，包括已经绑定到其他人的账号。</p>
                  </div>
                  {candidates.length > SEED_PAGE_SIZE && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{seedPage + 1} / {seedPageCount}</span>
                      <button
                        type="button"
                        aria-label="Seed 列表上一页"
                        onClick={() => setSeedPage((current) => Math.max(0, current - 1))}
                        disabled={seedPage === 0}
                        className="rounded-full border border-dark-border px-3 py-1 transition-colors hover:bg-white/5 disabled:opacity-30"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        aria-label="Seed 列表下一页"
                        onClick={() => setSeedPage((current) => Math.min(seedPageCount - 1, current + 1))}
                        disabled={seedPage >= seedPageCount - 1}
                        className="rounded-full border border-dark-border px-3 py-1 transition-colors hover:bg-white/5 disabled:opacity-30"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </div>

                {candidates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-dark-border bg-dark-bg/60 p-5 text-sm text-slate-400">
                    当前没有可用的 observed system user，你也可以返回后选择手动创建空白人员。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pagedSeedCandidates.map((candidate) => {
                      const key = getCandidateKey(candidate);
                      const isSelected = key === seedKey;

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handleSeedSelection(candidate)}
                          aria-label={`选择 ${formatCandidateLabel(candidate)}`}
                          className={`w-full rounded-2xl border p-4 text-left transition-colors ${isSelected ? 'border-accent-blue bg-accent-blue/10' : 'border-dark-border bg-dark-bg/60 hover:border-white/20'}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-100">选择 {formatCandidateLabel(candidate)}</p>
                              <p className="mt-1 text-xs text-slate-500">最后观测时间 {candidate.lastSeenAt}</p>
                            </div>
                            {candidate.activeBinding && (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                                已绑定至 {candidate.activeBinding.personDisplayName}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {step === 'profile' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">填写人员资料</h2>
                  <p className="mt-2 text-sm text-slate-400">只有显示名称必填，其他字段都可以留空。</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm text-slate-300">显示名称</span>
                    <input
                      value={form.displayName}
                      onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                      className="w-full rounded-2xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-accent-blue"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">邮箱</span>
                    <input
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                      className="w-full rounded-2xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-accent-blue"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm text-slate-300">QQ</span>
                    <input
                      value={form.qq}
                      onChange={(event) => setForm((current) => ({ ...current, qq: event.target.value }))}
                      className="w-full rounded-2xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-accent-blue"
                    />
                  </label>

                  <label className="space-y-2 md:col-span-2">
                    <span className="text-sm text-slate-300">备注</span>
                    <textarea
                      value={form.note}
                      onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                      rows={4}
                      className="w-full rounded-2xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-accent-blue"
                    />
                  </label>
                </div>
              </div>
            )}

            {step === 'bindings' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">选择要归并的账号</h2>
                  <p className="mt-2 text-sm text-slate-400">推荐项只做提示，必须人工勾选。手动模式可以直接跳过，不创建任何 binding。</p>
                </div>

                {seed && (
                  <div className="rounded-2xl border border-accent-blue/30 bg-accent-blue/10 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-accent-blue">Seed</p>
                    <p className="mt-2 text-sm font-medium text-slate-100">{formatCandidateLabel(seed)}</p>
                    <p className="mt-1 text-xs text-slate-400">seed 对应账号会自动包含在最终提交集合中。</p>
                  </div>
                )}

                {availableBindingCandidates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-dark-border bg-dark-bg/60 p-5 text-sm text-slate-400">
                    没有其他 observed system user 可以选择。继续下一步会只创建人员，或者只保留 seed 账号。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableBindingCandidates.map((candidate) => {
                      const key = getCandidateKey(candidate);
                      const suggestionScore = seed ? getSuggestionScore(seed.systemUser, candidate.systemUser) : 0;
                      const isSuggested = suggestionScore > 0;
                      const isChecked = selectedKeys.has(key);

                      return (
                        <label key={key} className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors ${isChecked ? 'border-accent-blue bg-accent-blue/10' : 'border-dark-border bg-dark-bg/60 hover:border-white/20'}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCandidate(candidate)}
                            className="mt-1 h-4 w-4 rounded border-dark-border bg-dark-bg text-accent-blue"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">{formatCandidateLabel(candidate)}</span>
                              {isSuggested && (
                                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
                                  建议归并
                                </span>
                              )}
                              {candidate.activeBinding && (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">
                                  已绑定至 {candidate.activeBinding.personDisplayName}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">最后观测时间 {candidate.lastSeenAt}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {step === 'review' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">确认并创建</h2>
                  <p className="mt-2 text-sm text-slate-400">提交时会先创建 person，再处理旧绑定迁移，最后创建新的 bindings。</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Profile</p>
                    <dl className="mt-3 space-y-2 text-sm text-slate-300">
                      <div className="flex justify-between gap-3"><dt>显示名称</dt><dd className="text-right text-slate-100">{form.displayName || '-'}</dd></div>
                      <div className="flex justify-between gap-3"><dt>邮箱</dt><dd className="text-right">{form.email || '-'}</dd></div>
                      <div className="flex justify-between gap-3"><dt>QQ</dt><dd className="text-right">{form.qq || '-'}</dd></div>
                      <div className="flex justify-between gap-3"><dt>备注</dt><dd className="text-right">{form.note || '-'}</dd></div>
                    </dl>
                  </div>

                  <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Bindings</p>
                    {selectedCandidates.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">当前没有选择任何账号，将只创建 person。</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {selectedCandidates.map((candidate) => (
                          <div key={getCandidateKey(candidate)} className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm">
                            <p className="font-medium text-slate-100">{formatCandidateLabel(candidate)}</p>
                            {candidate.activeBinding && (
                              <p className="mt-1 text-xs text-amber-300">当前绑定到 {candidate.activeBinding.personDisplayName}，提交时会先停用旧绑定。</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {hasTransferSelections && (
                  <label className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <input
                      type="checkbox"
                      checked={confirmTransfer}
                      onChange={(event) => setConfirmTransfer(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-amber-500/40 bg-transparent text-amber-300"
                    />
                    <span>我确认转移已绑定账号</span>
                  </label>
                )}

                {submitError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                    {submitError}
                  </div>
                )}
              </div>
            )}

            {step === 'auto-result' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-100">一键添加结果</h2>
                    <p className="mt-2 text-sm text-slate-400">按用户名聚合处理未归属账号，结果会区分复用已有人员、自动创建、跳过 root、同名冲突等情况。</p>
                  </div>
                  {autoAddItems.length > AUTO_RESULT_PAGE_SIZE && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{autoAddPage + 1} / {autoAddPageCount}</span>
                      <button
                        type="button"
                        aria-label="结果报告上一页"
                        onClick={() => setAutoAddPage((current) => Math.max(0, current - 1))}
                        disabled={autoAddPage === 0}
                        className="rounded-full border border-dark-border px-3 py-1 transition-colors hover:bg-white/5 disabled:opacity-30"
                      >
                        上一页
                      </button>
                      <button
                        type="button"
                        aria-label="结果报告下一页"
                        onClick={() => setAutoAddPage((current) => Math.min(autoAddPageCount - 1, current + 1))}
                        disabled={autoAddPage >= autoAddPageCount - 1}
                        className="rounded-full border border-dark-border px-3 py-1 transition-colors hover:bg-white/5 disabled:opacity-30"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </div>

                {autoAddLoading && (
                  <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-5 text-sm text-slate-400">
                    正在自动归属未归属用户...
                  </div>
                )}

                {autoAddError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                    {autoAddError}
                  </div>
                )}

                {autoAddReport && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">处理用户名数</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.candidateUserCount}</p>
                      </div>
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">创建/复用人员</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.createdPersonCount} / {autoAddReport.summary.reusedPersonCount}</p>
                      </div>
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">创建绑定数</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.createdBindingCount}</p>
                      </div>
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">跳过 root</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.skippedRootCount}</p>
                      </div>
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">同名冲突/已绑定</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.skippedAmbiguousCount} / {autoAddReport.summary.skippedAlreadyBoundCount}</p>
                      </div>
                      <div className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4 text-sm text-slate-300">
                        <p className="text-slate-500">失败数</p>
                        <p className="mt-2 text-2xl text-slate-100">{autoAddReport.summary.failedCount}</p>
                      </div>
                    </div>

                    {autoAddItems.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-dark-border bg-dark-bg/60 p-5 text-sm text-slate-400">
                        当前没有可自动处理的未归属用户名。
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pagedAutoAddItems.map((item) => (
                          <div key={item.normalizedUsername} className="rounded-2xl border border-dark-border bg-dark-bg/60 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-medium text-slate-100">{item.username}</p>
                                  <span className={`rounded-full border px-2.5 py-0.5 text-xs ${getAutoAddResultBadgeClass(item.result)}`}>
                                    {formatAutoAddResultLabel(item.result)}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-slate-400">{item.message}</p>
                              </div>
                              <div className="text-right text-xs text-slate-500">
                                <p>绑定账号 {item.bindingCount}</p>
                                <p className="mt-1">归属 {item.personDisplayName ?? '-'}</p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
                              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm text-slate-300">
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">人员</p>
                                <p className="mt-2 text-slate-100">{item.personDisplayName ?? '未归属到人员'}</p>
                                <p className="mt-1 text-xs text-slate-500">{item.personId ?? '无 personId'}</p>
                              </div>

                              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-sm text-slate-300">
                                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">账号明细</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {item.bindings.map((binding) => (
                                    <span key={`${binding.serverId}:${binding.systemUser}`} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                                      {binding.serverName} · {binding.systemUser}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-6">
                      <button
                        type="button"
                        onClick={resetToEntry}
                        className="rounded-full border border-dark-border px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5"
                      >
                        返回入口
                      </button>

                      <Link
                        to="/people"
                        className="rounded-full bg-accent-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-blue/90"
                      >
                        返回人员列表
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}

            {step !== 'entry' && step !== 'auto-result' && (
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-6">
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  className="rounded-full border border-dark-border px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5"
                >
                  上一步
                </button>

                {step !== 'review' ? (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    disabled={(step === 'seed' && !seed) || (step === 'profile' && !form.displayName.trim()) || !isStepAccessible(step === 'seed' ? 'profile' : step === 'profile' ? 'bindings' : 'review', mode, seed)}
                    className="rounded-full bg-accent-blue px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一步
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="rounded-full bg-accent-blue px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitting ? '创建中...' : '创建人员'}
                  </button>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            {step === 'auto-result' ? (
              <div className="rounded-[28px] border border-dark-border bg-dark-card p-6 shadow-xl shadow-black/10">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">批量规则</p>
                <div className="mt-4 space-y-4 text-sm text-slate-300">
                  <div>
                    <p className="text-slate-500">处理范围</p>
                    <p className="mt-1 text-slate-100">仅处理未归属且非 root 的同名账号</p>
                  </div>
                  <div>
                    <p className="text-slate-500">同名策略</p>
                    <p className="mt-1 text-slate-100">唯一同名复用，多条同名跳过并记入报告</p>
                  </div>
                  <div>
                    <p className="text-slate-500">显示名称</p>
                    <p className="mt-1 text-slate-100">自动新建人员时直接使用用户名</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-dark-border bg-dark-card p-6 shadow-xl shadow-black/10">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">流程</p>
                <ol className="mt-4 space-y-3 text-sm">
                  {[
                    { key: 'entry', label: '入口模式' },
                    { key: 'seed', label: '选择 seed' },
                    { key: 'profile', label: '填写 profile' },
                    { key: 'bindings', label: '挑选归并账号' },
                    { key: 'review', label: '确认并创建' },
                  ].filter((item) => item.key !== 'seed' || mode !== 'manual').map((item) => {
                    const isCurrent = item.key === step;
                    const accessible = isStepAccessible(item.key as WizardStep, mode, seed);

                    return (
                      <li key={item.key} className={`flex items-center justify-between rounded-2xl px-4 py-3 ${isCurrent ? 'bg-accent-blue/10 text-accent-blue' : accessible ? 'bg-dark-bg/60 text-slate-300' : 'bg-dark-bg/30 text-slate-600'}`}>
                        <span>{item.label}</span>
                        {isCurrent && <span className="text-xs uppercase tracking-[0.22em]">Now</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="rounded-[28px] border border-dark-border bg-dark-card p-6 shadow-xl shadow-black/10">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">当前结果</p>
              <div className="mt-4 space-y-4 text-sm text-slate-300">
                <div>
                  <p className="text-slate-500">模式</p>
                  <p className="mt-1 text-slate-100">{mode === 'manual' ? '手动创建空白人员' : mode === 'seed-user' ? '从服务器用户开始' : '未选择'}</p>
                </div>

                <div>
                  <p className="text-slate-500">Seed</p>
                  <p className="mt-1 text-slate-100">{seed ? formatCandidateLabel(seed) : '未选择'}</p>
                </div>

                <div>
                  <p className="text-slate-500">已选账号</p>
                  {selectedCandidates.length === 0 ? (
                    <p className="mt-1 text-slate-400">暂无</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedCandidates.map((candidate) => (
                        <span key={getCandidateKey(candidate)} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                          {formatCandidateLabel(candidate)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
