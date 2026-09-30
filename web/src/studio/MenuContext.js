import { createContext, useContext } from 'react';

// Lets pages show a "menu" button when the struct menu is hidden (narrow window or collapsed).
// `toggle` is null outside the Shell (embeds), so no button renders there. `close` is set when hosted in a modal.
export const MenuContext = createContext({ visible: true, toggle: null, close: null });
// Element that side panels (ui/kit Sheet) render into so they stay inside the studio frame (e.g. the Org Structures
// modal) instead of covering the whole page. null = standalone: sheets portal to <body>.
export const SheetHostContext = createContext(null);
export const useMenu = () => useContext(MenuContext);
