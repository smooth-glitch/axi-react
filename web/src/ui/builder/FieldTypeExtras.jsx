import React from 'react';
import styled from 'styled-components';
import { CloudDownload, ListPlus, Sparkles } from 'lucide-react';
import { Badge, FieldLabel, Input, Select, SwitchField } from '../kit';
import { optionList } from '../../core/builderModel';
import { COUNTRIES } from '../../core/validation';

const Pair = styled.div`
  display: flex;
  gap: ${(p) => p.theme.spacing.md}px;
  & > * { flex: 1; min-width: 0; }
`;

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${(p) => p.theme.spacing.xs}px;
  margin-top: ${(p) => p.theme.spacing.sm}px;
`;

// Type-specific inputs (min/max, options, apiUrl, fill source, country...) shown in the field editor.
export default function FieldTypeExtras({ draft, onChange, allDrafts }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  switch (draft.type) {
    case 'wholeNumber':
    case 'number':
      return (
        <div>
          <FieldLabel hint="Optional limits">Allowed range</FieldLabel>
          <Pair>
            <Input placeholder="Min" inputMode="numeric" value={String(draft.min ?? '')} onChangeText={(v) => set({ min: v })} />
            <Input placeholder="Max" inputMode="numeric" value={String(draft.max ?? '')} onChangeText={(v) => set({ max: v })} />
          </Pair>
        </div>
      );
    case 'date':
    case 'time': {
      const ph = draft.type === 'date' ? 'YYYY-MM-DD' : 'HH:MM';
      return (
        <div>
          <FieldLabel hint={`Optional limits, format ${ph}`}>Allowed range</FieldLabel>
          <Pair>
            <Input placeholder={`Min ${ph}`} value={draft.min || ''} onChangeText={(v) => set({ min: v })} />
            <Input placeholder={`Max ${ph}`} value={draft.max || ''} onChangeText={(v) => set({ max: v })} />
          </Pair>
        </div>
      );
    }
    case 'list': {
      const opts = optionList(draft);
      return (
        <div>
          <FieldLabel required hint="Separate with commas">
            Options
          </FieldLabel>
          <Input icon={ListPlus} placeholder="e.g. Full-time, Contract" value={draft.options || ''} onChangeText={(v) => set({ options: v })} />
          {opts.length ? (
            <Chips>
              {opts.map((o, i) => (
                <Badge key={`${o}${i}`} tone="primary">
                  {o}
                </Badge>
              ))}
            </Chips>
          ) : null}
        </div>
      );
    }
    case 'selection':
      return (
        <div>
          <FieldLabel required hint="Must return a JSON array of strings or objects">
            API URL
          </FieldLabel>
          <Input icon={CloudDownload} placeholder="https://..." autoCapitalize="none" value={draft.apiUrl || ''} onChangeText={(v) => set({ apiUrl: v })} />
        </div>
      );
    case 'fill': {
      const sources = allDrafts.filter((d) => d.type === 'selection' && d.label.trim());
      return (
        <div>
          <FieldLabel required hint="This field shows data from the item chosen there">
            Fills from
          </FieldLabel>
          <Select
            value={draft.sourceKey}
            onChange={(v) => set({ sourceKey: v })}
            options={sources.map((d) => ({ value: d.key, label: d.label }))}
            placeholder={sources.length ? 'Choose a selection field' : 'Add a named selection field first'}
            icon={Sparkles}
          />
          <FieldLabel hint="Leave empty to use the item's label">Property to show</FieldLabel>
          <Input placeholder="e.g. email" autoCapitalize="none" value={draft.sourceProp || ''} onChangeText={(v) => set({ sourceProp: v })} />
        </div>
      );
    }
    case 'mobile':
      return (
        <div>
          <SwitchField label="Show country picker" hint="Let the person choose the country code" value={!!draft.countryPicker} onValueChange={(v) => set({ countryPicker: v })} />
          <FieldLabel>Default country</FieldLabel>
          <Select value={draft.defaultCountry || 'US'} onChange={(v) => set({ defaultCountry: v || 'US' })} options={COUNTRIES} placeholder="Default country" />
        </div>
      );
    default:
      return null;
  }
}
