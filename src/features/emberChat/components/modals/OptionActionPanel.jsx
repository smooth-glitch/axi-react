import { useEffect, useRef, useState } from "react";
import { downloadFile, MAX_UPLOAD_MB, uploadFile } from "../../../../services/sandeshFiles.js";

// Runs the non-form option types from the chat's prompt bar.
//   download  -> fetches the attached file and saves it to the device (server checks the option applies)
//   upload    -> file picker, uploads, shows the file id and lets the user download it back
//   others    -> stored by the server but not executable yet (their external-system contract isn't fixed)

const NOT_WIRED = {
  get_data: "Show data from an API",
  pay: "Payment",
  axpert_tstruct: "Axpert tstruct",
  axpert_smartview: "Axpert smart view",
  axpert_iview: "Axpert iview",
  axpert_page: "Axpert page",
};

function Download({ option, token }) {
  const [state, setState] = useState({ status: "working" });
  const started = useRef(false);
  const run = () => {
    setState({ status: "working" });
    downloadFile(option.target, token)
      .then((r) => setState({ status: "done", ...r }))
      .catch((e) => setState({ status: "error", message: e.message }));
  };
  useEffect(() => {
    if (started.current) return; // once when it opens
    started.current = true;
    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!option.target) return <div className="sandesh-alert sandesh-alert-danger">No file is attached to this option yet.</div>;
  if (state.status === "working") return <p className="section-note">Preparing your download…</p>;
  if (state.status === "error") {
    return (
      <>
        <div className="sandesh-alert sandesh-alert-danger">{state.message}</div>
        <button type="button" className="sandesh-btn-secondary-3d" onClick={run}>Try again</button>
      </>
    );
  }
  return (
    <div className="sandesh-alert sandesh-alert-success">
      Saved <strong>{state.name}</strong> ({Math.max(1, Math.round(state.size / 1024))} KB) to your device.
    </div>
  );
}

function Upload({ token }) {
  const [state, setState] = useState({ status: "idle" });
  const [dl, setDl] = useState("");

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file) return;
    setState({ status: "uploading", name: file.name });
    try {
      const meta = await uploadFile(file, token);
      setState({ status: "done", meta });
    } catch (err) {
      setState({ status: "error", message: err.message });
    }
  };

  const back = async () => {
    setDl("");
    try {
      const r = await downloadFile(state.meta.id, token);
      setDl(`Saved ${r.name}.`);
    } catch (err) {
      setDl(err.message);
    }
  };

  return (
    <>
      <p className="section-note">Choose a file to upload (up to {MAX_UPLOAD_MB} MB).</p>
      <input type="file" onChange={pick} disabled={state.status === "uploading"} data-testid="option-upload-input" />
      {state.status === "uploading" && <p className="section-note">Uploading {state.name}…</p>}
      {state.status === "error" && <div className="sandesh-alert sandesh-alert-danger" style={{ marginTop: 10 }}>{state.message}</div>}
      {state.status === "done" && (
        <div className="sandesh-alert sandesh-alert-success" style={{ marginTop: 10, textAlign: "left" }}>
          Uploaded <strong>{state.meta.name}</strong> ({Math.max(1, Math.round(state.meta.size / 1024))} KB).
          <div>File id: <code data-testid="option-upload-id">{state.meta.id}</code></div>
          <button type="button" className="sandesh-btn-link" onClick={back}>Download it back</button>
          {dl && <div>{dl}</div>}
        </div>
      )}
    </>
  );
}

export default function OptionActionPanel({ option, currentUser, onClose }) {
  const token = currentUser?.token;
  return (
    <div className="sandesh-modal-body">
      {option.type === "download" && <Download option={option} token={token} />}
      {option.type === "upload" && <Upload token={token} />}
      {NOT_WIRED[option.type] && (
        <>
          <div className="sandesh-alert sandesh-alert-danger" style={{ textAlign: "left" }}>
            <strong>{NOT_WIRED[option.type]}</strong> isn&apos;t wired up yet: the server stores this option, but it
            can&apos;t run it until its external system is connected.
          </div>
          {option.target && (
            <p className="section-note">Configured target: <code>{option.target}</code>{option.display ? ` • shown as ${option.display}` : ""}</p>
          )}
        </>
      )}
      <div className="sandesh-modal-actions">
        <button type="button" className="sandesh-btn-secondary-3d" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
