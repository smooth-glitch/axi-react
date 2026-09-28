import React, { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Page from '../Page';
import { Button, useToast } from '../../ui/kit';
import { OptionBuilder, OptionRun, OptionsList } from '../../ui/options';

// Thin route wrappers: the screens themselves (ui/options/*) are self-contained and know nothing about the router.

// /options — list
export function OptionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [count, setCount] = useState(null);
  return (
    <Page
      title="Options"
      subtitle={count === null ? 'Loading…' : `${count} option${count === 1 ? '' : 's'}`}
      actions={<Button title="New option" icon={Plus} onPress={() => navigate('/options/new')} testID="new-option" />}
    >
      <OptionsList
        onNew={() => navigate('/options/new')}
        onEdit={(o) => navigate(`/options/${o.id}/edit`)}
        onRun={(o) => navigate(`/options/${o.id}/run`)}
        onLoaded={(list) => setCount(list.length)}
        onDeleted={(o) => toast.show({ title: 'Option deleted', message: `“${o.caption}” was removed.` })}
      />
    </Page>
  );
}

// /options/new and /options/:optionId/edit
export function OptionBuilderPage({ mode }) {
  const { optionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = mode === 'new';
  const [caption, setCaption] = useState(null);
  const back = () => navigate('/options', { replace: true });
  return (
    <Page title={isNew ? 'New option' : caption ? `Edit ${caption}` : 'Edit option'} subtitle="A standalone, configurable action" onBack={() => navigate(-1)} width="form">
      <OptionBuilder
        optionId={isNew ? undefined : optionId}
        onLoaded={(o) => setCaption(o.caption)}
        onCancel={() => navigate(-1)}
        onSaved={(o, { isNew: created }) => {
          toast.show({ title: created ? 'Option created' : 'Option updated', message: `“${o.caption}” saved.` });
          back();
        }}
      />
    </Page>
  );
}

// /options/:optionId/run
export function OptionRunPage() {
  const { optionId } = useParams();
  const navigate = useNavigate();
  const [caption, setCaption] = useState(null);
  // dataInput: open the linked struct's form (replace, so Back returns to the options list)
  const openStruct = useCallback((s) => navigate(`/structs/${s.id}/form`, { replace: true }), [navigate]);
  return (
    <Page title={caption || 'Run option'} subtitle="Running an option" onBack={() => navigate('/options')} width="form">
      <OptionRun optionId={optionId} onLoaded={(o) => setCaption(o.caption)} onOpenStruct={openStruct} onEdit={(o) => navigate(`/options/${o.id}/edit`)} />
    </Page>
  );
}
