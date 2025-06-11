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

# Enhanced Models
class Environment(BaseModel):
    name: str
    description: str
    type: str  # ee, de
    os_version: str  # rhel8, rhel9
    variant: str  # minimal, supported, etc.
    base_image: str
    status: str = "available"
    # Enhanced fields
    python_deps: List[str] = []
    ansible_deps: List[str] = []
    system_deps: List[str] = []
    collections: List[Dict[str, Any]] = []
    build_args: Dict[str, Any] = {}
    last_built: Optional[str] = None
    file_size_mb: Optional[float] = None

class EnvironmentDetails(BaseModel):
    environment: Environment
    execution_environment_yml: Dict[str, Any]
    requirements_txt: List[str]
    requirements_yml: Dict[str, Any]
    bindep_txt: List[str]
    files_info: Dict[str, Any]

class Credentials(BaseModel):
    rh_username: str
    rh_password: str
    automation_hub_token: str = ""

class BuildRequest(BaseModel):
    environments: List[str]
    credentials: Credentials
    build_options: Dict[str, Any] = {}

class BuildStatus(BaseModel):
    id: str
    status: str
    environments: List[str]
    started_at: str
    completed_at: Optional[str] = None
    logs: List[str] = []
    images: List[str] = []
    errors: List[str] = []
    build_time_seconds: Optional[int] = None

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
        except yaml.YAMLError as e:
            logger.warning(f"YAML syntax error in {file_path}: {e}")
            
            # Try to fix common indentation issues
            try:
                # Fix the specific collections indentation issue
                fixed_content = content.replace(
                    "galaxy: requirements.yml\n      collections:",
                    "galaxy:\n    requirements: requirements.yml\n    collections:"
                )
                return yaml.safe_load(fixed_content)
            except yaml.YAMLError:
                # If that fails, try with custom loader that's more permissive
                try:
                    return yaml.load(content, Loader=yaml.BaseLoader)
                except:
                    logger.error(f"All YAML parsing attempts failed for {file_path}")
                    return None
            
    except Exception as e:
        logger.error(f"Failed to load YAML from {file_path}: {e}")
        return None

def parse_requirements_txt(file_path):
    """Parse requirements.txt file"""
    try:
        if not file_path.exists():
            return []
        with open(file_path, 'r') as f:
            lines = [line.strip() for line in f.readlines() if line.strip() and not line.startswith('#')]
            return lines
    except Exception as e:
        logger.error(f"Failed to parse requirements.txt from {file_path}: {e}")
        return []

def parse_bindep_txt(file_path):
    """Parse bindep.txt file"""
    try:
        if not file_path.exists():
            return []
        with open(file_path, 'r') as f:
            lines = [line.strip() for line in f.readlines() if line.strip() and not line.startswith('#')]
            return lines
    except Exception as e:
        logger.error(f"Failed to parse bindep.txt from {file_path}: {e}")
        return []

def get_file_size_mb(file_path):
    """Get file size in MB"""
    try:
        if file_path.exists():
            return round(file_path.stat().st_size / (1024 * 1024), 2)
    except:
        pass
    return None

