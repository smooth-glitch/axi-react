import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { listStructs } from '../core/api';

const StructsContext = createContext({ structs: null, error: null, refresh: () => {} });
export const useStructs = () => useContext(StructsContext);

// Shared struct list for the sidebar and the home / definitions pages. Call refresh() after creating a struct or record.
export function StructsProvider({ children }) {
  const [structs, setStructs] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    return listStructs()
      .then(setStructs)
      .catch((e) => {
        setError(e.message);
        setStructs((cur) => cur || []);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <StructsContext.Provider value={{ structs, error, refresh }}>{children}</StructsContext.Provider>;
}
