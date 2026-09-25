import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import styled, { useTheme } from 'styled-components';
import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import { Check, Crosshair, MapPin, Search, X } from 'lucide-react';
import { Button, IconButton, Input, Text } from './kit';
import { useWindowWidth } from './hooks';
import { createLogger } from '../core/logger';

const log = createLogger('map');

// Map pin picker (like Blinkit / Zomato): the pin stays in the middle of the map, the user drags the map underneath it,
// or searches an address, or taps "Use my current location". Confirming returns { lat, lng, address? }.
//
// Uses Leaflet with OpenStreetMap tiles (no API key). Address lookup / search use OpenStreetMap's Nominatim service
// (best effort: if it is unreachable the pin still works, only the address line is missing).
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const DEFAULT_VIEW = { lat: 20.5937, lng: 78.9629, zoom: 5 }; // India, when nothing else is known
const CLOSE_ZOOM = 17;

// Leaflet's own stylesheet, injected once (so hosts do not have to import a CSS file).
function useLeafletCss() {
  useEffect(() => {
    if (document.getElementById('tstruct-leaflet-css')) return;
    const el = document.createElement('style');
    el.id = 'tstruct-leaflet-css';
    el.textContent = leafletCss;
    document.head.appendChild(el);
  }, []);
}

const Layer = styled(motion.div)`
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.overlay};
  font-family: ${(p) => p.theme.fontFamily};
`;

const Dialog = styled(motion.div)`
  position: relative;
  display: flex;
  flex-direction: column;
  width: ${(p) => (p.$full ? '100%' : 'min(980px, calc(100vw - 48px))')};
  height: ${(p) => (p.$full ? '100%' : 'min(720px, calc(100vh - 48px))')};
  background: ${(p) => p.theme.surface};
  color: ${(p) => p.theme.text};
  border-radius: ${(p) => (p.$full ? 0 : p.theme.radius.xl)}px;
  box-shadow: ${(p) => p.theme.shadow.lg};
  overflow: hidden;
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.lg}px;
  border-bottom: 1px solid ${(p) => p.theme.border};
`;

const MapWrap = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  isolation: isolate; /* keeps Leaflet's high z-indexes inside the dialog */
  background: ${(p) => p.theme.surfaceAlt};
`;

const MapEl = styled.div`
  position: absolute;
  inset: 0;
  font-family: ${(p) => p.theme.fontFamily};
  .leaflet-container {
    font-family: inherit;
    background: ${(p) => p.theme.surfaceAlt};
  }
  .leaflet-control-attribution {
    font-size: 10px;
  }
`;

// The fixed pin in the middle of the map; it lifts while the map is being moved.
const PinWrap = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 500;
`;
const PinBody = styled.div`
  position: absolute;
  left: -20px;
  bottom: 0;
  width: 40px;
  height: 48px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  transition: transform 0.18s ease;
  transform: translateY(${(p) => (p.$lifted ? -14 : 0)}px);
  filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.3));
`;
const PinShadow = styled.div`
  position: absolute;
  left: -6px;
  top: -3px;
  width: 12px;
  height: 6px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  transition: transform 0.18s ease, opacity 0.18s ease;
  transform: scale(${(p) => (p.$lifted ? 0.6 : 1)});
  opacity: ${(p) => (p.$lifted ? 0.5 : 1)};
`;

const SearchBox = styled.div`
  position: absolute;
  top: ${(p) => p.theme.spacing.md}px;
  left: ${(p) => p.theme.spacing.md}px;
  right: ${(p) => p.theme.spacing.md}px;
  z-index: 600;
  max-width: 520px;
`;
const Results = styled.div`
  margin-top: 4px;
  background: ${(p) => p.theme.surface};
  border: 1px solid ${(p) => p.theme.border};
  border-radius: ${(p) => p.theme.radius.lg}px;
  box-shadow: ${(p) => p.theme.shadow.md};
  overflow: hidden;
`;
const Result = styled.button`
  display: flex;
  align-items: flex-start;
  gap: ${(p) => p.theme.spacing.sm}px;
  width: 100%;
  padding: ${(p) => p.theme.spacing.sm}px ${(p) => p.theme.spacing.md}px;
  border: 0;
  border-bottom: 1px solid ${(p) => p.theme.border};
  background: transparent;
  color: ${(p) => p.theme.text};
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:last-child {
    border-bottom: 0;
  }
  &:hover,
  &:focus-visible {
    background: ${(p) => p.theme.primarySoft};
    outline: none;
  }
`;

