#!/bin/bash

# Network Partition Testing Script for ZombieAuth
# Uses container stop/start to simulate network partitions between instances
# This approach is more effective than toxiproxy as it completely isolates instances
# Automatically detects Docker or Podman (Docker checked first)

set -e

COUCHDB1_URL="http://localhost:5984"
COUCHDB2_URL="http://localhost:5985"  
COUCHDB3_URL="http://localhost:5986"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Container engine detection
CONTAINER_ENGINE=""
CONTAINER_CMD=""
COMPOSE_CMD=""

detect_container_engine() {
    # Check Docker first (alphabetically)
    if command -v docker &> /dev/null; then
        CONTAINER_ENGINE="docker"
        CONTAINER_CMD="docker"
        COMPOSE_CMD="docker compose"
        log "Detected Docker"
    elif command -v podman &> /dev/null; then
        CONTAINER_ENGINE="podman"
        CONTAINER_CMD="podman"
        if command -v podman-compose &> /dev/null; then
            COMPOSE_CMD="podman-compose"
        else
            COMPOSE_CMD="podman compose"
        fi
        log "Detected Podman"
    else
        error "Neither Docker nor Podman found!"
        echo "Please install Docker or Podman"
        exit 1
    fi
}

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

check_dependencies() {
    log "Checking dependencies..."
    
    if ! command -v curl &> /dev/null; then
        error "curl is required but not installed"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed (sudo apt install jq)"
        exit 1
    fi
    
    # Check if ZombieAuth containers are running
    local running_containers=$($CONTAINER_CMD ps --format "{{.Names}}" | grep -E "zombieauth-(dc1|dc2|home|couchdb[123])" | wc -l)
    if [ "$running_containers" -lt 6 ]; then
        error "Not all ZombieAuth containers are running. Expected 6, found $running_containers"
        error "Please run './scripts/start-zombieauth.sh' first"
        exit 1
    fi
    
    log "Dependencies OK"
}

wait_for_container_running() {
    local container_name=$1
    local timeout=${2:-30}
    local start_time=$(date +%s)
    
    while true; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [[ $elapsed -gt $timeout ]]; then
            error "Timeout waiting for $container_name to start"
            return 1
        fi
        
        if $CONTAINER_CMD ps --filter "name=$container_name" --filter "status=running" --quiet | grep -q .; then
            log "Container $container_name is running"
            return 0
        fi
        
        sleep 2
    done
}

stop_container() {
    local container_name=$1
    log "Stopping container: $container_name"
    
    if $CONTAINER_CMD ps --filter "name=$container_name" --quiet | grep -q .; then
        $CONTAINER_CMD stop "$container_name" > /dev/null 2>&1
        log "Container $container_name stopped"
    else
        warn "Container $container_name was not running"
    fi
}

start_container() {
    local container_name=$1
    log "Starting container: $container_name"
    
    $CONTAINER_CMD start "$container_name" > /dev/null 2>&1
    wait_for_container_running "$container_name"
}

cleanup_test_user() {
    local username=$1
    local user_id="user:$username"
    
    for port in 5984 5985 5986; do
        curl -s "http://admin:password@localhost:$port/zombieauth/$user_id" | jq -r '._rev' | while read rev; do
            if [ "$rev" != "null" ] && [ -n "$rev" ]; then
                curl -s -X DELETE "http://admin:password@localhost:$port/zombieauth/$user_id?rev=$rev" >/dev/null 2>&1
            fi
        done 2>/dev/null || true
    done
}

wait_for_user_sync() {
    local username=$1
    local timeout=${2:-30}
    local user_id="user:$username"
    local start_time=$(date +%s)
    
    log "Waiting for user '$username' to sync across all instances..."
    
    while true; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [[ $elapsed -gt $timeout ]]; then
            warn "Sync timeout for user $username after ${timeout}s"
            return 1
        fi
        
        # Check if user exists on all three instances
        local count=0
        for port in 5984 5985 5986; do
            if curl -s "http://admin:password@localhost:$port/zombieauth/$user_id" | jq -e '._id' >/dev/null 2>&1; then
                count=$((count + 1))
            fi
        done
        
        if [ $count -eq 3 ]; then
            log "✓ User '$username' synced to all instances (${elapsed}s)"
            return 0
        fi
        
        echo -n "."
        sleep 2
    done
}

