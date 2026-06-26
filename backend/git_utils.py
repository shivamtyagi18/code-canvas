import os
import subprocess
from datetime import datetime, timezone
from typing import Dict, Any

def get_git_metadata(repo_path: str) -> Dict[str, Dict[str, Any]]:
    """
    Get git modification time and commit count (activity) for all files in the repository.
    Falls back to filesystem modification time if git is not available or it's not a repository.
    """
    metadata = {}
    
    # Check if git is available and if this is a git repository
    is_git = False
    try:
        # Run a quick check to see if we are in a git repository
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=repo_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        if result.returncode == 0 and result.stdout.strip() == "true":
            is_git = True
    except Exception:
        pass

    if is_git:
        try:
            # 1. Get last commit date for all tracked files
            # git log --format="%at" -n 1 -- <file>
            # To speed things up, we can get the git ls-files and batch log,
            # or just call git log for files as we walk.
            # A highly efficient way to get all file mod times in git is:
            # git log --name-only --format="%at"
            # Let's run a quick command to list files and their last commit timestamps
            log_result = subprocess.run(
                ["git", "log", "--name-status", "--pretty=format:%ct"],
                cwd=repo_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            if log_result.returncode == 0:
                current_time = None
                lines = log_result.stdout.splitlines()
                
                # We'll parse the log output to find the most recent commit time for each file
                file_commits: Dict[str, list] = {}
                for line in lines:
                    if not line:
                        continue
                    # If it's a timestamp (digits)
                    if line.isdigit():
                        current_time = int(line)
                    else:
                        # It's a file status line: e.g., "M\tmain.py" or "A\tparser.py"
                        parts = line.split("\t")
                        if len(parts) >= 2:
                            filepath = parts[1]
                            if filepath not in file_commits:
                                file_commits[filepath] = []
                            if current_time:
                                file_commits[filepath].append(current_time)
                
                # Construct metadata for each file from the commit logs
                now = datetime.now(timezone.utc).timestamp()
                for filepath, times in file_commits.items():
                    if not times:
                        continue
                    last_mod = times[0] # most recent is first in git log
                    commit_count = len(times)
                    
                    # Score recency: exponential decay over the last 30 days
                    # 30 days = 30 * 24 * 3600 = 2,592,000 seconds
                    age_seconds = max(0.0, now - last_mod)
                    recency_score = max(0.0, 1.0 - (age_seconds / 2592000.0)) if age_seconds < 2592000.0 else 0.0
                    
                    # Activity score is based on commit count (capped at 10 commits for scaling)
                    activity_score = min(1.0, commit_count / 10.0)
                    
                    metadata[filepath] = {
                        "last_modified": last_mod,
                        "commit_count": commit_count,
                        "recency_score": recency_score,
                        "activity_score": activity_score
                    }
        except Exception as e:
            # If batch parsing fails, fall back to filesystem modification times
            print(f"Error parsing git log, falling back to FS: {e}")
            is_git = False

    return metadata

def get_filesystem_fallback(filepath: str) -> Dict[str, Any]:
    """Fallback metadata from the OS filesystem if git info is unavailable."""
    try:
        stat = os.stat(filepath)
        last_mod = stat.st_mtime
        now = datetime.now(timezone.utc).timestamp()
        
        # Recency score decay over 30 days
        age_seconds = max(0.0, now - last_mod)
        recency_score = max(0.0, 1.0 - (age_seconds / 2592000.0)) if age_seconds < 2592000.0 else 0.0
        
        return {
            "last_modified": last_mod,
            "commit_count": 1,
            "recency_score": recency_score,
            "activity_score": 0.1 # Low baseline activity score
        }
    except Exception:
        return {
            "last_modified": 0.0,
            "commit_count": 0,
            "recency_score": 0.0,
            "activity_score": 0.0
        }
