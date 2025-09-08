#!/bin/bash

# Container Engine Utilities
# Provides functions for detecting and working with Docker or Podman
# Usage: source scripts/container-utils.sh

# Global variables
CONTAINER_ENGINE=""
COMPOSE_CMD=""
CONTAINER_CMD=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

detect_container_engine() {
    # Check Docker first (alphabetically)
    if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
        CONTAINER_ENGINE="docker"
        COMPOSE_CMD="docker-compose"
        CONTAINER_CMD="docker"
        log "Detected Docker with docker-compose"
        return 0
    elif command -v podman &> /dev/null && command -v podman-compose &> /dev/null; then
        CONTAINER_ENGINE="podman"
        COMPOSE_CMD="podman-compose"
        CONTAINER_CMD="podman"
        log "Detected Podman with podman-compose"
        return 0
    elif command -v docker &> /dev/null; then
        CONTAINER_ENGINE="docker"
        CONTAINER_CMD="docker"
        warn "Docker found but docker-compose is missing"
        return 1
    elif command -v podman &> /dev/null; then
        CONTAINER_ENGINE="podman"
        CONTAINER_CMD="podman"
        warn "Podman found but podman-compose is missing"
        return 1
    else
        error "Neither Docker nor Podman found!"
        echo "Please install one of:"
        echo "  - Docker + docker-compose"
        echo "  - Podman + podman-compose"
        return 1
    fi
}

# Check if container engine is running
check_container_engine() {
    if [[ -z "$CONTAINER_CMD" ]]; then
        error "Container engine not detected. Run detect_container_engine first."
        return 1
    fi
    
    if $CONTAINER_CMD info &> /dev/null; then
        log "$CONTAINER_ENGINE is running"
        return 0
    else
        error "$CONTAINER_ENGINE is not running or not accessible"
        return 1
    fi
}

# Run compose command with detected engine
compose_cmd() {
    if [[ -z "$COMPOSE_CMD" ]]; then
        error "Compose command not detected. Run detect_container_engine first."
        return 1
    fi
    
    $COMPOSE_CMD "$@"
}

# Run container command with detected engine
container_cmd() {
    if [[ -z "$CONTAINER_CMD" ]]; then
        error "Container command not detected. Run detect_container_engine first."
        return 1
    fi
    
    $CONTAINER_CMD "$@"
}

# Get container logs with detected engine
get_container_logs() {
    local container_name=$1
    local lines=${2:-50}
    
    if [[ -z "$container_name" ]]; then
        error "Container name required"
        return 1
    fi
    
    container_cmd logs --tail "$lines" "$container_name"
}

# Check if a container is running
is_container_running() {
    local container_name=$1
    
    if [[ -z "$container_name" ]]; then
        error "Container name required"
        return 1
    fi
    
    if container_cmd ps --format "table {{.Names}}" 2>/dev/null | grep -q "^${container_name}$"; then
        return 0
    else
        return 1
    fi
}

# Wait for container to be running
wait_for_container() {
    local container_name=$1
    local timeout=${2:-60}
    
    log "Waiting for container $container_name to be running..."
    
    local count=0
    while [ $count -lt $timeout ]; do
        if is_container_running "$container_name"; then
            log "Container $container_name is running!"
            return 0
        fi
        
        echo -n "."
        sleep 2
        ((count += 2))
    done
    
    error "Container $container_name failed to start within $timeout seconds"
    return 1
}