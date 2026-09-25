import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import { AlertCircle, CloudDownload, Crosshair, MapPin, WandSparkles } from 'lucide-react';
import { Button, FieldLabel, Input, Select, Text } from './kit';
import { iconFor } from './icons';
import { fetchSelectionItems } from '../core/api';
import { metaFor } from '../core/fieldTypes';
import { createLogger } from '../core/logger';
import { COUNTRIES } from '../core/validation';

const log = createLogger('field');

const LocBox = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px;
  border: 1px solid ${(p) => (p.$invalid ? p.theme.danger : p.theme.border)};
  border-radius: ${(p) => p.theme.radius.lg}px;
  background: ${(p) => p.theme.surface};
`;

const Pin = styled.div`
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: ${(p) => p.theme.radius.lg}px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$on ? p.theme.successSoft : p.theme.surfaceAlt)};
`;

function LocationInput({ value, onChange, invalid }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Browser Geolocation API (needs https or localhost, and the user's permission).
  const capture = () => {
    setBusy(true);
    setMsg(null);
    if (!navigator.geolocation) {
      setMsg('Geolocation is not supported by this browser.');
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        log.info('location captured', loc);
        onChange(loc);
        setBusy(false);
      },
      (err) => {
        log.error('location failed', { message: err.message });
        setMsg(err.code === 1 ? 'Location permission was denied. Allow it in the browser and try again.' : `Could not get your location (${err.message}).`);
        setBusy(false);
      },
      { timeout: 10000 }
    );
  };

  return (
    <LocBox $invalid={invalid}>
      <Pin $on={!!value}>
        <MapPin size={18} color={value ? t.success : t.textFaint} strokeWidth={1.9} />
      </Pin>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text $variant="bodyStrong">{value ? 'Location captured' : 'No location yet'}</Text>
        <Text $variant="caption" $color="textMuted">
          {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Uses your device / browser GPS'}
        </Text>
        {msg ? (
          <Text $variant="caption" $color="danger">
            {msg}
          </Text>
        ) : null}
      </div>
      <Button size="sm" variant="secondary" title={value ? 'Recapture' : 'Capture'} icon={Crosshair} onPress={capture} loading={busy} />
    </LocBox>
  );
}

function SelectionInput({ field, value, onChange, onHydrate, invalid }) {
  const t = useTheme();
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => {
    setErr(null);
    setItems(null);
    fetchSelectionItems(field.apiUrl)
      .then(setItems)
      .catch((e) => {
        let host = field.apiUrl;
        try {
          host = new URL(field.apiUrl).host;
        } catch (_) {
          /* keep the raw url */
        }
        setErr(`Could not load options from ${host} (${e.message}). Check that the URL is reachable and allows cross-origin requests.`);
      });
  }, [field.apiUrl]);
  useEffect(() => {
    load();
  }, [load]);
  // Editing: a stored value is pre-selected, so once the options arrive tell the form which item it is (needed by `fill` fields).
  useEffect(() => {
    if (items && value) {
      const it = items.find((i) => i.value === value);
      if (it && onHydrate) onHydrate(it);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <Select
        value={value}
        invalid={invalid}
        enabled={!!items}
        icon={CloudDownload}
        placeholder={items ? 'Select...' : err ? 'Unavailable' : 'Loading options...'}
        options={(items || []).map((i) => ({ value: i.value, label: i.label }))}
        onChange={(v) => onChange(v, (items || []).find((i) => i.value === v))}
      />
      {err ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'flex', alignItems: 'center', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
          <AlertCircle size={14} color={t.danger} style={{ flex: 'none' }} />
          <Text $variant="small" $color="danger" style={{ flex: 1 }}>
            {err}
          </Text>
          <Button title="Retry" size="sm" variant="secondary" onPress={load} />
        </motion.div>
      ) : null}
    </div>
  );
}

/**
 * Renders one field of a struct by type.
 * props: field, value, onChange(value, extra?), error, formData (for mobile country), fillValue (for fill fields)
 */
export default function DynamicField({ field, value, onChange, onHydrate, error, formData = {}, fillValue }) {
  const t = useTheme();
  const invalid = !!error;
  const Icon = iconFor(metaFor(field).icon);
  let control = null;
  switch (field.type) {
    case 'text':
      control = <Input icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} multiline={!!field.multiline} rows={4} />;
      break;
    case 'date':
    case 'time':
      control = <Input type={field.type} value={value ?? ''} onChangeText={onChange} invalid={invalid} min={field.min || undefined} max={field.max || undefined} />;
      break;
    case 'wholeNumber':
      control = <Input icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} inputMode="numeric" placeholder="0" />;
      break;
    case 'number':
      control = <Input icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} inputMode="decimal" placeholder="0.00" />;
      break;
    case 'email':
      control = <Input icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} inputMode="email" autoCapitalize="none" placeholder="name@example.com" />;
      break;
    case 'url':
      control = <Input icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} inputMode="url" autoCapitalize="none" placeholder="https://" />;
      break;
    case 'mobile':
      control = (
        <div style={{ display: 'flex', gap: t.spacing.sm }}>
          {field.countryPicker && (
            <Select
              style={{ width: 104 }}
              value={formData[`${field.id}__country`] || field.defaultCountry || 'US'}
              options={COUNTRIES}
              placeholder="Country"
              onChange={(c) => onChange(value ?? '', { country: c || field.defaultCountry || 'US' })}
            />
          )}
          <Input style={{ flex: 1 }} icon={Icon} value={value ?? ''} onChangeText={onChange} invalid={invalid} inputMode="tel" placeholder="Phone number" />
        </div>
      );
      break;
    case 'location':
      control = <LocationInput value={value} onChange={onChange} invalid={invalid} />;
      break;
    case 'list':
      control = <Select value={value} onChange={onChange} options={field.options || []} invalid={invalid} icon={Icon} />;
      break;
    case 'selection':
      control = <SelectionInput field={field} value={value} onChange={onChange} onHydrate={onHydrate} invalid={invalid} />;
      break;
    case 'fill':
      control = <Input icon={WandSparkles} value={fillValue ?? ''} editable={false} placeholder="Auto-filled from selection" />;
      break;
    default:
      control = (
        <Text $variant="small" $color="textMuted">
          Unsupported field type "{field.type}"
        </Text>
      );
  }
  return (
    <div>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      {control}
      {error ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: t.motion.s(t.motion.fast + 40) }}
          style={{ display: 'flex', alignItems: 'center', gap: t.spacing.xs, marginTop: t.spacing.xs + t.spacing.xxs }}
        >
          <AlertCircle size={13} color={t.danger} strokeWidth={2.2} style={{ flex: 'none' }} />
          <Text $variant="small" $color="danger" style={{ flex: 1 }}>
            {error}
          </Text>
        </motion.div>
      ) : null}
    </div>
  );
}