verify_user_exists() {
    local username=$1
    local instance_name=$2
    local port=$3
    local user_id="user:$username"
    
    local user_data=$(curl -s "http://admin:password@localhost:$port/zombieauth/$user_id")
    if echo "$user_data" | jq -e '._id' >/dev/null 2>&1; then
        local actual_username=$(echo "$user_data" | jq -r '.username')
        local groups=$(echo "$user_data" | jq -r '.groups[]?' | tr '\n' ',' | sed 's/,$//')
        log "✓ $instance_name: User '$actual_username' exists with groups: [$groups]"
        return 0
    else
        error "✗ $instance_name: User '$username' NOT FOUND"
        return 1
    fi
}

create_test_user() {
    local couchdb_port=$1
    local username=$2
    local groups=$3
    local instance_name=$4
    
    log "Creating user '$username' on $instance_name (CouchDB port $couchdb_port) with groups: $groups"
    
    # Create user directly in CouchDB
    local user_doc="{
        \"_id\": \"user:$username\",
        \"type\": \"user\",
        \"username\": \"$username\",
        \"email\": \"$username@test.com\",
        \"passwordHash\": \"\$2b\$12\$dummy.hash.for.testing.only.not.real\",
        \"firstName\": \"Test\",
        \"lastName\": \"User\",
        \"groups\": [\"$groups\"],
        \"roles\": [],
        \"enabled\": true,
        \"emailVerified\": false,
        \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
        \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
        \"instanceMetadata\": {
            \"createdBy\": \"$instance_name\",
            \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
            \"lastModifiedBy\": \"$instance_name\",
            \"lastModifiedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
            \"version\": 1
        }
    }"
    
    local response=$(curl -s -w "%{http_code}" -o /tmp/create_user_response.json \
        -X PUT "http://admin:password@localhost:$couchdb_port/zombieauth/user:$username" \
        -H "Content-Type: application/json" \
        -d "$user_doc")
    
    if [[ "$response" == "201" || "$response" == "202" ]]; then
        log "User '$username' created successfully on $instance_name"
        return 0
    else
        warn "Failed to create user '$username' on $instance_name (HTTP $response)"
        cat /tmp/create_user_response.json || true
        return 1
    fi
}

check_replication_status() {
    local instance_port=$1
    local instance_name=$2
    
    log "Checking replication status for $instance_name..."
    
    local response=$(curl -s "http://localhost:$instance_port/test/replication/status")
    echo "$response" | jq -r '.replication[] | "\(.id): \(.state) (docs: \(.docsRead)/\(.docsWritten))"' || warn "Failed to parse replication status"
}

