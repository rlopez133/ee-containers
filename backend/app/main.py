from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import asyncio
import subprocess
import os
import json
import yaml
from datetime import datetime
import logging
from pathlib import Path
import glob

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="EE Containers Builder API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class Environment(BaseModel):
    name: str
    description: str
    type: str
    os_version: str
    base_image: str
    status: str = "available"

class Credentials(BaseModel):
    rh_username: str
    rh_password: str
    automation_hub_token: str = ""

class BuildRequest(BaseModel):
    environments: List[str]
    credentials: Credentials

class BuildStatus(BaseModel):
    id: str
    status: str
    environments: List[str]
    started_at: str
    logs: List[str] = []
    images: List[str] = []

# Global storage
environments_db: Dict[str, Environment] = {}
builds_db: Dict[str, BuildStatus] = {}

def safe_yaml_load(file_path):
    """Safely load YAML with better error handling"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
            
        # Try standard YAML first
        try:
            return yaml.safe_load(content)
        except yaml.YAMLError:
            # If that fails, try with custom loader that's more permissive
            return yaml.load(content, Loader=yaml.BaseLoader)
            
    except Exception as e:
        logger.error(f"Failed to load YAML from {file_path}: {e}")
        return None

def load_environments():
    """Load environment definitions from the environments directory"""
    environments_db.clear()
    
    # Look for environments in the original repo structure
    environments_dir = Path("../environments")  # Relative to backend dir
    
    if not environments_dir.exists():
        logger.warning(f"Environments directory not found: {environments_dir}")
        # Fall back to test data
        environments_db["rhel9-ee-minimal"] = Environment(
            name="rhel9-ee-minimal",
            description="RHEL 9 Minimal EE (Test Data)",
            type="ee",
            os_version="rhel9",
            base_image="registry.redhat.io/ansible-automation-platform-25/ee-minimal-rhel9:latest"
        )
        return
    
    logger.info(f"Scanning environments directory: {environments_dir}")
    
    # Scan for environment directories
    for env_path in environments_dir.iterdir():
        if env_path.is_dir() and not env_path.name.startswith('.'):
            try:
                env_name = env_path.name
                ee_file = env_path / "execution-environment.yml"
                
                logger.info(f"Processing environment: {env_name}")
                
                if ee_file.exists():
                    # Parse execution-environment.yml with safe loading
                    ee_config = safe_yaml_load(ee_file)
                    
                    if ee_config is None:
                        logger.warning(f"Skipping {env_name} due to YAML parsing error")
                        # Still create a basic entry
                        parts = env_name.split('-')
                        os_version = parts[0] if len(parts) > 0 else "unknown"
                        env_type = parts[1] if len(parts) > 1 else "unknown"
                        variant = "-".join(parts[2:]) if len(parts) > 2 else "minimal"
                        
                        environments_db[env_name] = Environment(
                            name=env_name,
                            description=f"{os_version.upper()} {env_type.upper()} - {variant.replace('-', ' ').title()} (YAML Error)",
                            type=env_type,
                            os_version=os_version,
                            base_image="unknown",
                            status="yaml_error"
                        )
                        continue
                    
                    # Extract info from environment name (rhel8-ee-minimal format)
                    parts = env_name.split('-')
                    os_version = parts[0] if len(parts) > 0 else "unknown"
                    env_type = parts[1] if len(parts) > 1 else "unknown"
                    variant = "-".join(parts[2:]) if len(parts) > 2 else "minimal"
                    
                    # Get base image from config
                    base_image = "unknown"
                    try:
                        if isinstance(ee_config, dict):
                            if 'images' in ee_config and isinstance(ee_config['images'], dict):
                                if 'base_image' in ee_config['images']:
                                    base_image_config = ee_config['images']['base_image']
                                    if isinstance(base_image_config, dict) and 'name' in base_image_config:
                                        base_image = base_image_config['name']
                                    elif isinstance(base_image_config, str):
                                        base_image = base_image_config
                    except Exception as e:
                        logger.warning(f"Error extracting base image from {env_name}: {e}")
                    
                    # Create description
                    description = f"{os_version.upper()} {env_type.upper()} - {variant.replace('-', ' ').title()}"
                    
                    environments_db[env_name] = Environment(
                        name=env_name,
                        description=description,
                        type=env_type,
                        os_version=os_version,
                        base_image=base_image
                    )
                    logger.info(f"✅ Loaded environment: {env_name}")
                else:
                    logger.warning(f"No execution-environment.yml found in {env_name}")
                    
            except Exception as e:
                logger.error(f"Error loading environment {env_path.name}: {e}")
    
    logger.info(f"Loaded {len(environments_db)} environments total")

@app.on_event("startup")
async def startup_event():
    load_environments()

@app.get("/")
async def root():
    return {"message": "EE Containers Builder API", "version": "1.0.0"}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.get("/api/environments")
async def get_environments():
    return list(environments_db.values())

@app.post("/api/environments/reload")
async def reload_environments():
    """Reload environments from disk"""
    load_environments()
    return {"message": f"Reloaded {len(environments_db)} environments"}

@app.post("/api/credentials/validate")
async def validate_credentials(credentials: Credentials):
    if not credentials.rh_username or not credentials.rh_password:
        raise HTTPException(status_code=400, detail="Username and password required")
    return {"valid": True, "message": "Credentials validated successfully"}

@app.post("/api/builds")
async def create_build(build_request: BuildRequest, background_tasks: BackgroundTasks):
    """Start building selected environments"""
    build_id = f"build_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    build_status = BuildStatus(
        id=build_id,
        status="queued",
        environments=build_request.environments,
        started_at=datetime.now().isoformat(),
        logs=[]
    )
    
    builds_db[build_id] = build_status
    
    # Start build in background
    background_tasks.add_task(
        execute_build,
        build_id,
        build_request.environments,
        build_request.credentials
    )
    
    return {"build_id": build_id, "status": "queued"}

@app.get("/api/builds/{build_id}")
async def get_build_status(build_id: str):
    """Get build status"""
    if build_id not in builds_db:
        raise HTTPException(status_code=404, detail="Build not found")
    return builds_db[build_id]

@app.get("/api/builds")
async def get_builds():
    """Get all builds"""
    return list(builds_db.values())

async def execute_build(build_id: str, environments: List[str], credentials: Credentials):
    """Execute the build process using ansible-playbook"""
    build_status = builds_db[build_id]
    build_status.status = "running"
    build_status.logs.append(f"Starting build for environments: {', '.join(environments)}")
    
    try:
        # Create temporary credentials file
        creds_dir = Path("/tmp/ansible-vars")
        creds_dir.mkdir(exist_ok=True)
        
        creds_file = creds_dir / "config"
        with open(creds_file, 'w') as f:
            yaml.dump({
                'rh_username': credentials.rh_username,
                'rh_password': credentials.rh_password,
                'console_redhat_com_automationhub_token': credentials.automation_hub_token
            }, f)
        
        # Set proper permissions
        os.chmod(creds_file, 0o600)
        build_status.logs.append("Credentials configured")
        
        # Run ansible-playbook for each environment
        for env_name in environments:
            if env_name not in environments_db:
                build_status.logs.append(f"Environment {env_name} not found, skipping")
                continue
                
            build_status.logs.append(f"Building environment: {env_name}")
            
            # Change to the original repo directory
            repo_dir = Path("../").resolve()
            
            # Run the original ee_builder.yml playbook
            cmd = [
                "ansible-playbook",
                "ee_builder.yml",
                "-e", f"selected_env=['{env_name}']",
                "-e", f"rh_username={credentials.rh_username}",
                "-e", f"rh_password={credentials.rh_password}",
                "-e", f"console_redhat_com_automationhub_token={credentials.automation_hub_token}",
                "-v"
            ]
            
            build_status.logs.append(f"Running: {' '.join(cmd)}")
            
            # Execute ansible-playbook
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=repo_dir
            )
            
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                log_line = line.decode().strip()
                build_status.logs.append(log_line)
                logger.info(f"Build {build_id}: {log_line}")
            
            await process.wait()
            
            if process.returncode == 0:
                build_status.logs.append(f"✅ Successfully built {env_name}")
                build_status.images.append(env_name)
            else:
                build_status.logs.append(f"❌ Failed to build {env_name} (exit code: {process.returncode})")
        
        # Clean up credentials
        try:
            os.unlink(creds_file)
        except:
            pass
        
        build_status.status = "completed"
        build_status.logs.append("🎉 Build completed")
        
    except Exception as e:
        build_status.status = "failed"
        build_status.logs.append(f"💥 Build failed: {str(e)}")
        logger.error(f"Build {build_id} failed: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
