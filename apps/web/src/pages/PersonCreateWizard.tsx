import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type {
  AutoAddReport,
  AutoAddReportEntry,
  CreatePersonWizardResult,
  PersonBindingCandidate,
  PersonBindingConflict,
  PersonWizardMode,
} from '../transport/types.js';

type WizardStep = 'entry' | 'seed' | 'profile' | 'bindings' | 'review' | 'auto-add-result';

type WizardError = Error & { status?: number; details?: unknown };

const PAGE_SIZE = 12;

export default function PersonCreateWizard() {
  const navigate = useNavigate();
  const transport = useTransport();

  const [mode, setMode] = useState<PersonWizardMode | null>(null);
  const [step, setStep] = useState<WizardStep>('entry');
  const [candidates, setCandidates] = useState<PersonBindingCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const [selectedBindingKeys, setSelectedBindingKeys] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [qq, setQQ] = useState('');
  const [note, setNote] = useState('');
  const [seedQuery, setSeedQuery] = useState('');
  const [seedPage, setSeedPage] = useState(1);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoAddReport, setAutoAddReport] = useState<AutoAddReport | null>(null);
  const [autoAddLoading, setAutoAddLoading] = useState(false);
  const [autoAddError, setAutoAddError] = useState<string | null>(null);
  const [autoAddPage, setAutoAddPage] = useState(1);

  useEffect(() => {
    setLoadingCandidates(true);
    transport.getPersonBindingCandidates()
      .then((response) => {
        setCandidates(response.candidates);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : '加载候选账号失败');
      })
      .finally(() => setLoadingCandidates(false));
  }, [transport]);

  const candidateMap = useMemo(() => new Map(candidates.map((candidate) => [toKey(candidate), candidate])), [candidates]);
  const selectedSeed = seedKey ? candidateMap.get(seedKey) ?? null : null;

  const filteredSeeds = useMemo(() => {
    const query = seedQuery.trim().toLowerCase();
    const base = candidates
      .filter((candidate) => !query || candidate.systemUser.toLowerCase().includes(query) || candidate.serverName.toLowerCase().includes(query))
      .sort((left, right) => left.systemUser.localeCompare(right.systemUser, 'zh-CN'));
    return base;
  }, [candidates, seedQuery]);

  const pagedSeeds = useMemo(() => {
    const start = (seedPage - 1) * PAGE_SIZE;
    return filteredSeeds.slice(start, start + PAGE_SIZE);
  }, [filteredSeeds, seedPage]);

  const suggestedCandidates = useMemo(() => {
    if (!selectedSeed) {
      return [];
    }

    return candidates
      .filter((candidate) => toKey(candidate) !== toKey(selectedSeed))
      .map((candidate) => ({ candidate, score: getSuggestionScore(selectedSeed.systemUser, candidate.systemUser) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.candidate.systemUser.localeCompare(right.candidate.systemUser, 'zh-CN'));
  }, [candidates, selectedSeed]);

  const bindingChoices = useMemo(() => {
    if (mode === 'manual') {
      return candidates
        .slice()
        .sort((left, right) => left.systemUser.localeCompare(right.systemUser, 'zh-CN'));
    }

    if (!selectedSeed) {
      return [];
    }

    return suggestedCandidates.map((item) => item.candidate);
  }, [candidates, mode, selectedSeed, suggestedCandidates]);

  const selectedBindings = useMemo(() => {
    const keys = new Set(selectedBindingKeys);
    if (selectedSeed) {
      keys.add(toKey(selectedSeed));
    }
    return Array.from(keys)
      .map((key) => candidateMap.get(key))
      .filter((candidate): candidate is PersonBindingCandidate => Boolean(candidate));
  }, [candidateMap, selectedBindingKeys, selectedSeed]);

  const conflicts = useMemo(() => selectedBindings.filter((binding) => binding.activeBinding !== null), [selectedBindings]);
  const canSubmit = displayName.trim().length > 0 && (!conflicts.length || confirmTransfer);

  function resetWizard(nextMode: PersonWizardMode, nextStep: WizardStep) {
    setMode(nextMode);
    setStep(nextStep);
    setSeedKey(null);
    setSelectedBindingKeys([]);
    setDisplayName('');
    setEmail('');
    setQQ('');
    setNote('');
    setConfirmTransfer(false);
    setSubmitError(null);
  }

  function handleSelectMode(nextMode: PersonWizardMode) {
    resetWizard(nextMode, nextMode === 'seed-user' ? 'seed' : 'profile');
  }

  async function handleAutoAdd() {
    setAutoAddLoading(true);
    setAutoAddError(null);
    setAutoAddReport(null);
    setAutoAddPage(1);
    try {
      const report = await transport.autoAddUnassigned();
      setAutoAddReport(report);
      setStep('auto-add-result');
    } catch (error) {
      setAutoAddError(error instanceof Error ? error.message : '批量添加失败');
    } finally {
      setAutoAddLoading(false);
    }
  }

  function handleSeedConfirm() {
    if (!selectedSeed) {
      return;
    }

    setDisplayName((value) => value || selectedSeed.systemUser);
    setSelectedBindingKeys([]);
    setConfirmTransfer(false);
    setStep('profile');
  }

  function handleToggleBinding(candidate: PersonBindingCandidate) {
    const key = toKey(candidate);
    if (key === seedKey) {
      return;
    }
    setSelectedBindingKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  }

  function handleBack() {
    setSubmitError(null);
    setConfirmTransfer(false);
    if (step === 'seed') {
      setStep('entry');
      return;
    }
    if (step === 'profile') {
      setStep(mode === 'seed-user' ? 'seed' : 'entry');
      return;
    }
    if (step === 'bindings') {
      setStep('profile');
      return;
    }
    if (step === 'review') {
      setStep('bindings');
    }
  }

  async function handleSubmit() {
    if (!mode || !canSubmit) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await transport.createPersonWizard({
        mode,
        person: {
          displayName: displayName.trim(),
          email: emptyToNull(email),
          qq: emptyToNull(qq),
          note: emptyToNull(note),
        },
        bindings: selectedBindings.map((binding) => ({
          serverId: binding.serverId,
          systemUser: binding.systemUser,
          source: mode === 'seed-user' ? 'suggested' : 'manual',
        })),
        confirmTransfer,
      });
      handleSuccess(result);
    } catch (error) {
      const wizardError = error as WizardError;
      const detailMessage = getWizardErrorMessage(wizardError.details);
      const detailConflicts = getWizardConflicts(wizardError.details);
      if (wizardError.status === 409 && detailConflicts.length > 0) {
        setConfirmTransfer(false);
      }
      setSubmitError(detailMessage ?? wizardError.message ?? '创建人员失败');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSuccess(result: CreatePersonWizardResult) {
    navigate(`/people/${result.person.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <button onClick={() => navigate('/people')} className="mb-2 text-xs text-accent-blue hover:underline">← 返回人员列表</button>
          <p className="brand-kicker">PERSON WIZARD</p>
          <h2 className="text-xl font-bold text-slate-100">添加人员</h2>
          <p className="mt-1 text-sm text-slate-500">恢复第一阶段向导：从服务器用户开始或手动创建，并支持显式账号迁移确认。</p>
        </div>
        <StepBadge step={step} />
      </div>

      {step === 'entry' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <ModeCard
            title="从服务器用户开始"
            body="先选择一个系统用户作为种子，再补全档案和附加绑定。适合已经观察到节点账号的场景。"
            onClick={() => handleSelectMode('seed-user')}
          />
          <ModeCard
            title="手动创建"
            body="直接创建人员档案，可选择暂时不绑定任何账号。适合先建档再补绑定的场景。"
            onClick={() => handleSelectMode('manual')}
          />
          <ModeCard
            title="一键添加未归属用户"
            body="按「同名即同人」的规则批量为未绑定账号创建人员档案。跳过 root，遇同名冲突自动跳过。"
            onClick={() => { void handleAutoAdd(); }}
            disabled={autoAddLoading}
          />
          {autoAddError && (
            <div className="lg:col-span-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{autoAddError}</div>
          )}
        </div>
      )}

      {step === 'seed' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-200">选择种子系统用户</h3>
              <p className="mt-1 text-xs text-slate-500">第一阶段候选来源只使用各节点最新快照的 local users。</p>
            </div>
            <input
              value={seedQuery}
              onChange={(event) => {
                setSeedQuery(event.target.value);
                setSeedPage(1);
              }}
              placeholder="搜索节点或用户名"
              className="w-full rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none sm:w-64"
            />
          </div>

          {loadingCandidates ? (
            <div className="py-8 text-center text-sm text-slate-500">正在加载候选账号...</div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{loadError}</div>
          ) : filteredSeeds.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">没有可用的系统账号候选。</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pagedSeeds.map((candidate) => {
                  const active = seedKey === toKey(candidate);
                  return (
                    <button
                      key={toKey(candidate)}
                      onClick={() => setSeedKey(toKey(candidate))}
                      className={`rounded-2xl border p-4 text-left transition-colors ${active ? 'border-accent-blue bg-accent-blue/10' : 'border-dark-border bg-dark-bg hover:border-white/20'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-100">{candidate.systemUser}</p>
                          <p className="mt-1 text-xs text-slate-500">{candidate.serverName}</p>
                        </div>
                        <BindingStateBadge candidate={candidate} />
                      </div>
                    </button>
                  );
                })}
              </div>

              <Pagination current={seedPage} total={Math.max(1, Math.ceil(filteredSeeds.length / PAGE_SIZE))} onChange={setSeedPage} />
            </>
          )}

          <WizardActions
            backLabel="返回"
            nextLabel="下一步"
            onBack={handleBack}
            onNext={handleSeedConfirm}
            nextDisabled={!selectedSeed}
          />
        </div>
      )}

      {step === 'profile' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-slate-200">填写人员档案</h3>
            <p className="mt-1 text-xs text-slate-500">显示名称为必填；邮箱、QQ、备注可以后续补充。</p>
          </div>

          {selectedSeed && (
            <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/5 px-4 py-3 text-sm text-slate-300">
              当前种子账号：<span className="font-medium text-slate-100">{selectedSeed.systemUser}</span>
              <span className="ml-2 text-xs text-slate-500">{selectedSeed.serverName}</span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-1 text-sm text-slate-300">
              <span>显示名称 *</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span>邮箱</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </label>
            <label className="space-y-1 text-sm text-slate-300">
              <span>QQ</span>
              <input value={qq} onChange={(event) => setQQ(event.target.value)} className="w-full rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </label>
            <label className="space-y-1 text-sm text-slate-300 lg:col-span-2">
              <span>备注</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="w-full rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </label>
          </div>

          <WizardActions
            backLabel="上一步"
            nextLabel="继续选择绑定"
            onBack={handleBack}
            onNext={() => setStep('bindings')}
            nextDisabled={!displayName.trim()}
          />
        </div>
      )}

      {step === 'bindings' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-slate-200">选择绑定账号</h3>
            <p className="mt-1 text-xs text-slate-500">
              {mode === 'seed-user' ? '系统按用户名相似度给出附加建议，你可以按需勾选。' : '手动创建模式下可以跳过绑定，后续再补。'}
            </p>
          </div>

          {selectedSeed && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-slate-200">
              已固定绑定种子账号：{selectedSeed.serverName} / {selectedSeed.systemUser}
            </div>
          )}

          {bindingChoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">{mode === 'seed-user' ? '没有发现可建议的附加账号。' : '当前没有可选账号，仍可继续创建。'}</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {bindingChoices.map((candidate) => {
                const key = toKey(candidate);
                const checked = selectedBindingKeys.includes(key);
                const score = selectedSeed ? getSuggestionScore(selectedSeed.systemUser, candidate.systemUser) : 0;
                return (
                  <label key={key} className="flex items-start gap-3 rounded-2xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-slate-200">
                    <input type="checkbox" checked={checked} onChange={() => handleToggleBinding(candidate)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-100">{candidate.systemUser}</span>
                        <span className="text-xs text-slate-500">{candidate.serverName}</span>
                        {score > 0 && mode === 'seed-user' && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">匹配分 {score}</span>}
                      </div>
                      {candidate.activeBinding && (
                        <p className="mt-1 text-xs text-amber-300">
                          当前已绑定给 {candidate.activePerson?.displayName ?? candidate.activeBinding.personId}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          <WizardActions
            backLabel="上一步"
            nextLabel="确认信息"
            onBack={handleBack}
            onNext={() => setStep('review')}
          />
        </div>
      )}

      {step === 'review' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium text-slate-200">提交前确认</h3>
            <p className="mt-1 text-xs text-slate-500">本次会一次性创建人员档案并落地所选绑定，避免前端分多次请求造成半成品状态。</p>
          </div>

          <SummaryGrid
            items={[
              { label: '创建方式', value: mode === 'seed-user' ? '从服务器用户开始' : '手动创建' },
              { label: '显示名称', value: displayName },
              { label: '邮箱', value: email || '—' },
              { label: 'QQ', value: qq || '—' },
            ]}
          />

          <div className="rounded-xl border border-dark-border bg-dark-bg p-4">
            <p className="text-sm font-medium text-slate-200">本次绑定</p>
            {selectedBindings.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">不创建任何绑定，先只建立人员档案。</p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                {selectedBindings.map((binding) => (
                  <div key={toKey(binding)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 px-3 py-2">
                    <span>{binding.serverName} / {binding.systemUser}</span>
                    <BindingStateBadge candidate={binding} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100 space-y-3">
              <div>
                <p className="font-medium">检测到已绑定账号</p>
                <p className="mt-1 text-xs text-amber-100/80">这些账号当前已属于其他人员，只有显式确认后才会迁移。</p>
              </div>
              <div className="space-y-2">
                {conflicts.map((conflict) => (
                  <ConflictRow key={toKey(conflict)} conflict={toConflict(conflict)} />
                ))}
              </div>
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={confirmTransfer} onChange={(event) => setConfirmTransfer(event.target.checked)} className="mt-1" />
                <span>我确认迁移这些已绑定账号，并接受旧绑定会被禁用。</span>
              </label>
            </div>
          )}

          {submitError && (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{submitError}</div>
          )}

          <WizardActions
            backLabel="上一步"
            nextLabel={submitting ? '提交中...' : '创建人员'}
            onBack={handleBack}
            onNext={() => { void handleSubmit(); }}
            nextDisabled={!canSubmit || submitting}
          />
        </div>
      )}

      {step === 'auto-add-result' && autoAddReport && (
        <AutoAddResultView
          report={autoAddReport}
          page={autoAddPage}
          onPageChange={setAutoAddPage}
          onBack={() => setStep('entry')}
          onNavigate={(personId) => navigate(`/people/${personId}`)}
        />
      )}
    </div>
  );
}

function StepBadge({ step }: { step: WizardStep }) {
  const labelMap: Record<WizardStep, string> = {
    entry: '入口选择',
    seed: '种子用户',
    profile: '人员档案',
    bindings: '绑定账号',
    review: '确认提交',
    'auto-add-result': '批量结果',
  };

  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">{labelMap[step]}</span>;
}

function ModeCard({ title, body, onClick, disabled }: { title: string; body: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="rounded-3xl border border-dark-border bg-dark-card p-6 text-left transition-colors hover:border-accent-blue/40 hover:bg-accent-blue/5 disabled:opacity-50">
      <p className="text-base font-semibold text-slate-100">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </button>
  );
}

function WizardActions({
  backLabel,
  nextLabel,
  onBack,
  onNext,
  nextDisabled,
}: {
  backLabel: string;
  nextLabel: string;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button onClick={onBack} className="rounded-xl border border-dark-border px-4 py-2 text-sm text-slate-300 hover:bg-white/5">{backLabel}</button>
      <button onClick={onNext} disabled={nextDisabled} className="rounded-xl bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80 disabled:opacity-50">{nextLabel}</button>
    </div>
  );
}

function SummaryGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-dark-border bg-dark-bg px-4 py-3">
          <p className="text-xs text-slate-500">{item.label}</p>
          <p className="mt-1 text-sm text-slate-100">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function Pagination({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <span>第 {current} / {total} 页</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(1, current - 1))} disabled={current <= 1} className="rounded-lg border border-dark-border px-3 py-1 disabled:opacity-50">上一页</button>
        <button onClick={() => onChange(Math.min(total, current + 1))} disabled={current >= total} className="rounded-lg border border-dark-border px-3 py-1 disabled:opacity-50">下一页</button>
      </div>
    </div>
  );
}