update_user_status() {
    local couchdb_port=$1
    local username=$2
    local enabled=$3
    local instance_name=$4
    local user_id="user:$username"
    
    log "Updating user '$username' on $instance_name (CouchDB port $couchdb_port) - setting enabled: $enabled"
    
    # First get the current document
    local current_doc=$(curl -s "http://admin:password@localhost:$couchdb_port/zombieauth/$user_id")
    if ! echo "$current_doc" | jq -e '._id' >/dev/null 2>&1; then
        error "User '$username' not found on $instance_name"
        return 1
    fi
    
    # Update the enabled status and metadata
    local updated_doc=$(echo "$current_doc" | jq \
        --argjson enabled "$enabled" \
        --arg instance "$instance_name" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
        '.enabled = $enabled |
         .updatedAt = $timestamp |
         .instanceMetadata.lastModifiedBy = $instance |
         .instanceMetadata.lastModifiedAt = $timestamp |
         .instanceMetadata.version = (.instanceMetadata.version // 1) + 1')
    
    local response=$(curl -s -w "%{http_code}" -o /tmp/update_user_response.json \
        -X PUT "http://admin:password@localhost:$couchdb_port/zombieauth/$user_id" \
        -H "Content-Type: application/json" \
        -d "$updated_doc")
    
    if [[ "$response" == "201" || "$response" == "202" ]]; then
        log "User '$username' updated successfully on $instance_name (enabled: $enabled)"
        return 0
    else
        warn "Failed to update user '$username' on $instance_name (HTTP $response)"
        cat /tmp/update_user_response.json || true
        return 1
    fi
}

verify_user_status() {
    local username=$1
    local instance_name=$2
    local port=$3
    local expected_enabled=$4
    local user_id="user:$username"
    
    local user_data=$(curl -s "http://admin:password@localhost:$port/zombieauth/$user_id")
    if echo "$user_data" | jq -e '._id' >/dev/null 2>&1; then
        local actual_enabled=$(echo "$user_data" | jq -r '.enabled')
        local actual_username=$(echo "$user_data" | jq -r '.username')
        local modified_by=$(echo "$user_data" | jq -r '.instanceMetadata.lastModifiedBy // "unknown"')
        local rev=$(echo "$user_data" | jq -r '._rev')
        
        # Check if the document has conflicts
        local conflicts=$(echo "$user_data" | jq -r '._conflicts[]?' 2>/dev/null | wc -l)
        local conflict_indicator=""
        if [[ $conflicts -gt 0 ]]; then
            conflict_indicator=" [CONFLICT: $conflicts revisions]"
        fi
        
        if [[ -n "$expected_enabled" ]]; then
            # Check against expected value
            if [[ "$actual_enabled" == "$expected_enabled" ]]; then
                log "✓ $instance_name: User '$actual_username' enabled=$actual_enabled (modified by: $modified_by, rev: $rev)$conflict_indicator"
            else
                warn "✗ $instance_name: User '$actual_username' enabled=$actual_enabled (expected: $expected_enabled, modified by: $modified_by, rev: $rev)$conflict_indicator"
            fi
        else
            # Just report status
            log "• $instance_name: User '$actual_username' enabled=$actual_enabled (modified by: $modified_by, rev: $rev)$conflict_indicator"
        fi
        return 0
    else
        error "✗ $instance_name: User '$username' NOT FOUND"
        return 1
    fi
}

simulate_partition() {
    local couchdb_container=$1
    local duration=$2
    
    log "Simulating network partition by stopping $couchdb_container (duration: ${duration}s)"
    
    # Determine corresponding ZombieAuth container
    local zombieauth_container=""
    case "$couchdb_container" in
        "zombieauth-couchdb1")
            zombieauth_container="zombieauth-dc1"
            ;;
        "zombieauth-couchdb2") 
            zombieauth_container="zombieauth-dc2"
            ;;
        "zombieauth-couchdb3")
            zombieauth_container="zombieauth-home"
            ;;
        *)
            error "Unknown CouchDB container: $couchdb_container"
            return 1
            ;;
    esac
    
    # Stop both CouchDB and ZombieAuth containers for this instance
    stop_container "$couchdb_container"
    stop_container "$zombieauth_container"
    
    # Wait for the specified duration
    sleep "$duration"
    
    # Restart both containers to restore connectivity
    log "Restoring connectivity by starting $couchdb_container and $zombieauth_container"
    start_container "$couchdb_container"
    start_container "$zombieauth_container"
    
    # Wait for containers to fully initialize
    sleep 15
    
    log "Network partition for $couchdb_container restored"
}

wait_for_sync() {
    local timeout=$1
    log "Waiting up to ${timeout}s for synchronization..."
    
    local start_time=$(date +%s)
    while true; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [[ $elapsed -gt $timeout ]]; then
            warn "Sync wait timeout reached"
            break
        fi
        
        # Check if all instances are in sync by checking conflict count via test endpoints
        local conflicts1=$(curl -s "http://localhost:3000/test/conflicts/stats" | jq -r '.stats.total // 0')
        local conflicts2=$(curl -s "http://localhost:3001/test/conflicts/stats" | jq -r '.stats.total // 0')
        local conflicts3=$(curl -s "http://localhost:3002/test/conflicts/stats" | jq -r '.stats.total // 0')
        
        if [[ "$conflicts1" == "0" && "$conflicts2" == "0" && "$conflicts3" == "0" ]]; then
            log "All instances appear to be in sync (no conflicts detected)"
            break
        fi
        
        echo "Conflicts detected: DC1=$conflicts1, DC2=$conflicts2, Home=$conflicts3. Waiting..."
        sleep 5
    done
}

