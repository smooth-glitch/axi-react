import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { Check, FileUp, FileText, Save } from 'lucide-react';
import ApplicableTo from './ApplicableTo';
import { Alert, Badge, Button, Card, FieldLabel, Input, Select, Skeleton, Text } from '../kit';
import { iconFor } from '../icons';
import { Ensure } from '../Provider';
import { createOption, getOption, listFiles, listStructs, updateOption, uploadFile } from '../../core/api';
import { AXPERT_SUBTYPES, DISPLAY_AS, OPTION_TYPES, applicableToDraft, applicableToError, applicableToPayload, defaultApplicableTo, optionType } from '../../core/options';
import { formatBytes } from '../../core/format';

const Bar = styled.div`
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  gap: ${(p) => p.theme.spacing.md}px;
  margin-top: ${(p) => p.theme.spacing.lg}px;
  padding: ${(p) => p.theme.spacing.md}px 0;
  background: ${(p) => p.theme.bg};
  box-shadow: 0 -12px 12px -8px ${(p) => p.theme.bg};
`;

const Section = ({ title, subtitle, children }) => {
  const t = useTheme();
  return (
    <Card style={{ padding: t.spacing.lg, marginBottom: t.spacing.lg }}>
      <Text $variant="title">{title}</Text>
      {subtitle ? (
        <Text $variant="small" $color="textMuted">
          {subtitle}
        </Text>
      ) : null}
      {children}
    </Card>
  );
};