const LocateBtn = styled.button`
  position: absolute;
  right: ${(p) => p.theme.spacing.md}px;
  bottom: ${(p) => p.theme.spacing.md}px;
  z-index: 600;
  display: inline-flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.sm}px;
  height: 40px;
  padding: 0 ${(p) => p.theme.spacing.lg}px;
  border-radius: ${(p) => p.theme.radius.pill}px;
  border: 1px solid ${(p) => p.theme.primary};
  background: ${(p) => p.theme.surface};
  color: ${(p) => p.theme.primary};
  font: inherit;
  font-weight: ${(p) => p.theme.fontWeight.semibold};
  box-shadow: ${(p) => p.theme.shadow.md};
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.primarySoft};
  }
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const Foot = styled.div`
  display: flex;
  align-items: center;
  gap: ${(p) => p.theme.spacing.md}px;
  padding: ${(p) => p.theme.spacing.md}px ${(p) => p.theme.spacing.lg}px;
  border-top: 1px solid ${(p) => p.theme.border};
  flex-wrap: wrap;
`;

const round = (n) => Math.round(n * 1e6) / 1e6;

export default function MapPicker({ visible, initial, onCancel, onConfirm }) {
  useLeafletCss();
  const t = useTheme();
  const width = useWindowWidth();
  const full = width < t.layout.tableBreakpoint;

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <Layer key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <Dialog
            $full={full}
            role="dialog"
            aria-modal="true"
            aria-label="Choose location"
            data-testid="map-picker"
            initial={{ opacity: 0, y: 16, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            <PickerBody initial={initial} onCancel={onCancel} onConfirm={onConfirm} />
          </Dialog>
        </Layer>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function PickerBody({ initial, onCancel, onConfirm }) {
  const t = useTheme();
  const mapEl = useRef(null);
  const map = useRef(null);
  const [center, setCenter] = useState(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [moving, setMoving] = useState(false);
  const [address, setAddress] = useState(initial?.address || '');
  const [addrBusy, setAddrBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const skipFirstLookup = useRef(!!initial?.address); // keep the stored address until the pin is moved

  // Esc closes
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onCancel?.();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onCancel]);

  const locate = useCallback((silent) => {
    if (!navigator.geolocation) {
      if (!silent) setMsg('Location is not supported by this browser.');
      return;
    }
    setGeoBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        log.info('current location', { lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.current?.flyTo([pos.coords.latitude, pos.coords.longitude], CLOSE_ZOOM, { duration: 0.8 });
        setGeoBusy(false);
      },
      (err) => {
        log.warn('current location failed', { message: err.message });
        if (!silent) setMsg(err.code === 1 ? 'Location permission was denied. Allow it in the browser, or search / drag the map instead.' : `Could not get your location (${err.message}).`);
        setGeoBusy(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, []);

  // Create the Leaflet map once.
  useEffect(() => {
    const el = mapEl.current;
    if (!el) return undefined;
    const start = initial ? { lat: initial.lat, lng: initial.lng, zoom: CLOSE_ZOOM } : DEFAULT_VIEW;
    const m = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.5 }).setView([start.lat, start.lng], start.zoom);
    L.control.zoom({ position: 'bottomleft' }).addTo(m);
    const layer = L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(m);
    layer.on('tileerror', () => setTilesFailed(true));
    layer.on('tileload', () => setTilesFailed(false));
    m.on('movestart', () => setMoving(true));
    m.on('moveend', () => {
      setMoving(false);
      const c = m.wrapLatLng(m.getCenter());
      setCenter({ lat: c.lat, lng: c.lng });
    });
    map.current = m;
    const c0 = m.wrapLatLng(m.getCenter());
    setCenter({ lat: c0.lat, lng: c0.lng });
    setTimeout(() => m.invalidateSize(), 0); // the dialog animates in: measure again once it has its size
    if (!initial) locate(true); // nothing chosen yet: start at the user's location if the browser allows it
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Address of the pin (debounced, best effort).
  useEffect(() => {
    if (!center) return undefined;
    if (skipFirstLookup.current) {
      skipFirstLookup.current = false;
      return undefined;
    }
    const ctrl = new AbortController();
    setAddrBusy(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&lat=${center.lat}&lon=${center.lng}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setAddress(json.display_name || '');
      } catch (e) {
        if (e.name !== 'AbortError') {
          log.warn('reverse geocoding failed', { message: e.message });
          setAddress('');
        }
      } finally {
        if (!ctrl.signal.aborted) setAddrBusy(false);
      }
    }, 600);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [center]);

  // Address search (debounced).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults(null);
      return undefined;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setResults(await res.json());
      } catch (e) {
        if (e.name !== 'AbortError') {
          log.warn('search failed', { message: e.message });
          setResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 500);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const choose = (r) => {
    setResults(null);
    setQuery('');
    map.current?.flyTo([Number(r.lat), Number(r.lon)], CLOSE_ZOOM, { duration: 0.8 });
  };

  const confirm = () => {
    if (!center) return;
    onConfirm({ lat: round(center.lat), lng: round(center.lng), ...(address ? { address } : {}) });
  };

  return (
    <>
      <Head>
        <MapPin size={18} color={t.primary} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text $variant="title">Choose location</Text>
          <Text $variant="caption" $color="textMuted">
            Drag the map to place the pin, search for an address, or use your current location
          </Text>
        </div>
        <IconButton icon={X} label="Close map" onPress={onCancel} testID="map-cancel" />
      </Head>

      <MapWrap>
        <MapEl ref={mapEl} data-testid="map-canvas" />
        <PinWrap aria-hidden="true">
          <PinShadow $lifted={moving} />
          <PinBody $lifted={moving}>
            <MapPin size={44} color={t.primary} fill={t.primary} strokeWidth={1.4} style={{ marginTop: -2 }} />
          </PinBody>
        </PinWrap>

        <SearchBox>
          <Input icon={Search} placeholder="Search for an area, street or landmark" value={query} onChangeText={setQuery} testID="map-search" />
          {results ? (
            <Results data-testid="map-results">
              {results.length === 0 ? (
                <div style={{ padding: 12 }}>
                  <Text $variant="small" $color="textMuted">
                    {searching ? 'Searching…' : 'No places found'}
                  </Text>
                </div>
              ) : (
                results.map((r) => (
                  <Result key={r.place_id} type="button" onClick={() => choose(r)}>
                    <MapPin size={16} color={t.textMuted} style={{ flex: 'none', marginTop: 2 }} />
                    <Text $variant="small">{r.display_name}</Text>
                  </Result>
                ))
              )}
            </Results>
          ) : null}
        </SearchBox>

        <LocateBtn type="button" onClick={() => locate(false)} disabled={geoBusy} data-testid="map-use-current">
          <Crosshair size={16} />
          {geoBusy ? 'Locating…' : 'Use my current location'}
        </LocateBtn>
      </MapWrap>

      <Foot>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Text $variant="bodyStrong" data-testid="map-address">
            {address || (addrBusy ? 'Finding address…' : 'Pin location')}
          </Text>
          <Text $variant="caption" $color="textMuted">
            {center ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : '—'}
          </Text>
          {msg ? (
            <Text $variant="caption" $color="danger">
              {msg}
            </Text>
          ) : null}
          {tilesFailed ? (
            <Text $variant="caption" $color="warning">
              The map images could not be loaded (check your connection). You can still use your current location.
            </Text>
          ) : null}
        </div>
        <Button title="Cancel" variant="secondary" onPress={onCancel} />
        <Button title="Confirm location" icon={Check} onPress={confirm} disabled={!center} testID="map-confirm" />
      </Foot>
    </>
  );
}