test_basic_replication() {
    log "=== Testing Basic Replication During Single Node Isolation ==="
    
    local test_timestamp=$(date +%s)
    
    # Clean up any previous test users
    cleanup_test_user "alice_${test_timestamp}"
    cleanup_test_user "bob_${test_timestamp}"
    cleanup_test_user "carol_${test_timestamp}"
    
    log "Phase 1: Testing DC1 isolation and user creation"
    log "Stopping Instance 2 and Instance 3..."
    stop_container "zombieauth-couchdb2"
    stop_container "zombieauth-dc2"
    stop_container "zombieauth-couchdb3"
    stop_container "zombieauth-home"
    
    sleep 5
    log "Creating user 'alice_${test_timestamp}' on Instance 1..."
    create_test_user 5984 "alice_${test_timestamp}" "users" "datacenter1"
    
    log "Restarting Instance 2 and Instance 3..."
    start_container "zombieauth-couchdb2"
    start_container "zombieauth-dc2"
    start_container "zombieauth-couchdb3" 
    start_container "zombieauth-home"
    
    log "Waiting for replication to sync alice..."
    wait_for_user_sync "alice_${test_timestamp}" 30
    
    # Verify alice exists on all instances
    verify_user_exists "alice_${test_timestamp}" "DC1" 5984
    verify_user_exists "alice_${test_timestamp}" "DC2" 5985
    verify_user_exists "alice_${test_timestamp}" "Home" 5986
    
    log "Phase 2: Testing DC2 isolation and user creation"
    log "Stopping Instance 1 and Instance 3..."
    stop_container "zombieauth-couchdb1"
    stop_container "zombieauth-dc1"
    stop_container "zombieauth-couchdb3"
    stop_container "zombieauth-home"
    
    sleep 5
    log "Creating user 'bob_${test_timestamp}' on Instance 2..."
    create_test_user 5985 "bob_${test_timestamp}" "moderators" "datacenter2"
    
    log "Restarting Instance 1 and Instance 3..."
    start_container "zombieauth-couchdb1"
    start_container "zombieauth-dc1"
    start_container "zombieauth-couchdb3"
    start_container "zombieauth-home"
    
    log "Waiting for replication to sync bob..."
    wait_for_user_sync "bob_${test_timestamp}" 30
    
    # Verify bob exists on all instances
    verify_user_exists "bob_${test_timestamp}" "DC1" 5984
    verify_user_exists "bob_${test_timestamp}" "DC2" 5985
    verify_user_exists "bob_${test_timestamp}" "Home" 5986
    
    log "Phase 3: Testing Home instance isolation and user creation"
    log "Stopping Instance 1 and Instance 2..."
    stop_container "zombieauth-couchdb1"
    stop_container "zombieauth-dc1"
    stop_container "zombieauth-couchdb2"
    stop_container "zombieauth-dc2"
    
    sleep 5
    log "Creating user 'carol_${test_timestamp}' on Instance 3 (Home)..."
    create_test_user 5986 "carol_${test_timestamp}" "admin" "home"
    
    log "Restarting Instance 1 and Instance 2..."
    start_container "zombieauth-couchdb1"
    start_container "zombieauth-dc1"
    start_container "zombieauth-couchdb2"
    start_container "zombieauth-dc2"
    
    log "Waiting for replication to sync carol..."
    wait_for_user_sync "carol_${test_timestamp}" 30
    
    # Verify carol exists on all instances
    verify_user_exists "carol_${test_timestamp}" "DC1" 5984
    verify_user_exists "carol_${test_timestamp}" "DC2" 5985
    verify_user_exists "carol_${test_timestamp}" "Home" 5986
    
    log "✓ Basic replication test completed successfully!"
    log "All three users (alice, bob, carol) were created on isolated instances and properly replicated"
}

create_conflicting_user() {
    local couchdb_port=$1
    local username=$2
    local email=$3
    local groups=$4
    local instance_name=$5
    local user_id="user:$username"
    
    log "Creating conflicting user '$username' on $instance_name with email: $email"
    
    # Create user directly in CouchDB with specific email to create conflict
    local user_doc="{
        \"_id\": \"$user_id\",
        \"type\": \"user\",
        \"username\": \"$username\",
        \"email\": \"$email\",
        \"passwordHash\": \"\$2b\$12\$dummy.hash.for.testing.only.not.real\",
        \"firstName\": \"Test\",
        \"lastName\": \"User\",
        \"groups\": [\"$groups\"],
        \"roles\": [],
        \"enabled\": true,
        \"emailVerified\": false,
        \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
        \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
        \"instanceMetadata\": {
            \"createdBy\": \"$instance_name\",
            \"createdAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
            \"lastModifiedBy\": \"$instance_name\",
            \"lastModifiedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",
            \"version\": 1
        }
    }"
    
    local response=$(curl -s -w "%{http_code}" -o /tmp/create_conflicting_user_response.json \
        -X PUT "http://admin:password@localhost:$couchdb_port/zombieauth/$user_id" \
        -H "Content-Type: application/json" \
        -d "$user_doc")
    
    if [[ "$response" == "201" || "$response" == "202" ]]; then
        log "Conflicting user '$username' created successfully on $instance_name (email: $email)"
        return 0
    else
        warn "Failed to create conflicting user '$username' on $instance_name (HTTP $response)"
        cat /tmp/create_conflicting_user_response.json || true
        return 1
    fi
}

