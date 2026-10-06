import { FolderOpen, GitCompare, Upload } from 'lucide-react';
import { isMac } from '../host';
import { useApp } from '../store/app';
import { compareWithFile, openFilesFromDialog } from '../store/actions';
import { HistoryList } from './sidebar/HistoryPanel';

const mod = isMac ? '⌘' : 'Ctrl+';

export function Welcome() {
  const history = useApp((s) => s.history);
  const loaded = useApp((s) => s.loaded);
  const recent = history.slice(0, 6);

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo" aria-hidden>
          <span className="w">W</span>
          <span className="x">X</span>
          <span className="p">P</span>
        </div>
        <h1>OOXML Toolkit</h1>
        <p className="muted">
          View, edit and compare Word, Excel and PowerPoint packages — right down to the XML.
        </p>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => void openFilesFromDialog()}>
            <FolderOpen size={16} /> Open file…
          </button>
          <button className="btn big" onClick={() => void compareWithFile()}>
            <GitCompare size={16} /> Compare files…
          </button>
        </div>
        <div className="dropzone">
          <Upload size={18} /> Drop .docx, .xlsx, .pptx (or any OOXML / ODF file) anywhere in this
          window
        </div>
        {loaded && recent.length > 0 && (
          <section className="welcome-recent">
            <h3>Recent</h3>
            <HistoryList entries={recent} compact />
          </section>
        )}
        <ul className="hints">
          <li>
            <kbd>{mod}O</kbd> open
          </li>
          <li>
            <kbd>{mod}P</kbd> go to part
          </li>
          <li>
            <kbd>{mod}⇧F</kbd> search
          </li>
          <li>
            <kbd>{mod}D</kbd> bookmark
          </li>
          <li>
            <kbd>{mod}⇧D</kbd> compare
          </li>
        </ul>
      </div>
    </div>
  );
}