function BindingStateBadge({ candidate }: { candidate: PersonBindingCandidate }) {
  if (!candidate.activeBinding) {
    return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">未绑定</span>;
  }

  return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">已绑定</span>;
}

function ConflictRow({ conflict }: { conflict: PersonBindingConflict }) {
  return (
    <div className="rounded-lg border border-amber-300/20 px-3 py-2 text-xs text-amber-100/90">
      {conflict.serverId} / {conflict.systemUser} → {conflict.activePerson?.displayName ?? conflict.activeBinding.personId}
    </div>
  );
}

function toKey(candidate: Pick<PersonBindingCandidate, 'serverId' | 'systemUser'>): string {
  return `${candidate.serverId}::${candidate.systemUser}`;
}

const AUTO_ADD_PAGE_SIZE = 20;

const ACTION_LABELS: Record<AutoAddReportEntry['action'], { label: string; color: string }> = {
  created: { label: '已创建', color: 'text-emerald-300' },
  reused: { label: '已复用', color: 'text-accent-blue' },
  skipped_root: { label: '跳过 root', color: 'text-slate-500' },
  skipped_ambiguous: { label: '同名冲突', color: 'text-amber-300' },
  skipped_bound: { label: '已绑定', color: 'text-slate-500' },
};

function AutoAddResultView({
  report,
  page,
  onPageChange,
  onBack,
  onNavigate,
}: {
  report: AutoAddReport;
  page: number;
  onPageChange: (page: number) => void;
  onBack: () => void;
  onNavigate: (personId: string) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(report.entries.length / AUTO_ADD_PAGE_SIZE));
  const pagedEntries = report.entries.slice((page - 1) * AUTO_ADD_PAGE_SIZE, page * AUTO_ADD_PAGE_SIZE);

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-5">
      <div>
        <h3 className="text-sm font-medium text-slate-200">批量添加结果</h3>
        <p className="mt-1 text-xs text-slate-500">以下是一键添加未归属用户的处理结果。</p>
      </div>

      <SummaryGrid
        items={[
          { label: '已创建', value: String(report.createdCount) },
          { label: '已复用', value: String(report.reusedCount) },
          { label: '已跳过', value: String(report.skippedCount) },
          { label: '总计', value: String(report.entries.length) },
        ]}
      />

      {report.entries.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">没有需要处理的未归属用户。</div>
      ) : (
        <div className="space-y-2">
          {pagedEntries.map((entry, idx) => {
            const { label, color } = ACTION_LABELS[entry.action];
            return (
              <div key={`${entry.serverId}::${entry.systemUser}::${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-dark-bg px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-slate-200">{entry.systemUser}</span>
                  <span className="ml-2 text-xs text-slate-500">{entry.serverName}</span>
                  <p className="mt-1 text-xs text-slate-400">{entry.detail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full bg-white/5 px-2 py-0.5 text-[11px] ${color}`}>{label}</span>
                  {entry.personId && (
                    <button onClick={() => onNavigate(entry.personId!)} className="text-xs text-accent-blue hover:underline">查看</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination current={page} total={totalPages} onChange={onPageChange} />
      )}

      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="rounded-xl border border-dark-border px-4 py-2 text-sm text-slate-300 hover:bg-white/5">返回入口</button>
      </div>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function longestCommonSubsequenceLength(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[left.length][right.length];
}

function getSuggestionScore(seedUser: string, candidateUser: string): number {
  const seed = normalizeUsername(seedUser);
  const candidate = normalizeUsername(candidateUser);

  if (!seed || !candidate || seed === candidate) {
    return seed === candidate ? 100 : 0;
  }

  if (seed.includes(candidate) || candidate.includes(seed)) {
    return 80;
  }

  const lcs = longestCommonSubsequenceLength(seed, candidate);
  const threshold = Math.max(3, Math.floor(Math.min(seed.length, candidate.length) * 0.6));
  return lcs >= threshold ? 60 : 0;
}

function getWizardErrorMessage(details: unknown): string | null {
  if (!details || typeof details !== 'object') {
    return null;
  }
  const record = details as Record<string, unknown>;
  return typeof record.message === 'string' ? record.message : null;
}

function getWizardConflicts(details: unknown): PersonBindingConflict[] {
  if (!details || typeof details !== 'object') {
    return [];
  }
  const record = details as Record<string, unknown>;
  return Array.isArray(record.conflicts) ? (record.conflicts as PersonBindingConflict[]) : [];
}

function toConflict(candidate: PersonBindingCandidate): PersonBindingConflict {
  return {
    serverId: candidate.serverId,
    systemUser: candidate.systemUser,
    activeBinding: candidate.activeBinding!,
    activePerson: candidate.activePerson,
  };
}