test_record_conflicts() {
    log "=== Testing Record Conflicts with Same User ID but Different Emails =="
    
    local test_timestamp=$(date +%s)
    
    # Phase 1: Isolate all instances and create the same user with different emails
    log "Phase 1: Isolating all instances and creating conflicting 'david' users"
    
    # Step 1: Shutdown Instance 2 and Instance 3, create 'david' on Instance 1
    log "Step 1: Shutting down Instance 2 and 3, creating 'david' with david@dc1.com on DC1"
    stop_container "zombieauth-couchdb2"
    stop_container "zombieauth-dc2"
    stop_container "zombieauth-couchdb3"
    stop_container "zombieauth-home"
    
    sleep 5
    create_conflicting_user 5984 "david_${test_timestamp}" "david@dc1.com" "users" "datacenter1"
    
    # Step 2: Shutdown Instance 1, start Instance 2, create 'david' with different email
    log "Step 2: Shutting down Instance 1, starting Instance 2, creating 'david' with david@dc2.com on DC2"
    stop_container "zombieauth-couchdb1"
    stop_container "zombieauth-dc1"
    start_container "zombieauth-couchdb2"
    start_container "zombieauth-dc2"
    
    sleep 5
    create_conflicting_user 5985 "david_${test_timestamp}" "david@dc2.com" "moderators" "datacenter2"
    
    # Step 3: Shutdown Instance 2, start Instance 3, create 'david' with different email
    log "Step 3: Shutting down Instance 2, starting Instance 3, creating 'david' with david@home.com on Home"
    stop_container "zombieauth-couchdb2"
    stop_container "zombieauth-dc2"
    start_container "zombieauth-couchdb3"
    start_container "zombieauth-home"
    
    sleep 5
    create_conflicting_user 5986 "david_${test_timestamp}" "david@home.com" "admin" "home"
    
    # Step 4: Restart all instances to trigger conflict detection  
    log "Step 4: Restarting all instances - this should create conflicts for 'david'"
    start_container "zombieauth-couchdb1"
    start_container "zombieauth-dc1"
    start_container "zombieauth-couchdb2" 
    start_container "zombieauth-dc2"
    
    # Wait for replication to detect conflicts
    log "Waiting for replication to detect conflicts..."
    sleep 20
    
    # Step 5: Analyze the conflicts
    log "Step 5: Analyzing conflicts - each instance should have different david versions"
    
    log "Checking 'david_${test_timestamp}' user on each instance:"
    for instance in "DC1:5984" "DC2:5985" "Home:5986"; do
        IFS=':' read -r name port <<< "$instance"
        
        local user_data=$(curl -s "http://admin:password@localhost:$port/zombieauth/user:david_${test_timestamp}?conflicts=true")
        if echo "$user_data" | jq -e '._id' >/dev/null 2>&1; then
            local email=$(echo "$user_data" | jq -r '.email')
            local groups=$(echo "$user_data" | jq -r '.groups[]?' | tr '\n' ',' | sed 's/,$//')
            local modified_by=$(echo "$user_data" | jq -r '.instanceMetadata.lastModifiedBy // "unknown"')
            local rev=$(echo "$user_data" | jq -r '._rev')
            local conflicts=$(echo "$user_data" | jq -r '._conflicts[]?' 2>/dev/null | wc -l)
            
            if [[ $conflicts -gt 0 ]]; then
                log "• $name: User david email=$email groups=[$groups] (modified by: $modified_by, rev: $rev) [CONFLICT: $conflicts revisions]"
            else
                log "• $name: User david email=$email groups=[$groups] (modified by: $modified_by, rev: $rev)"
            fi
        else
            error "✗ $name: User david NOT FOUND"
        fi
    done
    
    log "✓ Record conflict test completed!"
    log "Created same user 'david' with different emails on isolated instances"
    log "This should demonstrate document conflicts that require manual resolution"
}

