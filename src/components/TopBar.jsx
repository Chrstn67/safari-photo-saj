// frontend/src/components/TopBar.jsx
export default function TopBar({ title, right }) {
  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      {right && <div className="topbar-actions">{right}</div>}
    </div>
  );
}
