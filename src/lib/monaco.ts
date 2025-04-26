import * as monaco from 'monaco-editor';

// Import the workers in a production-safe way.
// This is different than in Monaco's documentation for Vite,
// but avoids a weird error ("Unexpected usage") at runtime
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';


  // --color-stone-50: oklch(0.985 0.001 106.423);
  // --color-stone-100: oklch(0.97 0.001 106.424);
  // --color-stone-200: oklch(0.923 0.003 48.717);
  // --color-stone-300: oklch(0.869 0.005 56.366);
  // --color-stone-400: #A6A09B;
  // --color-stone-500: oklch(0.553 0.013 58.071);
  // --color-stone-600: oklch(0.444 0.011 73.639);
  // --color-stone-700: #44403B;
  // --color-stone-800: #292524;
  // --color-stone-900: oklch(0.216 0.006 56.043);
  // --color-stone-950: oklch(0.147 0.004 49.25);

// Define Stone theme
monaco.editor.defineTheme('stone', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#292524',
    'editor.foreground': '#FAFAF9',
    'editor.lineHighlightBackground': '#44403B',
    'editorCursor.foreground': '#fafafa',
    'editorLineNumber.foreground': '#A6A09B',
  }
});

// Set the default theme
monaco.editor.setTheme('stone');

// Setup Monaco environment for workers
self.MonacoEnvironment = {
  getWorker: function (_: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  }
};

export default monaco; 