run_datacenter_split_test() {
    log "=== Running Datacenter Split Test ==="
    
    local timestamp=$(date +%s)
    
    # Create users on different DCs before split
    create_test_user 5984 "split_user_dc1_${timestamp}" "admin" "datacenter1"  
    create_test_user 5985 "split_user_dc2_${timestamp}" "moderators" "datacenter2"
    
    wait_for_sync 30
    
    # Simulate split between DC1 and DC2 by stopping their CouchDB instances
    log "Simulating split between DC1 and DC2..."
    simulate_partition "zombieauth-couchdb1" 45 &
    PID1=$!
    simulate_partition "zombieauth-couchdb2" 45 &
    PID2=$!
    
    # While DCs are split, create users on the remaining home instance
    local split_conflict_user="split_conflict_${timestamp}"
    # Note: DC1 and DC2 are offline, so we create users through Home (which connects to couchdb3)
    # These will replicate to DC1 and DC2 when they come back online
    create_test_user 5986 "$split_conflict_user" "users" "home"
    create_test_user 5986 "during_dc_split_${timestamp}" "moderators" "home"
    
    # Wait for partitions to heal
    wait $PID1
    wait $PID2
    
    log "Datacenter split healed, creating cross-DC conflicts..."
    
    # Now that DC1 and DC2 are back online, create same users with different attributes
    # This should create conflicts since home already created them
    create_test_user 5984 "$split_conflict_user" "admin" "datacenter1"  # Different role than home
    create_test_user 5985 "during_dc_split_${timestamp}" "admin" "datacenter2"  # Different role than home
    
    log "Waiting for replication and conflict detection..."
    sleep 30
    
    # Check conflicts using test endpoint
    curl -s "http://localhost:3000/test/conflicts" | jq '.conflicts[] | {docId: .documentId, type: .documentType, instances: .analysis.instancesInvolved}' || true
}

show_final_status() {
    log "=== Final Status Report ==="
    
    log "Replication Status:"
    check_replication_status 3000 "DC1"
    check_replication_status 3001 "DC2"  
    check_replication_status 3002 "Home"
    
    log "Conflict Summary:"
    local total_conflicts=$(curl -s "http://localhost:3000/test/conflicts/stats" | jq -r '.stats.total // 0')
    local manual_resolution=$(curl -s "http://localhost:3000/test/conflicts/stats" | jq -r '.stats.requiresManualResolution // 0')
    
    echo "Total conflicts: $total_conflicts"
    echo "Requiring manual resolution: $manual_resolution"
    
    if [[ "$total_conflicts" -gt 0 ]]; then
        log "Conflicts detected! Check the admin interface at http://localhost:8080/admin/conflicts"
    else
        log "No conflicts detected - all instances are in sync"
    fi
}

cleanup_test_users() {
    log "Cleaning up previous test users..."
    
    # Delete any existing test users
    local test_user_patterns=("alice_" "bob_" "carol_" "david_" "eve_" "frank_" "conflicted_user" "split_user_" "split_conflict")
    
    for pattern in "${test_user_patterns[@]}"; do
        local docs=$(curl -s "http://admin:password@localhost:5984/zombieauth/_all_docs?startkey=\"user:${pattern}\"&endkey=\"user:${pattern}z\"&include_docs=true" | jq -r '.rows[] | "\(.doc._id)|\(.doc._rev)"')
        
        if [ -n "$docs" ]; then
            while IFS='|' read -r doc_id doc_rev; do
                if [ -n "$doc_id" ] && [ -n "$doc_rev" ]; then
                    curl -s -X DELETE "http://admin:password@localhost:5984/zombieauth/$doc_id?rev=$doc_rev" > /dev/null || true
                    log "Deleted test user: $doc_id"
                fi
            done <<< "$docs"
        fi
    done
}

main() {
    log "Starting ZombieAuth Network Partition Tests"
    
    detect_container_engine
    check_dependencies
    
    # Clean up previous test users
    cleanup_test_users
    
    case "${1:-basic}" in
        "basic")
            test_basic_replication
            ;;
        "conflicts")
            test_record_conflicts
            ;;
        "all")
            test_basic_replication
            test_record_conflicts
            ;;
        *)
            echo "Usage: $0 [basic|conflicts|all]"
            echo "  basic     - Test basic replication during single node isolation" 
            echo "  conflicts - Test record conflicts with enabled/disabled status changes"
            echo "  all       - Run all tests"
            exit 1
            ;;
    esac
    
    show_final_status
    log "Network partition tests completed"
}

main "$@"