const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px;
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => p.theme.surfaceAlt};
`;

// Config of a `download` option: upload a file here, or pick one uploaded earlier.
function FilePicker({ fileId, onPick }) {
  const t = useTheme();
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => listFiles().then(setFiles).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const current = files.find((f) => f.id === fileId);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const { file: meta } = await uploadFile(file);
      setFiles((cur) => [meta, ...cur]);
      onPick(meta.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <FieldLabel required hint="The file people download when they run this option">
        File
      </FieldLabel>
      {fileId ? (
        <FileRow data-testid="selected-file">
          <FileText size={20} color={t.primary} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text $variant="bodyStrong" $ellipsis>
              {current ? current.originalName : 'Selected file'}
            </Text>
            <Text $variant="caption" $color="textMuted">
              {current ? `${formatBytes(current.size)} · ${current.mimeType}` : fileId}
            </Text>
          </div>
          <Badge tone="success" icon={Check}>
            Attached
          </Badge>
        </FileRow>
      ) : (
        <Text $variant="small" $color="textMuted">
          No file attached yet.
        </Text>
      )}

      <div style={{ display: 'flex', gap: t.spacing.md, flexWrap: 'wrap', marginTop: t.spacing.md, alignItems: 'center' }}>
        <input ref={input} type="file" data-testid="option-file-input" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
        <Button title={fileId ? 'Upload a different file' : 'Upload a file'} icon={FileUp} variant="secondary" loading={busy} onPress={() => input.current?.click()} testID="upload-file-btn" />
        {files.length > 0 ? (
          <div style={{ flex: 1, minWidth: 220 }}>
            <Select
              testID="pick-file"
              value={fileId || undefined}
              onChange={(v) => v && onPick(v)}
              placeholder="…or pick a file uploaded earlier"
              options={files.map((f) => ({ value: f.id, label: `${f.originalName} (${formatBytes(f.size)})` }))}
            />
          </div>
        ) : null}
      </div>
      {err ? (
        <Text $variant="small" $color="danger" style={{ marginTop: t.spacing.sm }}>
          {err}
        </Text>
      ) : null}
    </div>
  );
}

const emptyConfig = { structName: '', fileId: '', apiName: '', displayAs: 'table', paymentConfig: '', subtype: 'tstruct', target: '' };

// Config fields that belong to a type -> the `config` object sent to the API.
function buildConfig(type, c) {
  switch (type) {
    case 'dataInput':
      return { structName: c.structName.trim() };
    case 'download':
      return { fileId: c.fileId };
    case 'upload':
      return {};
    case 'apiDisplay':
      return { apiName: c.apiName.trim(), displayAs: c.displayAs };
    case 'pay':
      return { paymentConfig: c.paymentConfig };
    case 'axpertOption':
      return { subtype: c.subtype, target: c.target.trim() };
    default:
      return {};
  }
}

function TypeConfig({ type, config, set, structNames }) {
  const t = useTheme();
  switch (type) {
    case 'dataInput':
      return (
        <div>
          <FieldLabel required hint="Running the option opens this struct's form (looked up by name when it is run)">
            Struct name
          </FieldLabel>
          <Input testID="cfg-structName" list="tstruct-struct-names" placeholder="e.g. Leave Request" value={config.structName} onChangeText={(v) => set({ structName: v })} />
          <datalist id="tstruct-struct-names">
            {structNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      );
    case 'download':
      return <FilePicker fileId={config.fileId} onPick={(fileId) => set({ fileId })} />;
    case 'upload':
      return (
        <Text $variant="body" $color="textMuted" style={{ marginTop: t.spacing.md }}>
          No configuration needed. Running this option opens a file picker and uploads the chosen file.
        </Text>
      );
    case 'apiDisplay':
      return (
        <div>
          <FieldLabel hint="Configuration only for now — running it shows a 'not available yet' message">API name</FieldLabel>
          <Input testID="cfg-apiName" placeholder="e.g. leaveBalances" value={config.apiName} onChangeText={(v) => set({ apiName: v })} />
          <FieldLabel>Display as</FieldLabel>
          <Select testID="cfg-displayAs" value={config.displayAs} onChange={(v) => set({ displayAs: v || 'table' })} options={DISPLAY_AS} />
        </div>
      );
    case 'pay':
      return (
        <div>
          <FieldLabel hint="Placeholder text for now — no payment gateway is connected">Payment configuration</FieldLabel>
          <Input testID="cfg-paymentConfig" multiline placeholder="e.g. gateway=stripe; amount=10" value={config.paymentConfig} onChangeText={(v) => set({ paymentConfig: v })} />
        </div>
      );
    case 'axpertOption':
      return (
        <div>
          <FieldLabel hint="Placeholder for now — nothing is linked to a real Axpert module">Subtype</FieldLabel>
          <Select testID="cfg-subtype" value={config.subtype} onChange={(v) => set({ subtype: v || 'tstruct' })} options={AXPERT_SUBTYPES} />
          <FieldLabel>Target</FieldLabel>
          <Input testID="cfg-target" placeholder="e.g. the tstruct / iview / page name" value={config.target} onChangeText={(v) => set({ target: v })} />
        </div>
      );
    default:
      return null;
  }
}

function OptionBuilderInner({ optionId, onSaved, onCancel, onLoaded }) {
  const t = useTheme();
  const isNew = !optionId;
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState(null);
  const [caption, setCaption] = useState('');
  const [type, setType] = useState('dataInput');
  const [config, setConfig] = useState(emptyConfig);
  const [applicable, setApplicable] = useState(defaultApplicableTo());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [structNames, setStructNames] = useState([]);

  const load = useCallback(() => {
    if (!optionId) return;
    setLoading(true);
    setLoadError(null);
    getOption(optionId)
      .then((o) => {
        setCaption(o.caption);
        setType(o.type);
        setConfig({ ...emptyConfig, ...o.config });
        setApplicable(applicableToDraft(o.applicableTo));
        setLoading(false);
        onLoaded?.(o);
      })
      .catch((e) => {
        setLoadError(e.message);
        setLoading(false);
      });
  }, [optionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    // unique names only (struct names are not enforced unique, and they are used as React keys below)
    listStructs().then((s) => setStructNames([...new Set(s.map((x) => x.name))])).catch(() => {});
  }, []);

  const meta = optionType(type);
  const Icon = iconFor(meta.icon);

  const save = async () => {
    setError(null);
    if (!caption.trim()) return setError('Give the option a caption.');
    if (type === 'dataInput' && !config.structName.trim()) return setError('Enter the name of the struct this option should open.');
    if (type === 'download' && !config.fileId) return setError('Attach a file: upload one, or pick one uploaded earlier.');
    const aErr = applicableToError(applicable);
    if (aErr) return setError(aErr);
    setSaving(true);
    try {
      const payload = { caption: caption.trim(), type, config: buildConfig(type, config), applicableTo: applicableToPayload(applicable) };
      const res = isNew ? await createOption(payload) : await updateOption(optionId, payload);
      onSaved?.(res.option, { isNew });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || loadError)
    return (
      <div>
        <Alert onRetry={load}>{loadError}</Alert>
        {!loadError ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.lg }}>
            <Skeleton $height={180} $radius={t.radius.xl} />
            <Skeleton $height={160} $radius={t.radius.xl} />
          </div>
        ) : null}
      </div>
    );

  return (
    <div>
      <Alert>{error}</Alert>

      <Section title="Details" subtitle="What this option is called and what it does">
        <FieldLabel hint={isNew ? 'Assigned automatically when you save' : 'Assigned automatically — cannot be changed'}>Option ID</FieldLabel>
        <Input testID="option-id" editable={false} value={isNew ? '' : optionId} placeholder="Assigned when you save" />
        <FieldLabel required>Caption</FieldLabel>
        <Input testID="option-caption" placeholder="e.g. Apply for leave" value={caption} onChangeText={setCaption} invalid={!!error && !caption.trim()} />
        <FieldLabel required>Option type</FieldLabel>
        <Select testID="option-type" icon={Icon} value={type} onChange={(v) => v && setType(v)} options={OPTION_TYPES.map((o) => ({ value: o.value, label: `${o.label}${o.functional ? '' : ' (config only)'}` }))} />
        <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
          <Badge tone={meta.functional ? 'success' : 'neutral'}>{meta.functional ? 'Works when run' : 'Config only for now'}</Badge>
          <Text $variant="caption" $color="textMuted">
            {meta.hint}
          </Text>
        </div>
      </Section>

      <Section title="Configuration" subtitle={`Settings for the “${meta.label}” type`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={type} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: t.motion.s(t.motion.fast + 40) }}>
            <TypeConfig type={type} config={config} set={(patch) => setConfig((c) => ({ ...c, ...patch }))} structNames={structNames} />
          </motion.div>
        </AnimatePresence>
      </Section>

      <Section title="Applicable to" subtitle="Who this option is for">
        <ApplicableTo value={applicable} onChange={setApplicable} />
      </Section>

      <Bar>
        {onCancel ? <Button title="Cancel" variant="secondary" onPress={onCancel} testID="option-cancel" /> : null}
        <Button title={isNew ? 'Save option' : 'Save changes'} icon={Save} onPress={save} loading={saving} testID="save-option" />
      </Bar>
    </div>
  );
}

/**
 * <OptionBuilder /> - create (no optionId) or edit an option. Self-contained: needs no router or app navigation.
 *   optionId   edit this option; omit to create a new one
 *   onSaved    (option, { isNew }) => void
 *   onCancel   () => void   shows a Cancel button
 *   onLoaded   (option) => void   (edit mode, after loading)
 */
export function OptionBuilder(props) {
  return (
    <Ensure>
      <OptionBuilderInner {...props} />
    </Ensure>
  );
}
