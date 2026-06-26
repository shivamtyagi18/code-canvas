import React, { useState, useEffect, useMemo } from 'react';
import { 
  Folder, 
  File, 
  ChevronRight, 
  ChevronDown, 
  Sliders, 
  FileText, 
  Copy, 
  Check, 
  X, 
  Star, 
  RefreshCw, 
  Search, 
  Info,
  Layers,
  Sparkles,
  Github,
  Zap,
  BookOpen
} from 'lucide-react';

// API Base URL config
const API_URL = import.meta.env.VITE_API_URL || '';

interface FileMeta {
  path: string;
  name: string;
  extension: string;
  tokens: number;
  size_bytes: number;
  imports: string[];
  imported_by_count: number;
  dependency_score: number;
  last_modified: number;
  commit_count: number;
  recency_score: number;
  activity_score: number;
}

interface TreeItem {
  name: string;
  path: string;
  isDir: boolean;
  children: { [key: string]: TreeItem };
  meta?: FileMeta;
}

export default function App() {
  // Backend State
  const [files, setFiles] = useState<{ [path: string]: FileMeta }>({});
  const [dependencyGraph, setDependencyGraph] = useState<{ [path: string]: string[] }>({});
  const [rootPath, setRootPath] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // User Control State
  const [budget, setBudget] = useState<number>(16000);
  const [depWeight, setDepWeight] = useState<number>(0.5);
  const [gitWeight, setGitWeight] = useState<number>(0.5);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selection Overrides State
  const [pinnedFiles, setPinnedFiles] = useState<Set<string>>(new Set());
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());
  const [optimizedFiles, setOptimizedFiles] = useState<Set<string>>(new Set());
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);

  // UI State
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));
  const [packagedContext, setPackagedContext] = useState<string>('');
  const [isPackaging, setIsPackaging] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'stats'>('preview');

  // Fetch initial files metadata
  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/files`);
      if (!res.ok) throw new Error('Failed to fetch file tree from local backend.');
      const data = await res.json();
      setFiles(data.files);
      setDependencyGraph(data.dependency_graph);
      setRootPath(data.root_path);
      
      // Auto-expand top level folders
      const topFolders = new Set(['root']);
      Object.keys(data.files).forEach(path => {
        const parts = path.split('/');
        if (parts.length > 1) {
          topFolders.add(parts[0]);
        }
      });
      setExpandedFolders(topFolders);
    } catch (err: any) {
      setError(err.message || 'An error occurred while connecting to the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  // Fetch optimized selections whenever parameters change
  const runOptimization = async () => {
    if (Object.keys(files).length === 0) return;
    setIsOptimizing(true);
    try {
      const res = await fetch(`${API_URL}/api/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget,
          dep_weight: depWeight,
          git_weight: gitWeight,
          pinned_files: Array.from(pinnedFiles),
          excluded_files: Array.from(excludedFiles)
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOptimizedFiles(new Set(data.selected_files));
      }
    } catch (err) {
      console.error("Optimization failed", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  // Run optimization after files load or settings change
  useEffect(() => {
    const timer = setTimeout(() => {
      runOptimization();
    }, 250); // debounce API requests
    return () => clearTimeout(timer);
  }, [files, budget, depWeight, gitWeight, pinnedFiles, excludedFiles]);

  // Package content for clipboard/preview
  const generatePackage = async () => {
    if (optimizedFiles.size === 0) {
      setPackagedContext('# No files selected');
      return;
    }
    setIsPackaging(true);
    try {
      const res = await fetch(`${API_URL}/api/package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: Array.from(optimizedFiles)
        })
      });
      if (res.ok) {
        const data = await res.json();
        setPackagedContext(data.packaged_content);
      }
    } catch (err) {
      console.error("Packaging failed", err);
    } finally {
      setIsPackaging(false);
    }
  };

  // Keep preview packaged content synchronized
  useEffect(() => {
    generatePackage();
  }, [optimizedFiles]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(packagedContext);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Helper: Build Tree Structure from Flat File Dictionary
  const fileTree = useMemo(() => {
    const root: TreeItem = { name: 'root', path: '', isDir: true, children: {} };
    
    // Filter files based on search query
    const filteredPaths = Object.keys(files).filter(path => 
      path.toLowerCase().includes(searchQuery.toLowerCase())
    );

    filteredPaths.forEach(path => {
      const parts = path.split('/');
      let current = root;
      
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const currentPath = parts.slice(0, index + 1).join('/');
        
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            children: {}
          };
        }
        
        if (isLast) {
          current.children[part].meta = files[path];
        }
        
        current = current.children[part];
      });
    });
    
    return root;
  }, [files, searchQuery]);

  // Calculations & Metrics
  const metrics = useMemo(() => {
    let totalTokens = 0;
    let selectedTokens = 0;
    let selectedFileCount = 0;
    const extensions: { [key: string]: number } = {};

    Object.keys(files).forEach(path => {
      const meta = files[path];
      totalTokens += meta.tokens;
      
      const ext = meta.extension || 'no-extension';
      extensions[ext] = (extensions[ext] || 0) + 1;

      if (optimizedFiles.has(path)) {
        selectedTokens += meta.tokens;
        selectedFileCount++;
      }
    });

    return {
      totalTokens,
      selectedTokens,
      selectedFileCount,
      extensions: Object.entries(extensions).sort((a, b) => b[1] - a[1])
    };
  }, [files, optimizedFiles]);

  // Handlers for selection overrides
  const handleTogglePin = (path: string) => {
    const nextPins = new Set(pinnedFiles);
    const nextExcludes = new Set(excludedFiles);
    
    if (nextPins.has(path)) {
      nextPins.delete(path);
    } else {
      nextPins.add(path);
      nextExcludes.delete(path); // A file cannot be pinned and excluded
    }
    
    setPinnedFiles(nextPins);
    setExcludedFiles(nextExcludes);
  };

  const handleToggleExclude = (path: string) => {
    const nextPins = new Set(pinnedFiles);
    const nextExcludes = new Set(excludedFiles);
    
    if (nextExcludes.has(path)) {
      nextExcludes.delete(path);
    } else {
      nextExcludes.add(path);
      nextPins.delete(path); // A file cannot be pinned and excluded
    }
    
    setPinnedFiles(nextPins);
    setExcludedFiles(nextExcludes);
  };

  const handleToggleOptimizedSelect = (path: string) => {
    // Standard checkbox toggles
    // If it's already selected, we exclude it. If it's not selected, we pin it!
    if (optimizedFiles.has(path)) {
      handleToggleExclude(path);
    } else {
      handleTogglePin(path);
    }
  };

  const toggleFolder = (path: string) => {
    const nextFolders = new Set(expandedFolders);
    if (nextFolders.has(path)) {
      nextFolders.delete(path);
    } else {
      nextFolders.add(path);
    }
    setExpandedFolders(nextFolders);
  };

  // Helper: Format file size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Render file tree recursively
  const renderTree = (item: TreeItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.path || 'root');
    const hasChildren = Object.keys(item.children).length > 0;
    
    if (!item.isDir) {
      const meta = item.meta;
      if (!meta) return null;
      
      const isSelected = optimizedFiles.has(meta.path);
      const isPinned = pinnedFiles.has(meta.path);
      const isExcluded = excludedFiles.has(meta.path);
      
      return (
        <div 
          key={meta.path}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          className={`flex items-center justify-between py-1.5 px-3 rounded-lg text-sm transition-all hover:bg-sage-bg/30 ${
            isSelected 
              ? 'bg-sage-bg/50 border-l-2 border-sage text-espresso font-medium' 
              : 'text-espresso/80'
          }`}
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            {/* Custom tri-state selection status checkbox */}
            <button 
              onClick={() => handleToggleOptimizedSelect(meta.path)}
              className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                isPinned 
                  ? 'bg-sage border-sage text-white' 
                  : isExcluded 
                    ? 'border-red-300 bg-red-50 text-red-500' 
                    : isSelected 
                      ? 'border-sage-dark bg-sage-light/30 text-sage-dark'
                      : 'border-espresso/30 hover:border-sage'
              }`}
            >
              {isPinned && <Check className="w-3 h-3 stroke-[3]" />}
              {isExcluded && <X className="w-3 h-3 stroke-[3]" />}
              {!isPinned && !isExcluded && isSelected && <Check className="w-3 h-3 text-sage-dark stroke-[3]" />}
            </button>

            <File className={`w-4 h-4 shrink-0 ${isSelected ? 'text-sage-dark' : 'text-espresso/50'}`} />
            <span className="truncate" title={meta.path}>{item.name}</span>
          </div>

          <div className="flex items-center gap-3 ml-4 shrink-0">
            {/* Badges for score / details */}
            <span className="text-[10px] text-espresso/40 bg-espresso/5 px-1.5 py-0.5 rounded font-mono">
              {meta.tokens} tkn
            </span>
            
            {meta.dependency_score > 0 && (
              <span className="text-[10px] text-sage-dark bg-sage-bg px-1.5 py-0.5 rounded font-mono" title={`Imports: ${meta.imported_by_count}`}>
                dep: {meta.dependency_score.toFixed(1)}
              </span>
            )}
            
            {meta.recency_score > 0.1 && (
              <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono" title={`Git Commits: ${meta.commit_count}`}>
                git: {meta.recency_score.toFixed(1)}
              </span>
            )}

            {/* Quick Actions (Pin & Exclude buttons) */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100">
              <button 
                onClick={() => handleTogglePin(meta.path)}
                title="Force Pin (always include)"
                className={`p-1 rounded hover:bg-espresso/5 ${isPinned ? 'text-amber-500' : 'text-espresso/30 hover:text-amber-500'}`}
              >
                <Star className="w-3.5 h-3.5 fill-current" />
              </button>
              <button 
                onClick={() => handleToggleExclude(meta.path)}
                title="Force Exclude"
                className={`p-1 rounded hover:bg-espresso/5 ${isExcluded ? 'text-red-500' : 'text-espresso/30 hover:text-red-500'}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    const folderId = item.path || 'root';
    return (
      <div key={folderId} className="select-none">
        <div 
          style={{ paddingLeft: `${depth * 16}px` }}
          onClick={() => toggleFolder(folderId)}
          className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm hover:bg-espresso/5 cursor-pointer text-espresso/90 font-medium"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4 text-espresso/45" /> : <ChevronRight className="w-4 h-4 text-espresso/45" />}
          <Folder className="w-4 h-4 text-sage fill-sage/10 shrink-0" />
          <span className="truncate">{item.name === 'root' ? 'workspace' : item.name}</span>
        </div>
        
        {isExpanded && hasChildren && (
          <div className="mt-0.5 border-l border-espresso/5 ml-4 pl-1">
            {Object.values(item.children)
              .sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name))
              .map(child => renderTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Progress Bar configuration
  const budgetRatio = metrics.selectedTokens / budget;
  const isOverBudget = metrics.selectedTokens > budget;
  
  // Progress Bar color determination
  const progressBarColor = isOverBudget 
    ? 'bg-red-500' 
    : budgetRatio > 0.9 
      ? 'bg-amber-500' 
      : 'bg-sage-dark';

  return (
    <div className="min-h-screen bg-latte text-espresso flex flex-col font-sans antialiased selection:bg-sage/20">
      
      {/* HEADER BANNER */}
      <header className="bg-white border-b border-sage-light/20 sticky top-0 z-30 custom-shadow">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Logo & Workspace Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sage-bg border border-sage/30 flex items-center justify-center text-sage-dark shadow-inner">
              <Layers className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-lg tracking-tight">code-canvas</h1>
                <span className="bg-sage/10 text-sage-dark text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-sage/20">
                  Visual Budget Packager
                </span>
              </div>
              <p className="text-xs text-espresso-muted font-mono truncate max-w-xs md:max-w-md">
                {rootPath || 'Loading repository...'}
              </p>
            </div>
          </div>

          {/* Token Budget Gauge */}
          <div className="flex-1 max-w-md flex flex-col gap-1.5">
            <div className="flex justify-between text-xs font-semibold text-espresso-light">
              <span className="flex items-center gap-1 text-[11px]">
                <Zap className="w-3 h-3 text-sage-dark fill-current" />
                Budget Usage
              </span>
              <span className="font-mono text-[11px] bg-espresso/5 px-2 py-0.5 rounded">
                <span className={isOverBudget ? "text-red-500 font-bold" : "text-sage-dark font-bold"}>
                  {metrics.selectedTokens.toLocaleString()}
                </span> 
                {' '}/ {budget.toLocaleString()} tokens
              </span>
            </div>
            
            <div className="w-full h-3 bg-espresso/5 rounded-full overflow-hidden border border-espresso/5 shadow-inner">
              <div 
                className={`h-full transition-all duration-300 rounded-full ${progressBarColor}`}
                style={{ width: `${Math.min(100, budgetRatio * 100)}%` }}
              />
            </div>

            {isOverBudget && (
              <span className="text-[10px] text-red-500 font-medium flex items-center gap-1 animate-pulse">
                <Info className="w-3 h-3 shrink-0" /> Exceeds budget. Mute some files or adjust weights/limit.
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button 
              onClick={fetchFiles}
              title="Refresh repository files"
              className="p-2.5 rounded-xl border border-sage-light/35 bg-white text-espresso-light hover:bg-sage-bg/30 active:scale-95 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={copyToClipboard}
              disabled={optimizedFiles.size === 0}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-sm ${
                optimizedFiles.size === 0
                  ? 'bg-espresso/10 text-espresso-muted cursor-not-allowed border border-espresso/5'
                  : copySuccess
                    ? 'bg-sage text-white border border-sage shadow-md'
                    : 'bg-espresso text-white border border-espresso hover:bg-espresso-light active:scale-[0.98]'
              }`}
            >
              {copySuccess ? (
                <>
                  <Check className="w-4 h-4 stroke-[3]" /> Copied Context!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copy Context
                </>
              )}
            </button>
          </div>

        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden">
        
        {/* LEFT COLUMN: CONTROLS & TREE (5 cols) */}
        <section className="lg:col-span-5 flex flex-col gap-6 overflow-hidden max-h-[calc(100vh-160px)]">
          
          {/* Controls Card */}
          <div className="bg-white border border-sage-light/20 rounded-2xl p-5 custom-shadow flex flex-col gap-4">
            
            <div className="flex items-center gap-2 border-b border-espresso/5 pb-3">
              <Sliders className="w-4.5 h-4.5 text-sage-dark" />
              <h2 className="font-extrabold text-sm tracking-wide uppercase">Budget Parameters</h2>
            </div>

            {/* Token Limit Slider */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-semibold text-espresso-light">
                <span>Token Limit (Budget)</span>
                <span className="font-mono bg-sage-bg px-2 py-0.5 rounded text-sage-dark">
                  {budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : budget}
                </span>
              </div>
              <input 
                type="range"
                min="1000"
                max="128000"
                step="1000"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full accent-sage-dark bg-espresso/5 rounded-lg h-2 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-espresso/45 px-0.5">
                <button onClick={() => setBudget(4000)} className="hover:text-sage-dark font-medium">4k</button>
                <button onClick={() => setBudget(8000)} className="hover:text-sage-dark font-medium">8k</button>
                <button onClick={() => setBudget(16000)} className="hover:text-sage-dark font-medium">16k</button>
                <button onClick={() => setBudget(32000)} className="hover:text-sage-dark font-medium">32k</button>
                <button onClick={() => setBudget(64000)} className="hover:text-sage-dark font-medium">64k</button>
                <button onClick={() => setBudget(128000)} className="hover:text-sage-dark font-medium">128k</button>
              </div>
            </div>

            {/* Algorithmic Weight Selection */}
            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-espresso/5 mt-1">
              {/* Dependency Importance */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-espresso-light" title="Score based on how many other files import this file">
                  Dependency Bias
                </span>
                <input 
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.1"
                  value={depWeight}
                  onChange={(e) => setDepWeight(Number(e.target.value))}
                  className="w-full accent-sage bg-espresso/5 rounded-lg h-1.5 cursor-pointer"
                />
                <span className="text-[10px] font-mono text-espresso/40">w: {depWeight.toFixed(1)}</span>
              </div>

              {/* Git Activity Importance */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold text-espresso-light" title="Score based on recent commits and modification dates">
                  Git Recency Bias
                </span>
                <input 
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.1"
                  value={gitWeight}
                  onChange={(e) => setGitWeight(Number(e.target.value))}
                  className="w-full accent-sage bg-espresso/5 rounded-lg h-1.5 cursor-pointer"
                />
                <span className="text-[10px] font-mono text-espresso/40">w: {gitWeight.toFixed(1)}</span>
              </div>
            </div>

          </div>

          {/* Repository Tree Card */}
          <div className="bg-white border border-sage-light/20 rounded-2xl p-5 custom-shadow flex-1 flex flex-col overflow-hidden">
            
            {/* Tree Search & Filtering */}
            <div className="flex items-center gap-2 mb-4 bg-espresso/5 px-3 py-2.5 rounded-xl border border-espresso/5">
              <Search className="w-4 h-4 text-espresso/40 shrink-0" />
              <input 
                type="text" 
                placeholder="Search file structure..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none placeholder-espresso/40 text-espresso"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-0.5 text-espresso/40 hover:text-espresso rounded">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* File Tree List */}
            <div className="flex-1 overflow-y-auto pr-1">
              {loading ? (
                <div className="h-40 flex flex-col items-center justify-center gap-2.5 text-espresso-light">
                  <RefreshCw className="w-5 h-5 animate-spin text-sage-dark" />
                  <span className="text-xs">Scanning workspace...</span>
                </div>
              ) : error ? (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl text-xs border border-red-100 flex flex-col gap-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <Info className="w-4 h-4" /> Load Error
                  </div>
                  <p>{error}</p>
                  <button 
                    onClick={fetchFiles}
                    className="self-start text-[10px] uppercase font-bold text-red-800 bg-red-100 px-3 py-1 rounded-lg border border-red-200 mt-1 hover:bg-red-200"
                  >
                    Try Again
                  </button>
                </div>
              ) : Object.keys(files).length === 0 ? (
                <div className="text-center py-12 text-espresso/40 text-xs">
                  No compatible files found.
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {Object.values(fileTree.children)
                    .sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name))
                    .map(child => renderTree(child, 0))}
                </div>
              )}
            </div>
            
            {/* Quick Status Legend */}
            <div className="border-t border-espresso/5 mt-4 pt-3 flex items-center justify-between text-[10px] text-espresso-muted">
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3 text-sage-dark" /> Selected
              </span>
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 text-amber-500 fill-current" /> Pinned
              </span>
              <span className="flex items-center gap-1 text-red-500">
                <X className="w-3 h-3" /> Excluded
              </span>
              <span className="font-mono text-espresso-light">
                {metrics.selectedFileCount} / {Object.keys(files).length} files
              </span>
            </div>

          </div>

        </section>

        {/* RIGHT COLUMN: PREVIEW & STATS (7 cols) */}
        <section className="lg:col-span-7 flex flex-col gap-6 overflow-hidden max-h-[calc(100vh-160px)]">
          
          {/* Preview Panel Card */}
          <div className="bg-white border border-sage-light/20 rounded-2xl custom-shadow flex-1 flex flex-col overflow-hidden">
            
            {/* Tabs & Meta */}
            <div className="flex items-center justify-between border-b border-espresso/5 px-5 py-3">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setActiveTab('preview')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    activeTab === 'preview' 
                      ? 'bg-espresso text-white' 
                      : 'text-espresso/50 hover:bg-espresso/5'
                  }`}
                >
                  Packaged Preview
                </button>
                <button 
                  onClick={() => setActiveTab('stats')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    activeTab === 'stats' 
                      ? 'bg-espresso text-white' 
                      : 'text-espresso/50 hover:bg-espresso/5'
                  }`}
                >
                  Workspace Stats
                </button>
              </div>

              {optimizedFiles.size > 0 && (
                <div className="text-[11px] text-espresso-muted flex items-center gap-1 font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  Estimated {metrics.selectedTokens.toLocaleString()} tokens
                </div>
              )}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-hidden">
              
              {activeTab === 'preview' ? (
                <div className="h-full flex flex-col">
                  {isPackaging ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-espresso-light">
                      <RefreshCw className="w-5 h-5 animate-spin text-sage-dark" />
                      <span className="text-xs">Building structured prompt context...</span>
                    </div>
                  ) : !packagedContext || optimizedFiles.size === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-espresso/45 py-12 px-6">
                      <BookOpen className="w-10 h-10 text-espresso/25 stroke-[1.5]" />
                      <div className="text-center">
                        <p className="font-bold text-sm text-espresso-light mb-1">No Source Files Packaged</p>
                        <p className="text-xs max-w-xs leading-relaxed">
                          Select some files or adjust the sliders in the left panel to populate token context.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto bg-[#FAFAFA] font-mono text-xs p-5 select-text selection:bg-sage/35 text-espresso/85 border-b border-espresso/5">
                      <pre className="whitespace-pre-wrap">{packagedContext}</pre>
                    </div>
                  )}
                </div>
              ) : (
                /* Stats Tab */
                <div className="h-full overflow-y-auto p-6 flex flex-col gap-6">
                  
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-sage-bg/30 border border-sage/10 p-4 rounded-xl text-center">
                      <span className="block text-[10px] text-espresso-muted uppercase tracking-wider font-extrabold mb-1">Total Files</span>
                      <span className="text-2xl font-black font-mono text-espresso">{Object.keys(files).length}</span>
                    </div>
                    <div className="bg-sage-bg/30 border border-sage/10 p-4 rounded-xl text-center">
                      <span className="block text-[10px] text-espresso-muted uppercase tracking-wider font-extrabold mb-1">Packaged</span>
                      <span className="text-2xl font-black font-mono text-sage-dark">{metrics.selectedFileCount}</span>
                    </div>
                    <div className="bg-sage-bg/30 border border-sage/10 p-4 rounded-xl text-center">
                      <span className="block text-[10px] text-espresso-muted uppercase tracking-wider font-extrabold mb-1">Token Limit</span>
                      <span className="text-2xl font-black font-mono text-espresso">{budget >= 1000 ? `${(budget / 1000).toFixed(0)}k` : budget}</span>
                    </div>
                  </div>

                  {/* File Type Breakdown */}
                  <div className="flex flex-col gap-2.5">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-espresso-light flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-sage" /> File Extensions Layout
                    </h3>
                    <div className="border border-espresso/5 rounded-xl overflow-hidden bg-[#FAFAFA]">
                      <div className="grid grid-cols-2 bg-espresso/5 px-4 py-2 font-bold text-[10px] text-espresso-muted uppercase tracking-wider">
                        <span>Extension</span>
                        <span className="text-right">File Count</span>
                      </div>
                      <div className="divide-y divide-espresso/5 text-xs text-espresso-light">
                        {metrics.extensions.map(([ext, count]) => (
                          <div key={ext} className="grid grid-cols-2 px-4 py-2 hover:bg-espresso/5 transition-all">
                            <span className="font-mono">{ext}</span>
                            <span className="text-right font-mono font-medium">{count}</span>
                          </div>
                        ))}
                        {metrics.extensions.length === 0 && (
                          <div className="text-center py-6 text-espresso/45">No files scanned.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Algorithmic Info */}
                  <div className="bg-sage-bg/40 border border-sage-light/30 rounded-xl p-4 flex gap-3 text-xs leading-relaxed text-espresso-light">
                    <Info className="w-5 h-5 text-sage-dark shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-extrabold text-espresso mb-1">Token-Budget Allocation Logic</h4>
                      <p className="text-espresso/70 mb-2">
                        The visual packager automatically ranks repository files using:
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-espresso/75 font-medium">
                        <li>Imports dependency depth (PageRank & in-degree coupling metric).</li>
                        <li>Recent Git logs, prioritizing files frequently edited or changed in the last 30 days.</li>
                        <li>Dynamic score propagation, boosting dependent components/modules linked to manually pinned entries.</li>
                      </ul>
                    </div>
                  </div>

                </div>
              )}

            </div>

          </div>

        </section>

      </main>
      
    </div>
  );
}
