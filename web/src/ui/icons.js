import { createElement } from 'react';
import {
  Boxes, Calculator, CalendarDays, ClipboardList, Clock3, CloudDownload, CreditCard, Download, Globe, Hash, Link2, ListFilter, Mail, MapPin, Smartphone, TextAlignStart, Type, Upload, WandSparkles,
} from 'lucide-react';

// Icon components by the names used in core/fieldTypes.js (keeps the core free of UI imports).
const byName = { Boxes, Calculator, CalendarDays, ClipboardList, Clock3, CloudDownload, CreditCard, Download, Globe, Hash, Link2, ListFilter, Mail, MapPin, Smartphone, TextAlignStart, Type, Upload, WandSparkles };

export const iconFor = (name) => byName[name] || Type;
export const FieldIcon = ({ name, ...props }) => createElement(iconFor(name), props);
