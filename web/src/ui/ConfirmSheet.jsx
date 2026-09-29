import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Alert, Button, Sheet, Text } from './kit';

// "Are you sure?" sheet for destructive actions. onConfirm may be async; a thrown error is shown inside the sheet.
export default function ConfirmSheet({ visible, title, message, confirmLabel = 'Delete', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(e?.message || 'Something went wrong.');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title}
      testID="confirm-sheet"
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={close} disabled={busy} />
          <Button title={confirmLabel} icon={Trash2} variant="danger" onPress={confirm} loading={busy} testID="confirm-delete" />
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <Text $variant="body" style={{ whiteSpace: 'pre-wrap' }}>
        {message}
      </Text>
    </Sheet>
  );
}
