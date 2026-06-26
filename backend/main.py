import os
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Import local utilities
from backend.parser import scan_repository
from backend.git_utils import get_git_metadata, get_filesystem_fallback
from backend.optimizer import optimize_token_budget

app = FastAPI(title="code-canvas API", description="Backend APIs for Visual Token-Budget Context Packager")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # During local dev, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Workspace path is the parent directory of this backend (i.e. the repository root)
WORKSPACE_PATH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class OptimizeRequest(BaseModel):
    budget: int
    dep_weight: float = 0.5
    git_weight: float = 0.5
    pinned_files: List[str] = []
    excluded_files: List[str] = []

class PackageRequest(BaseModel):
    files: List[str]

@app.get("/api/files")
def get_files():
    """Scan directory and return file tree metadata including git metrics."""
    try:
        # Scan files and build dependencies
        file_metadata, dependency_graph = scan_repository(WORKSPACE_PATH)
        
        # Fetch git logs
        git_metadata = get_git_metadata(WORKSPACE_PATH)
        
        # Merge git data into file metadata
        for rel_path, meta in file_metadata.items():
            if rel_path in git_metadata:
                meta.update(git_metadata[rel_path])
            else:
                # Fallback to filesystem times
                abs_path = os.path.join(WORKSPACE_PATH, rel_path)
                fallback = get_filesystem_fallback(abs_path)
                meta.update(fallback)
                
        return {
            "root_path": WORKSPACE_PATH,
            "files": file_metadata,
            "dependency_graph": dependency_graph
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/optimize")
def optimize_files(req: OptimizeRequest):
    """Run optimization algorithm to select files fitting token budget."""
    try:
        # Scan first
        file_metadata, dependency_graph = scan_repository(WORKSPACE_PATH)
        
        # Merge git data
        git_metadata = get_git_metadata(WORKSPACE_PATH)
        for rel_path, meta in file_metadata.items():
            if rel_path in git_metadata:
                meta.update(git_metadata[rel_path])
            else:
                abs_path = os.path.join(WORKSPACE_PATH, rel_path)
                fallback = get_filesystem_fallback(abs_path)
                meta.update(fallback)
                
        selected = optimize_token_budget(
            files_metadata=file_metadata,
            dependency_graph=dependency_graph,
            budget=req.budget,
            dep_weight=req.dep_weight,
            git_weight=req.git_weight,
            pinned_files=req.pinned_files,
            excluded_files=req.excluded_files
        )
        
        return {
            "selected_files": selected,
            "total_tokens": sum(file_metadata[f]["tokens"] for f in selected if f in file_metadata)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/package")
def package_files(req: PackageRequest):
    """Concatenate files into a structured markdown block for LLM prompt context."""
    try:
        packaged_text = []
        total_tokens = 0
        file_stats = []
        
        # Header warning
        packaged_text.append("# Repository Context Package")
        packaged_text.append(f"Generated on: {os.path.basename(WORKSPACE_PATH)}")
        packaged_text.append("Below is the source code context selected for the LLM session.\n")
        
        # Scan to get correct token estimates and files
        file_metadata, _ = scan_repository(WORKSPACE_PATH)
        
        for file_path in req.files:
            abs_path = os.path.join(WORKSPACE_PATH, file_path)
            if not os.path.exists(abs_path):
                continue
                
            try:
                with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    
                tokens = file_metadata.get(file_path, {}).get("tokens", 0)
                total_tokens += tokens
                
                file_stats.append({
                    "path": file_path,
                    "tokens": tokens,
                    "lines": len(content.splitlines())
                })
                
                # Determine markdown language for syntax highlighting
                _, ext = os.path.splitext(file_path)
                lang = ext.lstrip(".").lower()
                if lang in ["ts", "tsx"]:
                    lang = "typescript"
                elif lang in ["js", "jsx"]:
                    lang = "javascript"
                elif lang in ["py"]:
                    lang = "python"
                elif lang in ["md"]:
                    lang = "markdown"
                
                packaged_text.append(f"## File: `{file_path}`")
                packaged_text.append(f"Tokens: {tokens} | Lines: {len(content.splitlines())}")
                packaged_text.append(f"```{lang}")
                packaged_text.append(content)
                packaged_text.append("```\n")
            except Exception as e:
                packaged_text.append(f"## File: `{file_path}` (Error reading: {str(e)})")
                
        full_payload = "\n".join(packaged_text)
        
        return {
            "packaged_content": full_payload,
            "total_tokens": total_tokens,
            "files_packaged": file_stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount frontend static files if they exist (built version)
frontend_dist = os.path.join(WORKSPACE_PATH, "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
    
    # Catch-all router for React SPA
    @app.exception_handler(404)
    async def custom_404_handler(request, __):
        return FileResponse(os.path.join(frontend_dist, "index.html"))
