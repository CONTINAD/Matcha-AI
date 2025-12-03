#!/bin/bash

# Non-interactive GitHub setup script
set -e

echo "🔧 Setting up GitHub connection..."

# Set git config if not already set
if [ -z "$(git config --global user.name)" ]; then
    echo "📝 Setting git user name..."
    read -p "Enter your GitHub username: " GITHUB_USERNAME
    git config --global user.name "$GITHUB_USERNAME"
fi

if [ -z "$(git config --global user.email)" ]; then
    echo "📧 Setting git user email..."
    read -p "Enter your GitHub email: " GITHUB_EMAIL
    git config --global user.email "$GITHUB_EMAIL"
fi

# Check if already authenticated
if gh auth status &>/dev/null; then
    echo "✅ Already authenticated with GitHub"
    GITHUB_USER=$(gh api user --jq .login)
else
    echo "🔐 Authenticating with GitHub..."
    echo "📱 This will open a browser window..."
    
    # Try web auth with timeout
    timeout 60 gh auth login --web --git-protocol ssh || {
        echo "⚠️  Web auth timed out or failed"
        echo ""
        echo "🔑 Alternative: Use a Personal Access Token"
        echo "1. Go to: https://github.com/settings/tokens"
        echo "2. Generate new token (classic) with 'repo' scope"
        echo "3. Run: gh auth login --with-token < token.txt"
        echo ""
        read -p "Press Enter to try web auth again, or Ctrl+C to use token method..."
        gh auth login --web --git-protocol ssh
    }
    
    GITHUB_USER=$(gh api user --jq .login)
fi

# Create repository
REPO_NAME="matcha-ai"
echo "📦 Creating repository: $REPO_NAME"

# Check if repo already exists
if gh repo view "$GITHUB_USER/$REPO_NAME" &>/dev/null; then
    echo "✅ Repository already exists"
    git remote remove origin 2>/dev/null || true
    git remote add origin "git@github.com:$GITHUB_USER/$REPO_NAME.git"
else
    echo "🆕 Creating new repository..."
    gh repo create "$REPO_NAME" --public \
        --description "AI-driven crypto trading system with Solana support" \
        --source=. \
        --remote=origin \
        --push || {
        echo "⚠️  Repository creation had issues, setting up remote manually..."
        git remote remove origin 2>/dev/null || true
        git remote add origin "git@github.com:$GITHUB_USER/$REPO_NAME.git"
    }
fi

# Ensure we're on main branch
git branch -M main 2>/dev/null || true

# Push if not already pushed
if ! git ls-remote --heads origin main &>/dev/null; then
    echo "📤 Pushing to GitHub..."
    git push -u origin main
else
    echo "✅ Code already pushed to GitHub"
    echo "🔄 To force push: git push -u origin main --force"
fi

echo ""
echo "✅ Setup complete!"
echo "🌐 Repository: https://github.com/$GITHUB_USER/$REPO_NAME"

