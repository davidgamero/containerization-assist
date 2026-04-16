import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ExampleApp, PolicyPreset, Policy } from '../api/client';
import { FileUpload } from '../components/FileUpload';

const TAG_COLORS: Record<string, string> = {
  backend: 'bg-emerald-100 text-emerald-700',
  frontend: 'bg-violet-100 text-violet-700',
  fullstack: 'bg-amber-100 text-amber-700',
  database: 'bg-sky-100 text-sky-700',
  node: 'bg-green-100 text-green-700',
  python: 'bg-yellow-100 text-yellow-700',
  react: 'bg-cyan-100 text-cyan-700',
};

function tagColor(tag: string): string {
  return TAG_COLORS[tag] ?? 'bg-zinc-100 text-zinc-600';
}

function parseAllowlistInput(
  input: string,
  fallback: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const items = input
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '*');
  if (items.length === 0) return fallback;

  const allowed_images: string[] = [];
  const allowed_patterns: string[] = [];
  for (const item of items) {
    if (item.includes('*')) allowed_patterns.push(item);
    else allowed_images.push(item);
  }
  return { allowed_images, allowed_patterns };
}

export function NewSession() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'examples' | 'upload' | 'github'>('examples');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [ref, setRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleApp[]>([]);
  const [policyPresets, setPolicyPresets] = useState<PolicyPreset[]>([]);
  const [policiesExpanded, setPoliciesExpanded] = useState(false);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [customPolicyInput, setCustomPolicyInput] = useState('');
  const [configuringPreset, setConfiguringPreset] = useState<PolicyPreset | null>(null);
  const [presetConfigValues, setPresetConfigValues] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .getExamples()
      .then(setExamples)
      .catch(() => {});
    api
      .getPolicyPresets()
      .then(setPolicyPresets)
      .catch(() => {});
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.createSessionFromUpload(selectedFile);
      await api.updateSessionPolicies(session.id, policies);
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHub = async () => {
    if (!repoUrl) return;
    setLoading(true);
    setError(null);
    try {
      const session = await api.createSessionFromGitHub(repoUrl, ref || undefined);
      await api.updateSessionPolicies(session.id, policies);
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleExample = async (exampleId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.createSessionFromExample(exampleId);
      await api.updateSessionPolicies(result.sessionId, policies);
      navigate(`/sessions/${result.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPreset = (preset: PolicyPreset) => {
    if (preset.configurable) {
      setConfiguringPreset(preset);
      setPresetConfigValues({});
      return;
    }

    const newPolicy: Policy = {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      type: preset.type,
      scope: 'session',
      target: preset.target,
      enabled: true,
      ...(preset.builtinId && { builtinId: preset.builtinId }),
      ...(preset.rego && { rego: preset.rego }),
      ...(preset.defaultConfig && { config: preset.defaultConfig }),
    };
    if (!policies.find((p) => p.id === preset.id)) {
      setPolicies((prev) => [...prev, newPolicy]);
    }
  };

  const handleConfirmPreset = () => {
    if (!configuringPreset) return;

    const configField = configuringPreset.configFields?.[0];
    const configValue = configField ? presetConfigValues[configField.key] || '' : '';

    const description = configValue
      ? `${configuringPreset.description.split('.')[0]}. Allowed: ${configValue}`
      : configuringPreset.description;

    const config =
      configuringPreset.id === 'image-allowlist'
        ? parseAllowlistInput(configValue, configuringPreset.defaultConfig)
        : configuringPreset.defaultConfig;

    const newPolicy: Policy = {
      id: configuringPreset.id,
      name: configuringPreset.name,
      description,
      type: configuringPreset.type,
      scope: 'session',
      target: configuringPreset.target,
      enabled: true,
      ...(configuringPreset.builtinId && { builtinId: configuringPreset.builtinId }),
      ...(configuringPreset.rego && { rego: configuringPreset.rego }),
      ...(config && { config }),
    };
    if (!policies.find((p) => p.id === configuringPreset.id)) {
      setPolicies((prev) => [...prev, newPolicy]);
    }

    setConfiguringPreset(null);
    setPresetConfigValues({});
  };

  const handleAddCustomPolicy = () => {
    if (!customPolicyInput.trim()) return;
    const newPolicy: Policy = {
      id: `custom-${Date.now()}`,
      name: customPolicyInput,
      description: customPolicyInput,
      type: 'skill',
      scope: 'session',
      target: 'any',
      directive: customPolicyInput,
      enabled: true,
    };
    setPolicies((prev) => [...prev, newPolicy]);
    setCustomPolicyInput('');
  };

  const handleRemovePolicy = (id: string) => {
    setPolicies((prev) => prev.filter((p) => p.id !== id));
  };

  const tabs: { key: typeof mode; label: string }[] = [
    { key: 'examples', label: 'Start from Example' },
    { key: 'upload', label: 'Upload ZIP' },
    { key: 'github', label: 'GitHub Repository' },
  ];

  return (
    <div className='min-h-screen bg-zinc-50'>
      <div className='max-w-3xl mx-auto px-6 py-12'>
        <div className='mb-8'>
          <h1 className='text-4xl font-bold text-zinc-900 mb-2'>New Session</h1>
          <p className='text-zinc-600'>
            Pick an example app, upload a ZIP, or connect a GitHub repository
          </p>
        </div>

        <div className='bg-white rounded-xl p-8 shadow-sm'>
          <div className='flex gap-2 mb-8 border-b border-zinc-200'>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setMode(tab.key)}
                className={`px-6 py-3 font-medium transition-colors ${
                  mode === tab.key
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className='mb-6 p-4 bg-red-50 border border-red-200 rounded-lg'>
              <p className='text-red-600 text-sm'>{error}</p>
            </div>
          )}

          <div className='mb-6 border border-zinc-200 rounded-lg'>
            <button
              onClick={() => setPoliciesExpanded(!policiesExpanded)}
              className='w-full px-6 py-4 flex items-center justify-between text-left hover:bg-zinc-50 transition-colors'
            >
              <span className='font-semibold text-zinc-900'>Policies</span>
              <svg
                className={`w-5 h-5 text-zinc-500 transition-transform ${policiesExpanded ? 'rotate-180' : ''}`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>

            {policiesExpanded && (
              <div className='px-6 pb-6 space-y-6'>
                <div>
                  <h3 className='text-sm font-semibold text-zinc-700 mb-3'>Quick Add</h3>
                  <div className='flex flex-wrap gap-2'>
                    {policyPresets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleAddPreset(preset)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          preset.category === 'validation'
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  {configuringPreset && (
                    <div className='mt-4 p-4 bg-zinc-50 border border-zinc-200 rounded-lg'>
                      <h4 className='text-sm font-semibold text-zinc-900 mb-2'>
                        Configure: {configuringPreset.name}
                      </h4>
                      <p className='text-xs text-zinc-600 mb-3'>{configuringPreset.description}</p>
                      {configuringPreset.configFields?.map((field) => (
                        <div key={field.key} className='mb-3'>
                          <label className='block text-xs font-medium text-zinc-700 mb-1'>
                            {field.label}
                          </label>
                          <input
                            type='text'
                            value={presetConfigValues[field.key] || ''}
                            onChange={(e) =>
                              setPresetConfigValues((prev) => ({
                                ...prev,
                                [field.key]: e.target.value,
                              }))
                            }
                            placeholder={field.placeholder}
                            className='w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                          />
                        </div>
                      ))}
                      <div className='flex gap-2'>
                        <button
                          onClick={handleConfirmPreset}
                          className='px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors'
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setConfiguringPreset(null);
                            setPresetConfigValues({});
                          }}
                          className='px-4 py-2 bg-zinc-200 text-zinc-700 rounded-lg text-sm font-medium hover:bg-zinc-300 transition-colors'
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className='text-sm font-semibold text-zinc-700 mb-3'>Policies</h3>
                  <div className='flex gap-2 mb-3'>
                    <input
                      type='text'
                      value={customPolicyInput}
                      onChange={(e) => setCustomPolicyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCustomPolicy()}
                      placeholder='Add custom policy directive...'
                      className='flex-1 px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
                    />
                    <button
                      onClick={handleAddCustomPolicy}
                      disabled={!customPolicyInput.trim()}
                      className='px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                    >
                      Add
                    </button>
                  </div>
                  {policies.length > 0 && (
                    <div className='flex flex-wrap gap-2'>
                      {policies.map((policy) => (
                        <span
                          key={policy.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                            policy.type === 'rego'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-violet-100 text-violet-700'
                          }`}
                        >
                          {policy.name}
                          <button
                            onClick={() => handleRemovePolicy(policy.id)}
                            className={`rounded-full p-0.5 ${
                              policy.type === 'rego'
                                ? 'hover:bg-emerald-200'
                                : 'hover:bg-violet-200'
                            }`}
                          >
                            <svg className='w-3 h-3' fill='currentColor' viewBox='0 0 20 20'>
                              <path
                                fillRule='evenodd'
                                d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                                clipRule='evenodd'
                              />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {mode === 'examples' && (
            <div className='grid gap-4'>
              {examples.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => handleExample(ex.id)}
                  disabled={loading}
                  className='text-left p-5 border border-zinc-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  <div className='flex items-start justify-between'>
                    <div className='flex-1'>
                      <p className='font-semibold text-zinc-900 text-lg'>{ex.name}</p>
                      <p className='text-sm text-zinc-500 mt-1'>{ex.description}</p>
                      <div className='flex flex-wrap gap-2 mt-3'>
                        {ex.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${tagColor(tag)}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <svg
                      className='w-5 h-5 text-zinc-400 mt-1 shrink-0'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M9 5l7 7-7 7'
                      />
                    </svg>
                  </div>
                </button>
              ))}
              {examples.length === 0 && !loading && (
                <p className='text-zinc-400 text-center py-8'>Loading examples...</p>
              )}
            </div>
          )}

          {mode === 'upload' && (
            <div className='space-y-6'>
              <FileUpload onFileSelect={setSelectedFile} />
              {selectedFile && (
                <div className='flex items-center justify-between p-4 bg-zinc-50 rounded-lg'>
                  <div className='flex items-center gap-3'>
                    <svg className='w-8 h-8 text-zinc-400' fill='currentColor' viewBox='0 0 20 20'>
                      <path d='M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z' />
                    </svg>
                    <div>
                      <p className='font-medium text-zinc-900'>{selectedFile.name}</p>
                      <p className='text-sm text-zinc-500'>
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className='p-2 hover:bg-zinc-200 rounded-lg transition-colors'
                  >
                    <svg
                      className='w-5 h-5 text-zinc-500'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>
              )}
              <button
                onClick={handleUpload}
                disabled={!selectedFile || loading}
                className='w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {loading ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          )}

          {mode === 'github' && (
            <div className='space-y-6'>
              <div>
                <label className='block text-sm font-medium text-zinc-700 mb-2'>
                  Repository URL
                </label>
                <input
                  type='text'
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder='https://github.com/user/repo'
                  className='w-full px-4 py-3 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-zinc-700 mb-2'>
                  Branch / Ref (optional)
                </label>
                <input
                  type='text'
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder='main'
                  className='w-full px-4 py-3 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
              </div>
              <button
                onClick={handleGitHub}
                disabled={!repoUrl || loading}
                className='w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {loading ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
