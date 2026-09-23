export default function ModalLayer({ children, onScrimClick }) {
  return (
    <div id="ember-modal-layer">
      <div id="ember-modal-scrim" onClick={onScrimClick} />
      {children}
    </div>
  );
}