def load_environments():
    """Load environment definitions with enhanced details"""
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
            variant="minimal",
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
                req_txt = env_path / "requirements.txt"
                req_yml = env_path / "requirements.yml"
                bindep_file = env_path / "bindep.txt"
                
                logger.info(f"Processing environment: {env_name}")
                
                # Parse name components (rhel8-ee-minimal format)
                parts = env_name.split('-')
                os_version = parts[0] if len(parts) > 0 else "unknown"
                env_type = parts[1] if len(parts) > 1 else "unknown"
                variant = "-".join(parts[2:]) if len(parts) > 2 else "minimal"
                
                # Initialize with basic info
                base_image = "unknown"
                python_deps = []
                ansible_deps = []
                system_deps = []
                collections = []
                build_args = {}
                status = "available"
                
                if ee_file.exists():
                    # Parse execution-environment.yml
                    ee_config = safe_yaml_load(ee_file)
                    
                    if ee_config is None:
                        logger.warning(f"YAML parsing error for {env_name}")
                        status = "yaml_error"
                    else:
                        # Extract base image
                        try:
                            if isinstance(ee_config, dict):
                                if 'images' in ee_config and isinstance(ee_config['images'], dict):
                                    if 'base_image' in ee_config['images']:
                                        base_image_config = ee_config['images']['base_image']
                                        if isinstance(base_image_config, dict) and 'name' in base_image_config:
                                            base_image = base_image_config['name']
                                        elif isinstance(base_image_config, str):
                                            base_image = base_image_config
                                            
                                # Extract build args
                                if 'build_arg_defaults' in ee_config:
                                    build_args = ee_config['build_arg_defaults']
                        except Exception as e:
                            logger.warning(f"Error extracting details from {env_name}: {e}")
                
                # Parse Python dependencies
                python_deps = parse_requirements_txt(req_txt)
                
                # Parse system dependencies
                system_deps = parse_bindep_txt(bindep_file)
                
                # Parse Ansible dependencies
                if req_yml.exists():
                    req_yml_data = safe_yaml_load(req_yml)
                    if req_yml_data and 'collections' in req_yml_data:
                        collections = req_yml_data['collections']
                        ansible_deps = [col.get('name', str(col)) if isinstance(col, dict) else str(col) for col in collections]
                
                # Create description
                description = f"{os_version.upper()} {env_type.upper()} - {variant.replace('-', ' ').title()}"
                
                # Check if environment was recently built (look for container images)
                last_built = None
                try:
                    # This would check podman/docker for existing images
                    # For now, we'll leave it as None
                    pass
                except:
                    pass
                
                environments_db[env_name] = Environment(
                    name=env_name,
                    description=description,
                    type=env_type,
                    os_version=os_version,
                    variant=variant,
                    base_image=base_image,
                    status=status,
                    python_deps=python_deps,
                    ansible_deps=ansible_deps,
                    system_deps=system_deps,
                    collections=collections,
                    build_args=build_args,
                    last_built=last_built,
                    file_size_mb=get_file_size_mb(ee_file)
                )
                logger.info(f"✅ Loaded environment: {env_name}")
                    
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

@app.get("/api/environments", response_model=List[Environment])
async def get_environments():
    return list(environments_db.values())

@app.get("/api/environments/{env_name}", response_model=EnvironmentDetails)
async def get_environment_details(env_name: str):
    """Get detailed information about a specific environment"""
    if env_name not in environments_db:
        raise HTTPException(status_code=404, detail="Environment not found")
    
    env_path = Path("../environments") / env_name
    if not env_path.exists():
        raise HTTPException(status_code=404, detail="Environment directory not found")
    
    # Load all file contents
    ee_file = env_path / "execution-environment.yml"
    req_txt = env_path / "requirements.txt"
    req_yml = env_path / "requirements.yml"
    bindep_file = env_path / "bindep.txt"
    
    ee_config = safe_yaml_load(ee_file) if ee_file.exists() else {}
    req_txt_content = parse_requirements_txt(req_txt)
    req_yml_content = safe_yaml_load(req_yml) if req_yml.exists() else {}
    bindep_content = parse_bindep_txt(bindep_file)
    
    # Get file info
    files_info = {}
    for file_path in [ee_file, req_txt, req_yml, bindep_file]:
        if file_path.exists():
            files_info[file_path.name] = {
                "size_bytes": file_path.stat().st_size,
                "modified": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat(),
                "exists": True
            }
        else:
            files_info[file_path.name] = {"exists": False}
    
    return EnvironmentDetails(
        environment=environments_db[env_name],
        execution_environment_yml=ee_config,
        requirements_txt=req_txt_content,
        requirements_yml=req_yml_content,
        bindep_txt=bindep_content,
        files_info=files_info
    )

@app.post("/api/environments/reload")
async def reload_environments():
    """Reload environments from disk"""
    load_environments()
    return {"message": f"Reloaded {len(environments_db)} environments"}

