// Public API of @tstruct/react - what a host application imports.
//
//   import { configure, TstructProvider, StructForm, RecordList } from '@tstruct/react';
//
export { StructForm, RecordList } from '../ui/StructForm';
export { TstructProvider } from '../ui/Provider';
export { default as DynamicForm } from '../ui/DynamicForm';

// Options (standalone configurable actions) - self-contained screens, no router needed
export { OptionsList, OptionBuilder, OptionRun } from '../ui/options';

// The whole studio (sidebar + builder + records + options) as one mountable component - its own in-memory
// routing, scoped styles, no GlobalStyle. Give it an explicit height. See StudioApp.jsx.
export { TstructStudio } from '../StudioApp';

// API client (configure once; every call accepts a struct id or key)
export { configure, getConfig, listStructs, getStruct, createStruct, updateStruct, listRecords, getRecord, createRecord, updateRecord, listOptions, getOption, createOption, updateOption, deleteOption, listFiles, uploadFile, downloadFile } from '../core/api';

// Framework-free logic, handy for hosts that build their own UI
export { evaluateCondition, isFieldVisible } from '../core/conditions';
export { validateField } from '../core/validation';
export { buildTheme } from '../core/tokens';
