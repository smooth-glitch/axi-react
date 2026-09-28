import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { CheckCircle2, Download, FileText, Hourglass, Pencil, RotateCcw, Upload, Wrench } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, IconTile, Skeleton, Text } from '../kit';
import { StructForm } from '../StructForm';
import { iconFor } from '../icons';
import { Ensure } from '../Provider';
import { downloadFile, getOption, listStructs, uploadFile } from '../../core/api';
import { optionType } from '../../core/options';
import { formatBytes } from '../../core/format';

const Drop = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.xxl}px ${(p) => p.theme.spacing.lg}px;
  border: 2px dashed ${(p) => (p.$over ? p.theme.primary : p.theme.borderStrong)};
  border-radius: ${(p) => p.theme.radius.xl}px;
  background: ${(p) => (p.$over ? p.theme.primarySoft : p.theme.surface)};
  text-align: center;
  transition: all ${(p) => p.theme.motion.fast}ms ease;
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  gap: ${(p) => p.theme.spacing.lg}px;
  padding: ${(p) => p.theme.spacing.sm}px 0;
  border-bottom: 1px solid ${(p) => p.theme.border};
  &:last-child { border-bottom: 0; }
`;

const Result = ({ title, children, actions }) => {
  const t = useTheme();
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: t.motion.s(t.motion.base) }}>
      <Card style={{ padding: t.spacing.xl, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: t.spacing.sm }}>
        <CheckCircle2 size={40} color={t.success} strokeWidth={1.6} />
        <Text $variant="heading">{title}</Text>
        {children}
        {actions ? <div style={{ display: 'flex', gap: t.spacing.md, flexWrap: 'wrap', justifyContent: 'center', marginTop: t.spacing.md }}>{actions}</div> : null}
      </Card>
    </motion.div>
  );
};

/* ----------------------------------------------------------------------------- functional types */

// dataInput: look the struct up by name, then open its form.
function RunDataInput({ option, onOpenStruct, onEdit }) {
  const t = useTheme();
  const name = option.config.structName;
  const [state, setState] = useState({ status: 'looking' }); // looking | notfound | inline | opened | submitted | error
  // keep the latest callback in a ref so an inline arrow function from the host can't re-trigger the lookup on every render
  const openRef = useRef(onOpenStruct);
  openRef.current = onOpenStruct;
  const run = useCallback(() => {
    setState({ status: 'looking' });
    listStructs()
      .then((structs) => {
        const n = name.trim().toLowerCase();
        const found = structs.find((s) => s.name.trim().toLowerCase() === n) || structs.find((s) => s.key && s.key.toLowerCase() === n);
        if (!found) return setState({ status: 'notfound' });
        if (openRef.current) {
          setState({ status: 'opened', struct: found });
          openRef.current(found); // the host / studio decides how to show the form (e.g. navigate to /structs/:id/form)
        } else setState({ status: 'inline', struct: found });
      })
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [name]);
  useEffect(() => {
    run();
  }, [run]);

  if (state.status === 'looking' || state.status === 'opened')
    return (
      <div data-testid="run-looking" style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.md }}>
        <Text $variant="body" $color="textMuted">
          Opening the “{name}” form…
        </Text>
        <Skeleton $height={56} />
        <Skeleton $height={56} />
      </div>
    );
  if (state.status === 'error') return <Alert onRetry={run}>{state.message}</Alert>;
  if (state.status === 'notfound')
    return (
      <div data-testid="struct-not-found">
        <EmptyState
          icon={Hourglass}
          title="Struct not found"
          message={`No struct named “${name}” exists. Check the name in this option, or create a struct with that name.`}
          actionLabel={onEdit ? 'Edit this option' : undefined}
          actionIcon={Pencil}
          onAction={() => onEdit(option)}
        />
      </div>
    );
  if (state.status === 'submitted')
    return (
      <div data-testid="inline-submitted">
        <Result title="Record saved" actions={<Button title="Fill in another" variant="secondary" onPress={() => setState({ status: 'inline', struct: state.struct })} />}>
          <Text $variant="body" $color="textMuted">
            Your {state.struct.name} record was submitted.
          </Text>
        </Result>
      </div>
    );
  return <StructForm struct={state.struct.id} onSubmitted={() => setState({ status: 'submitted', struct: state.struct })} />;
}

// download: fetch the stored file and save it to the user's device.
function RunDownload({ option }) {
  const t = useTheme();
  const [state, setState] = useState({ status: 'working' }); // working | done | error
  const started = useRef(false);
  const run = useCallback(() => {
    setState({ status: 'working' });
    downloadFile(option.config.fileId)
      .then((r) => setState({ status: 'done', ...r }))
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [option.config.fileId]);
  useEffect(() => {
    if (started.current) return; // run once when the screen opens
    started.current = true;
    run();
  }, [run]);

  if (state.status === 'working')
    return (
      <Text $variant="body" $color="textMuted" data-testid="download-working">
        Downloading…
      </Text>
    );
  if (state.status === 'error') return <Alert onRetry={run}>{state.message}</Alert>;
  return (
    <div data-testid="download-done">
      <Result
        title="Download started"
        actions={<Button title="Download again" variant="secondary" icon={RotateCcw} onPress={run} testID="download-again" />}
      >
        <Text $variant="body" $color="textMuted">
          {state.name} · {formatBytes(state.size)} — check your browser's downloads.
        </Text>
      </Result>
    </div>
  );
}

// upload: pick a file, POST it to /api/files, show the resulting fileId.
function RunUpload() {
  const t = useTheme();
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [state, setState] = useState({ status: 'idle' }); // idle | uploading | done | error
  const [dl, setDl] = useState(null);

  const send = async (file) => {
    if (!file) return;
    setState({ status: 'uploading', name: file.name });
    setDl(null);
    try {
      const { fileId, file: meta } = await uploadFile(file);
      setState({ status: 'done', fileId, meta });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const picker = (
    <input ref={input} type="file" data-testid="run-file-input" style={{ display: 'none' }} onChange={(e) => send(e.target.files?.[0])} />
  );

  if (state.status === 'done')
    return (
      <div data-testid="upload-done">
        {picker}
        <Result
          title="File uploaded"
          actions={
            <>
              <Button title="Download it back" icon={Download} onPress={() => downloadFile(state.fileId).then(setDl).catch((e) => setState({ status: 'error', message: e.message }))} testID="download-back" />
              <Button title="Upload another" variant="secondary" icon={Upload} onPress={() => setState({ status: 'idle' })} testID="upload-another" />
            </>
          }
        >
          <Text $variant="body">
            {state.meta.originalName} · {formatBytes(state.meta.size)}
          </Text>
          <Text $variant="small" $color="textMuted">
            File ID
          </Text>
          <code data-testid="uploaded-file-id" style={{ padding: `${t.spacing.xs}px ${t.spacing.md}px`, borderRadius: t.radius.md, background: t.surfaceAlt, fontSize: t.type.small.size, wordBreak: 'break-all' }}>
            {state.fileId}
          </code>
          {dl ? (
            <Text $variant="small" $color="success" data-testid="downloaded-back">
              Downloaded “{dl.name}” ({formatBytes(dl.size)})
            </Text>
          ) : null}
        </Result>
      </div>
    );

  return (
    <div>
      {picker}
      <Alert>{state.status === 'error' ? state.message : null}</Alert>
      <Drop
        data-testid="upload-drop"
        $over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files?.[0]);
        }}
      >
        <IconTile icon={Upload} size={48} />
        <Text $variant="title">{state.status === 'uploading' ? `Uploading ${state.name}…` : 'Choose a file to upload'}</Text>
        <Text $variant="small" $color="textMuted">
          Drag a file here, or pick one from your device.
        </Text>
        <Button title="Choose file" icon={FileText} onPress={() => input.current?.click()} loading={state.status === 'uploading'} testID="choose-file" />
      </Drop>
    </div>
  );
}

// apiDisplay / pay / axpertOption: configuration only in this version.
function RunPlaceholder({ option, onEdit }) {
  const t = useTheme();
  const ty = optionType(option.type);
  const rows = Object.entries(option.config || {});
  return (
    <div data-testid="not-wired">
      <EmptyState
        icon={Wrench}
        title="This option type isn't wired up yet"
        message={`“${ty.label}” options can be configured and saved, but running them isn't available in this version.`}
        actionLabel={onEdit ? 'Edit this option' : undefined}
        actionIcon={Pencil}
        onAction={() => onEdit(option)}
      />
      {rows.length ? (
        <Card style={{ padding: t.spacing.lg, maxWidth: 520, margin: '0 auto' }}>
          <Text $variant="label" $color="textMuted" style={{ marginBottom: t.spacing.sm }}>
            SAVED CONFIGURATION
          </Text>
          {rows.map(([k, v]) => (
            <Row key={k}>
              <Text $variant="small" $color="textMuted">
                {k}
              </Text>
              <Text $variant="small" style={{ textAlign: 'right', wordBreak: 'break-word' }}>
                {String(v) || '—'}
              </Text>
            </Row>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function OptionRunInner({ optionId, option: given, onOpenStruct, onEdit, onLoaded }) {
  const t = useTheme();
  const [option, setOption] = useState(given || null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    if (given) return;
    setError(null);
    getOption(optionId)
      .then((o) => {
        setOption(o);
        onLoaded?.(o);
      })
      .catch((e) => setError(e.message));
  }, [optionId, given]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Alert onRetry={load}>{error}</Alert>;
  if (!option) return <Skeleton $height={120} $radius={t.radius.xl} />;

  const ty = optionType(option.type);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing.md, marginBottom: t.spacing.lg }}>
        <IconTile icon={iconFor(ty.icon)} tone={ty.functional ? 'primary' : 'neutral'} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text $variant="heading" $ellipsis>
            {option.caption}
          </Text>
          <div style={{ display: 'flex', gap: t.spacing.xs, marginTop: 2 }}>
            <Badge tone={ty.functional ? 'primary' : 'neutral'}>{ty.label}</Badge>
            {ty.functional ? null : <Badge tone="warning">Config only</Badge>}
          </div>
        </div>
      </div>
      {option.type === 'dataInput' ? <RunDataInput option={option} onOpenStruct={onOpenStruct} onEdit={onEdit} /> : null}
      {option.type === 'download' ? <RunDownload option={option} /> : null}
      {option.type === 'upload' ? <RunUpload /> : null}
      {!ty.functional ? <RunPlaceholder option={option} onEdit={onEdit} /> : null}
    </div>
  );
}

/**
 * <OptionRun /> - runs an option. Self-contained: needs no router or app navigation.
 *   optionId | option   what to run
 *   dataInput  -> looks the struct up by name; calls onOpenStruct(struct) so the host can show its form
 *                 (without the callback the form is rendered inline)
 *   download   -> downloads the stored file to the user's device
 *   upload     -> file picker + POST /api/files, shows the resulting fileId
 *   apiDisplay / pay / axpertOption -> "not wired up yet"
 *   onEdit(option) adds an "Edit this option" button to the error / placeholder states;  onLoaded(option)
 */
export function OptionRun(props) {
  return (
    <Ensure>
      <OptionRunInner {...props} />
    </Ensure>
  );
}
