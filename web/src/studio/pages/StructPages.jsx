import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTheme } from 'styled-components';
import { Save } from 'lucide-react';
import Page from '../Page';
import StructBuilder from '../../ui/builder/StructBuilder';
import { Alert, Button, Skeleton, useToast } from '../../ui/kit';
import { createStruct, getStruct, updateStruct } from '../../core/api';
import { buildStructPayload, structToDrafts } from '../../core/builderModel';
import { useStructs } from '../StructsContext';

const counts = (fields, sections) => `${fields.length} field${fields.length === 1 ? '' : 's'}${sections.length ? ` · ${sections.length} section${sections.length === 1 ? '' : 's'}` : ''}`;

// New struct: build the definition, save, then open the form screen separately.
export function NewStruct() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useStructs();
  const [name, setName] = useState('');
  const [structKey, setStructKey] = useState('');
  const [fields, setFields] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const { payload, error: err } = buildStructPayload(name, fields, sections, structKey);
    if (err) return setError(err);
    setError(null);
    setSaving(true);
    try {
      const { structId } = await createStruct(payload);
      refresh();
      toast.show({ title: 'Struct saved', message: `${payload.name} created — try filling it in.` });
      navigate(`/structs/${structId}/form`, { replace: true });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Page
      title="New struct"
      subtitle={counts(fields, sections)}
      onBack
      width="form"
      footer={<Button title="Save struct" icon={Save} onPress={save} loading={saving} testID="save-struct" />}
    >
      <StructBuilder name={name} setName={setName} structKey={structKey} setStructKey={setStructKey} fields={fields} setFields={setFields} sections={sections} setSections={setSections} error={error} nameError={error && !name.trim()} />
    </Page>
  );
}

// Edit struct: the builder pre-filled from a saved definition. Existing field ids are preserved so saved records stay valid.
export function EditStruct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useTheme();
  const toast = useToast();
  const { structs, refresh } = useStructs();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [structKey, setStructKey] = useState('');
  const [fields, setFields] = useState([]);
  const [sections, setSections] = useState([]);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    getStruct(id)
      .then((s) => {
        const d = structToDrafts(s);
        setName(d.name);
        setStructKey(d.key);
        setFields(d.fields);
        setSections(d.sections);
        setLoaded(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const recordCount = structs?.find((s) => s.id === id || s.key === id)?.recordCount ?? 0;
  const back = () => navigate(-1);

  const save = async () => {
    const { payload, error: err } = buildStructPayload(name, fields, sections, structKey);
    if (err) return setError(err);
    setError(null);
    setSaving(true);
    try {
      await updateStruct(id, payload);
      refresh();
      toast.show({ title: 'Definition updated', message: `${payload.name} saved.` });
      navigate('/structs', { replace: true });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Page
      title={loaded ? `Edit ${name || 'struct'}` : 'Edit struct'}
      subtitle={loaded ? counts(fields, sections) : undefined}
      onBack={back}
      width="form"
      footer={
        loaded ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: t.spacing.md }}>
            <Button title="Discard" variant="secondary" onPress={back} />
            <Button title="Save changes" icon={Save} onPress={save} loading={saving} testID="save-struct" />
          </div>
        ) : null
      }
    >
      <Alert onRetry={load}>{loadError}</Alert>
      {!loaded && !loadError ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.spacing.lg }}>
          <Skeleton $height={110} $radius={t.radius.xl} />
          <Skeleton $height={260} $radius={t.radius.xl} />
        </div>
      ) : null}
      {loaded ? (
        <>
          {recordCount > 0 ? (
            <Alert tone="warning">{`This struct already has ${recordCount} record${recordCount === 1 ? '' : 's'}. Renaming fields is safe. Removing a field hides its saved values, and changing a field's type may make old values invalid.`}</Alert>
          ) : null}
          <StructBuilder name={name} setName={setName} structKey={structKey} setStructKey={setStructKey} fields={fields} setFields={setFields} sections={sections} setSections={setSections} error={error} nameError={error && !name.trim()} />
        </>
      ) : null}
    </Page>
  );
}
