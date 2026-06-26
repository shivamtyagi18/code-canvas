import os
import re
from typing import Dict, List, Set, Tuple, Any

# Try to import tiktoken, fallback to basic character counting if unavailable
try:
    import tiktoken
    _encoding = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(_encoding.encode(text, disallowed_special=()))
except ImportError:
    def count_tokens(text: str) -> int:
        # Approximate: ~4 characters per token
        return max(1, len(text) // 4)

# Regex patterns for imports
JS_IMPORT_RE = re.compile(
    r'(?:import\s+(?:.*?)\s+from\s+[\'"]([^\'"]+)[\'"]|import\s+[\'"]([^\'"]+)[\'"]|require\(\s*[\'"]([^\'"]+)[\'"]\s*\))'
)
PY_IMPORT_RE = re.compile(
    r'(?:^import\s+([a-zA-Z0-9_\.,\s]+)|^from\s+([a-zA-Z0-9_\.]+)\s+import)'
)

def clean_python_import(import_name: str) -> List[str]:
    """Clean comma-separated python imports or sub-modules."""
    if not import_name:
        return []
    names = []
    for part in import_name.split(","):
        part = part.strip().split(" as ")[0].strip()
        names.append(part)
    return names

def resolve_import_path(current_file_path: str, import_str: str, repo_path: str, all_files: Set[str]) -> str:
    """
    Attempt to resolve an import string to an actual file in the repo.
    Returns the relative path of the file from repo_path if found, otherwise "".
    """
    current_dir = os.path.dirname(current_file_path)
    
    # 1. Handle relative imports (e.g., ./utils, ../components/Button)
    if import_str.startswith("."):
        # Resolve path
        target_path = os.path.abspath(os.path.join(current_dir, import_str))
        rel_target = os.path.relpath(target_path, repo_path)
        
        # Check direct match or with extensions
        for ext in ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]:
            candidate = rel_target + ext
            # Normalize path delimiters to forward slashes for cross-platform matching
            candidate_norm = candidate.replace("\\", "/")
            if candidate_norm in all_files:
                return candidate_norm
            # Try absolute path matching too
            if os.path.exists(os.path.join(repo_path, candidate)):
                return os.path.relpath(os.path.join(repo_path, candidate), repo_path).replace("\\", "/")

    # 2. Handle absolute/module imports or TS path aliases (e.g. src/components/Button)
    # Check if any file in the workspace ends with or matches this import
    import_str_clean = import_str.replace("\\", "/")
    for ext in ["", ".ts", ".tsx", ".js", ".jsx", ".py"]:
        candidate = import_str_clean + ext
        # If the import string matches a suffix of any workspace file
        for file in all_files:
            if file.endswith(candidate) or file.endswith(candidate + "/index.tsx") or file.endswith(candidate + "/index.ts"):
                return file
                
    return ""

def parse_imports(file_path: str, content: str, repo_path: str, all_files: Set[str]) -> Set[str]:
    """Parse imports from a file and return a set of resolved relative file paths."""
    resolved_imports = set()
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext in [".js", ".jsx", ".ts", ".tsx"]:
        matches = JS_IMPORT_RE.findall(content)
        for match in matches:
            # JS_IMPORT_RE has 3 capture groups, find the non-empty one
            import_str = next((g for g in match if g), None)
            if import_str:
                resolved = resolve_import_path(file_path, import_str, repo_path, all_files)
                if resolved:
                    resolved_imports.add(resolved)
                    
    elif ext == ".py":
        lines = content.splitlines()
        for line in lines:
            line = line.strip()
            match = PY_IMPORT_RE.match(line)
            if match:
                # Group 1: import X, Y, Z
                # Group 2: from X import Y
                g1, g2 = match.groups()
                if g1:
                    imports = clean_python_import(g1)
                    for imp in imports:
                        # Convert package notation 'a.b' to path 'a/b'
                        imp_path = imp.replace(".", "/")
                        resolved = resolve_import_path(file_path, imp_path, repo_path, all_files)
                        if resolved:
                            resolved_imports.add(resolved)
                elif g2:
                    imp_path = g2.replace(".", "/")
                    resolved = resolve_import_path(file_path, imp_path, repo_path, all_files)
                    if resolved:
                        resolved_imports.add(resolved)
                        
    return resolved_imports

def scan_repository(repo_path: str, exclude_dirs: Set[str] = None) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[str]]]:
    """
    Walks the repository, reads and parses files, returns:
    1. File tree details (token counts, dependencies, base details).
    2. Adjacency list representing the import graph (who imports whom).
    """
    if exclude_dirs is None:
        exclude_dirs = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", ".next", ".docusaurus", ".agents"}
        
    all_files_set = set()
    file_contents = {}
    file_sizes = {}
    
    # First pass: collect all valid files and paths
    for root, dirs, files in os.walk(repo_path):
        # Modify dirs in-place to skip excluded directories
        dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith(".")]
        
        for file in files:
            if file.startswith("."):
                continue
            # Skip common binary/unwanted extensions
            ext = os.path.splitext(file)[1].lower()
            if ext in [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".pdf", ".zip", ".tar", ".gz", ".mp3", ".mp4", ".woff", ".woff2", ".ttf", ".eot", ".db", ".sqlite", ".pyc"]:
                continue
                
            abs_path = os.path.join(root, file)
            rel_path = os.path.relpath(abs_path, repo_path).replace("\\", "/")
            all_files_set.add(rel_path)
            
            try:
                # Read content
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    file_contents[rel_path] = content
                    file_sizes[rel_path] = len(content)
            except Exception:
                pass
                
    # Second pass: compute tokens and resolve imports
    file_metadata = {}
    dependency_graph: Dict[str, List[str]] = {f: [] for f in all_files_set} # A imports B (A -> B)
    in_degree: Dict[str, int] = {f: 0 for f in all_files_set} # Number of files importing B
    
    for file_rel in all_files_set:
        content = file_contents.get(file_rel, "")
        tokens = count_tokens(content)
        
        # Find who this file imports
        abs_path = os.path.join(repo_path, file_rel)
        imports = parse_imports(abs_path, content, repo_path, all_files_set)
        
        dependency_graph[file_rel] = list(imports)
        for imp in imports:
            in_degree[imp] = in_degree.get(imp, 0) + 1
            
        file_metadata[file_rel] = {
            "path": file_rel,
            "name": os.path.basename(file_rel),
            "extension": os.path.splitext(file_rel)[1],
            "tokens": tokens,
            "size_bytes": file_sizes.get(file_rel, 0),
            "imports": list(imports),
            "imported_by_count": 0, # will fill in next step
        }
        
    # Populate import counts
    max_in_degree = max(in_degree.values()) if in_degree else 1
    for file_rel, meta in file_metadata.items():
        count = in_degree.get(file_rel, 0)
        meta["imported_by_count"] = count
        # Normalize dependency score (0.0 to 1.0)
        meta["dependency_score"] = count / max_in_degree if max_in_degree > 0 else 0.0

    return file_metadata, dependency_graph
