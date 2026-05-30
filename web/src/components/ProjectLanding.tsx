import { RefreshCw, Trash2, FolderOpen } from 'lucide-react';
import type { Project } from '../lib/api';

interface Props {
  projects: Project[];
  onOpen: (p: Project) => void;
  onDelete: (p: Project) => void;
  onRefresh: () => void;
}

export function ProjectLanding({ projects, onOpen, onDelete, onRefresh }: Props) {
  return (
    <div className="landing">
      <div className="landing-head">
        <div>
          <h1>CodeGraph</h1>
          <p className="muted">{projects.length} project{projects.length !== 1 ? 's' : ''} registered · run <code>codegraph init</code> to add more</p>
        </div>
        <button className="ghost-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="landing-empty">
          No projects yet.<br />
          Index one with <code>codegraph init &lt;path&gt;</code> (or <code>codegraph unity init</code>), then refresh.
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.path} className="project-card">
              <div className="project-card-main" onClick={() => onOpen(p)}>
                <div className="project-name"><FolderOpen size={16} /> {p.name}</div>
                <div className="project-path">{p.path}</div>
                <div className="project-stats">
                  {p.error
                    ? <span className="err">db error</span>
                    : <>{p.nodes.toLocaleString()} nodes · {p.edges.toLocaleString()} edges</>}
                </div>
              </div>
              <div className="project-card-actions">
                <button className="open-btn" onClick={() => onOpen(p)}>Open</button>
                <button
                  className="del-btn"
                  title="Delete .codegraph + unregister"
                  onClick={() => {
                    if (confirm(`Delete CodeGraph data for "${p.name}"?\nRemoves ${p.path}/.codegraph and unregisters it.`)) {
                      onDelete(p);
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
