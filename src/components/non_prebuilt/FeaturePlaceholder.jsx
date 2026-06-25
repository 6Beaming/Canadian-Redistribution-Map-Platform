export function FeaturePlaceholder({ title = "Feature", note = null }) {
  return (
    <div className="feature-placeholder">
      <h3 className="feature-placeholder__title">{title}</h3>
      <p className="feature-placeholder__todo">TO DO</p>
      {note ? <p className="feature-placeholder__note">{note}</p> : null}
    </div>
  );
}
