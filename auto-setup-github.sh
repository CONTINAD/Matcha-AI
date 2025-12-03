#!/bin/bash

# Auto-setup GitHub - prompts once, then saves config
set -e

cd "$(dirname "$0")"

CONFIG_FILE=".github-config"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
    echo "✅ Using saved GitHub config"
else
    echo "🔧 First-time GitHub setup"
    echo ""
    read -p "Enter your GitHub username: " GITHUB_USERNAME
    read -p "Enter your GitHub email: " GITHUB_EMAIL
    read -p "Enter your name (for git): " GIT_NAME
    
    # Save config
    cat > "$CONFIG_FILE" <<EOF
GITHUB_USERNAME="$GITHUB_USERNAME"
GITHUB_EMAIL="$GITHUB_EMAIL"
GIT_NAME="$GIT_NAME"
EOF
    
    # Set git config
    git config --global user.name "$GIT_NAME"
    git config --global user.email "$GITHUB_EMAIL"
    
    echo "✅ Config saved to $CONFIG_FILE"
fi

# Set git config if not already set
git config --global user.name "${GIT_NAME:-$GITHUB_USERNAME}" 2>/dev/null || true
git config --global user.email "$GITHUB_EMAIL" 2>/dev/null || true

# Check GitHub auth
if ! gh auth status &>/dev/null; then
    echo ""
    echo "🔐 Authenticating with GitHub..."
    echo "Choose method:"
    echo "1. Browser (interactive)"
    echo "2. Token (non-interactive - recommended)"
    read -p "Choice [1/2]: " AUTH_CHOICE
    
    if [ "$AUTH_CHOICE" = "2" ]; then
        echo ""
        echo "📝 Get token from: https://github.com/settings/tokens"
        echo "   (Select 'repo' scope)"
        read -sp "Paste token here: " GITHUB_TOKEN
        echo ""
        echo "$GITHUB_TOKEN" | gh auth login --with-token
    else
        gh auth login --web --git-protocol ssh
    fi
fi

# Now run quick push
echo ""
echo "🚀 Pushing to GitHub..."
./quick-github-push.sh