@app.get("/api/environments/stats")
async def get_environment_stats():
    """Get statistics about environments"""
    total = len(environments_db)
    by_type = {}
    by_os = {}
    by_variant = {}
    
    for env in environments_db.values():
        by_type[env.type] = by_type.get(env.type, 0) + 1
        by_os[env.os_version] = by_os.get(env.os_version, 0) + 1
        by_variant[env.variant] = by_variant.get(env.variant, 0) + 1
    
    return {
        "total_environments": total,
        "by_type": by_type,
        "by_os_version": by_os,
        "by_variant": by_variant,
        "last_reload": datetime.now().isoformat()
    }

@app.post("/api/credentials/validate")
async def validate_credentials(credentials: Credentials):
    if not credentials.rh_username or not credentials.rh_password:
        raise HTTPException(status_code=400, detail="Username and password required")
    return {"valid": True, "message": "Credentials validated successfully"}

@app.post("/api/builds", response_model=Dict[str, str])
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
        build_request.credentials,
        build_request.build_options
    )
    
    return {"build_id": build_id, "status": "queued"}

@app.get("/api/builds/{build_id}", response_model=BuildStatus)
async def get_build_status(build_id: str):
    """Get build status"""
    if build_id not in builds_db:
        raise HTTPException(status_code=404, detail="Build not found")
    return builds_db[build_id]

@app.get("/api/builds", response_model=List[BuildStatus])
async def get_builds():
    """Get all builds"""
    return list(builds_db.values())

async def execute_build(build_id: str, environments: List[str], credentials: Credentials, build_options: Dict[str, Any] = {}):
    """Execute the build process using ansible-playbook"""
    build_status = builds_db[build_id]
    build_status.status = "running"
    build_start_time = datetime.now()
    build_status.logs.append(f"🚀 Starting build for environments: {', '.join(environments)}")
    
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
        build_status.logs.append("🔐 Credentials configured")
        
        # Run ansible-playbook for each environment
        for env_name in environments:
            if env_name not in environments_db:
                build_status.logs.append(f"❌ Environment {env_name} not found, skipping")
                build_status.errors.append(f"Environment {env_name} not found")
                continue
                
            build_status.logs.append(f"🔨 Building environment: {env_name}")
            
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
            
            # Add any build options
            for key, value in build_options.items():
                cmd.extend(["-e", f"{key}={value}"])
            
            build_status.logs.append(f"📝 Running: {' '.join(cmd[:3])} [credentials hidden]")
            
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
                if log_line:  # Only add non-empty lines
                    build_status.logs.append(log_line)
                    logger.info(f"Build {build_id}: {log_line}")
            
            await process.wait()
            
            if process.returncode == 0:
                build_status.logs.append(f"✅ Successfully built {env_name}")
                build_status.images.append(env_name)
                # Update last_built timestamp
                if env_name in environments_db:
                    environments_db[env_name].last_built = datetime.now().isoformat()
            else:
                error_msg = f"Failed to build {env_name} (exit code: {process.returncode})"
                build_status.logs.append(f"❌ {error_msg}")
                build_status.errors.append(error_msg)
        
        # Clean up credentials
        try:
            os.unlink(creds_file)
        except:
            pass
        
        build_end_time = datetime.now()
        build_status.completed_at = build_end_time.isoformat()
        build_status.build_time_seconds = int((build_end_time - build_start_time).total_seconds())
        
        if build_status.errors:
            build_status.status = "completed_with_errors"
            build_status.logs.append(f"⚠️ Build completed with {len(build_status.errors)} errors")
        else:
            build_status.status = "completed"
            build_status.logs.append("🎉 Build completed successfully")
        
    except Exception as e:
        build_status.status = "failed"
        error_msg = f"Build failed: {str(e)}"
        build_status.logs.append(f"💥 {error_msg}")
        build_status.errors.append(error_msg)
        build_status.completed_at = datetime.now().isoformat()
        logger.error(f"Build {build_id} failed: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
