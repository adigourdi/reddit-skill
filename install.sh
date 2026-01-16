#!/usr/bin/env bash
#
# Install Reddit skill for Claude Code
# Creates a symlink from this project's .claude/skills/reddit to ~/.claude/skills/reddit
#

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source and target paths
SOURCE_DIR="${SCRIPT_DIR}/.claude/skills/reddit"
TARGET_DIR="${HOME}/.claude/skills"
TARGET_LINK="${TARGET_DIR}/reddit"

# Verify source directory exists
if [[ ! -d "${SOURCE_DIR}" ]]; then
    echo "Error: Source directory not found: ${SOURCE_DIR}"
    echo "Ensure the .claude/skills/reddit directory exists in the project."
    exit 1
fi

# Create target directory if it doesn't exist
if [[ ! -d "${TARGET_DIR}" ]]; then
    echo "Creating ${TARGET_DIR}..."
    mkdir -p "${TARGET_DIR}"
fi

# Handle existing symlink or directory
if [[ -L "${TARGET_LINK}" ]]; then
    echo "Removing existing symlink at ${TARGET_LINK}..."
    rm "${TARGET_LINK}"
elif [[ -e "${TARGET_LINK}" ]]; then
    echo "Error: ${TARGET_LINK} exists and is not a symlink."
    echo "Please remove it manually if you want to proceed."
    exit 1
fi

# Create the symlink
echo "Creating symlink: ${TARGET_LINK} -> ${SOURCE_DIR}"
ln -s "${SOURCE_DIR}" "${TARGET_LINK}"

# Verify the symlink was created correctly
if [[ -L "${TARGET_LINK}" ]] && [[ -d "${TARGET_LINK}" ]]; then
    echo ""
    echo "Installation successful!"
    echo ""
    echo "The Reddit skill is now available in Claude Code."
    echo "Usage: /reddit <search query or thread URL>"
    echo ""
    echo "Examples:"
    echo "  /reddit how to configure neovim for rust"
    echo "  /reddit https://reddit.com/r/programming/comments/abc123/title"
else
    echo "Error: Symlink verification failed."
    exit 1
fi
